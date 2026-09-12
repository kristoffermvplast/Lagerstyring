import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
const input=z.object({idempotency_key:uuid,item_id:uuid,owner_id:uuid,from_location_id:uuid,to_location_id:uuid,quantity:z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/).refine(x=>!/^0(\.0+)?$/.test(x)),reference:z.string().trim().max(160).default(''),comment:z.string().trim().max(1000).default('')}).strict().refine(x=>x.from_location_id!==x.to_location_id);
const filters=z.object({q:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
function parse<T>(schema:z.ZodType<T>,v:unknown):T{const r=schema.safeParse(v);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/transfers')
export class TransfersController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:boolean,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const p=(await db.query("select app.allowed('inventory.read') as read,app.allowed('inventory.transfer') as transfer")).rows[0];if(!p?.read||write&&!p.transfer)throw new ForbiddenException();return work(db);});}
 private async detail(db:PoolClient,company:string,id:string){parse(uuid,id);const e=(await db.query("select * from app.inventory_entries where company_id=$1 and id=$2 and kind='transfer'",[company,id])).rows[0];if(!e)throw new NotFoundException();return{...e,lines:(await db.query('select * from app.inventory_lines where company_id=$1 and entry_id=$2 order by quantity',[company,id])).rows};}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,false,async db=>{const p=[company,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'];const where="company_id=$1 and kind='transfer' and (reference ilike $2 or reason ilike $2)";return{items:(await db.query('select * from app.inventory_entries where '+where+' order by posted_at desc,id desc limit $3 offset $4',[...p,q.limit,(q.page-1)*q.limit])).rows,total:(await db.query('select count(*)::int total from app.inventory_entries where '+where,p)).rows[0].total,page:q.page,limit:q.limit};});}
 @Get(':id')
 get(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,false,db=>this.detail(db,company,id));}
 @Post()
 async transfer(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()raw:unknown){const b=parse(input,raw);const reason=b.comment||'Lagerflytning';if(reason.length<3)throw new BadRequestException();const lines=JSON.stringify([{item_id:b.item_id,owner_id:b.owner_id,location_id:b.from_location_id,quantity:'-'+b.quantity},{item_id:b.item_id,owner_id:b.owner_id,location_id:b.to_location_id,quantity:b.quantity}]);
  for(let attempt=0;;attempt++)try{return await this.run(r.actor,company,true,async db=>{const p=[company,b.idempotency_key,reason,b.reference,lines];const old=(await db.query("select id,(kind='transfer' and reason=$3 and reference=$4 and request=$5::jsonb) as same from app.inventory_entries where company_id=$1 and idempotency_key=$2",p)).rows[0];if(old){if(!old.same)throw new ConflictException();return this.detail(db,company,old.id);}const e=(await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,reference,request) values($1,$2,'transfer',$3,$4,$5) returning id",p)).rows[0];return this.detail(db,company,e.id);});}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='inventory_entries_company_id_idempotency_key_key'))continue;throw e;}
 }
}
