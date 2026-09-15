import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
const command=z.object({idempotency_key:uuid,reason:z.string().trim().min(3).max(1000)}).strict();
const version=z.number().int().min(1).max(2147483646);
const start=command.extend({item_id:uuid,owner_id:uuid,location_id:uuid});
const change=command.extend({version});
const record=change.extend({quantity:z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/)});
const filters=z.object({status:z.enum(['open','counted','approved','cancelled']).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const r=schema.safeParse(raw);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/stock-counts')
export class StockCountsController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,permission:string,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const r=(await db.query("select app.allowed('inventory.read') and app.allowed('counts.read') and app.allowed($1) ok",[permission])).rows[0];if(!r?.ok)throw new ForbiddenException();return work(db);});}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,'counts.read',async db=>({items:(await db.query('select * from app.stock_counts where company_id=$1 and ($2::text is null or status=$2) order by created_at desc,id desc limit $3 offset $4',[company,q.status??null,q.limit,(q.page-1)*q.limit])).rows,total:(await db.query('select count(*)::int total from app.stock_counts where company_id=$1 and ($2::text is null or status=$2)',[company,q.status??null])).rows[0].total,page:q.page,limit:q.limit}));}
 @Get(':id')
 get(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){parse(uuid,id);return this.run(r.actor,company,'counts.read',async db=>{
  const c=(await db.query('select c.*,b.quantity as current_quantity,b.physical_revision::text as current_revision,b.reserved_quantity,(b.physical_revision<>c.baseline_revision) as stale,(c.counted_quantity-c.baseline_quantity)::text as difference from app.stock_counts c join app.stock_balances b using(company_id,item_id,owner_id,location_id) where c.company_id=$1 and c.id=$2',[company,id])).rows[0];if(!c)throw new NotFoundException();
  return {...c,events:(await db.query('select id,action,reason,actor_id,created_at,request from app.count_events where company_id=$1 and count_id=$2 order by created_at,id',[company,id])).rows,reservations:(await db.query('select r.id,r.reference,r.quantity,r.handling_unit_id from app.stock_reservations r where company_id=$1 and item_id=$2 and owner_id=$3 and location_id=$4 and active order by created_at,id limit 100',[company,c.item_id,c.owner_id,c.location_id])).rows};
 });}
 @Post()
 start(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()raw:unknown){const {idempotency_key,reason,...request}=parse(start,raw);return this.post(r.actor,company,idempotency_key,idempotency_key,'start',reason,request);}
 @Post(':id/:action')
 change(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Param('action')rawAction:string,@Body()raw:unknown){const action=parse(z.enum(['record','approve','cancel']),rawAction);const {idempotency_key,reason,...request}=parse(action==='record'?record:change,raw);return this.post(r.actor,company,idempotency_key,parse(uuid,id),action,reason,request);}
 private async post(actor:Actor,company:string,key:string,id:string,action:string,reason:string,request:object){for(let attempt=0;;attempt++)try{return await this.run(actor,company,action==='approve'?'counts.approve':'counts.manage',async db=>{
  if(action==='approve'&&!(await db.query("select app.allowed('inventory.adjust') ok")).rows[0].ok)throw new ForbiddenException();
  const old=(await db.query('select result,(count_id=$3 and action=$4 and reason=$5 and request=$6::jsonb) as same from app.count_events where company_id=$1 and idempotency_key=$2',[company,key,id,action,reason,JSON.stringify(request)])).rows[0];if(old){if(!old.same)throw new ConflictException();return old.result;}
  if(action!=='start'&&!(await db.query('select 1 from app.stock_counts where company_id=$1 and id=$2',[company,id])).rows[0])throw new NotFoundException();
  return(await db.query('insert into app.count_events(company_id,idempotency_key,count_id,action,reason,request) values($1,$2,$3,$4,$5,$6) returning result',[company,key,id,action,reason,JSON.stringify(request)])).rows[0].result;
 });}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='count_events_company_id_idempotency_key_key'))continue;throw e;}}
}
