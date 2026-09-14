import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
const reason=z.string().trim().min(3).max(1000);
const reserve=z.object({idempotency_key:uuid,item_id:uuid,owner_id:uuid,location_id:uuid,handling_unit_id:uuid.nullable().default(null),quantity:z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/).refine(x=>!/^0(\.0+)?$/.test(x)),reference:z.string().trim().min(1).max(160),reason}).strict();
const release=z.object({idempotency_key:uuid,reason}).strict();
const filters=z.object({q:z.string().trim().max(120).default(''),active:z.enum(['true','false']).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
function parse<T>(schema:z.ZodType<T>,data:unknown):T {const r=schema.safeParse(data);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/reservations')
export class ReservationsController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:boolean,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const a=(await db.query("select app.allowed('inventory.read') as read,app.allowed('inventory.reserve') as write")).rows[0];if(!a?.read||write&&!a?.write)throw new ForbiddenException();return work(db);});}
 private async detail(db:PoolClient,company:string,id:string){const row=(await db.query('select * from app.stock_reservations where company_id=$1 and id=$2',[company,parse(uuid,id)])).rows[0];if(!row)throw new NotFoundException();return{...row,events:(await db.query('select * from app.reservation_events where company_id=$1 and reservation_id=$2 order by created_at,id',[company,id])).rows};}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,false,async db=>{const params=[company,q.active===undefined?null:q.active==='true','%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'];const where="company_id=$1 and ($2::boolean is null or active=$2) and (reference ilike $3 or snapshot->'item'->>'code' ilike $3 or snapshot->'item'->>'name' ilike $3)";return{items:(await db.query('select * from app.stock_reservations where '+where+' order by created_at desc,id desc limit $4 offset $5',[...params,q.limit,(q.page-1)*q.limit])).rows,total:(await db.query('select count(*)::int total from app.stock_reservations where '+where,params)).rows[0].total,page:q.page,limit:q.limit};});}
 @Get(':id')
 get(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,false,db=>this.detail(db,company,id));}
 private async post(actor:Actor,company:string,key:string,id:string,kind:string,reason:string,request:object){
  for(let attempt=0;;attempt++)try{return await this.run(actor,company,true,async db=>{
   const old=(await db.query('select reservation_id,(kind=$3 and reservation_id=$4 and reason=$5 and request=$6::jsonb) as same from app.reservation_events where company_id=$1 and idempotency_key=$2',[company,key,kind,id,reason,JSON.stringify(request)])).rows[0];
   if(old){if(!old.same)throw new ConflictException();return this.detail(db,company,old.reservation_id);}
   if(kind==='release')await this.detail(db,company,id);
   await db.query('insert into app.reservation_events(company_id,idempotency_key,kind,reservation_id,reason,request) values($1,$2,$3,$4,$5,$6)',[company,key,kind,id,reason,JSON.stringify(request)]);
   return this.detail(db,company,id);
  });}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='reservation_events_company_id_idempotency_key_key'))continue;throw e;}
 }
 @Post()
 create(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()raw:unknown){const {idempotency_key,reason,...request}=parse(reserve,raw);return this.post(r.actor,company,idempotency_key,idempotency_key,'reserve',reason,request);}
 @Post(':id/release')
 release(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()raw:unknown){const data=parse(release,raw);return this.post(r.actor,company,data.idempotency_key,parse(uuid,id),'release',data.reason,{});}
}
