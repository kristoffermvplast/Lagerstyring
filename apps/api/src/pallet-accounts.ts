import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid(),amount=z.string().regex(/^[1-9][0-9]{0,8}$/);
const command=z.object({idempotency_key:uuid,reason:z.string().trim().min(3).max(1000)}).strict();
const movement=z.object({customer_id:uuid.nullable(),supplier_id:uuid.nullable(),pallet_type_id:uuid,quantity:z.string().regex(/^-?[1-9][0-9]{0,8}$/),occurred_on:z.string().date(),reference:z.string().max(160).default('')}).strict().refine(x=>!!x.customer_id!==!!x.supplier_id);
const query=z.object({customer_id:uuid.optional(),supplier_id:uuid.optional(),pallet_type_id:uuid.optional(),from:z.string().date().optional(),to:z.string().date().optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict().refine(x=>!x.from||!x.to||x.from<=x.to);
function parse<T>(s:z.ZodType<T>,v:unknown):T{const r=s.safeParse(v);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/pallet-accounts')
export class PalletAccountsController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,permission:string,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const a=(await db.query("select app.allowed('pallets.read') as read,app.allowed($1) as write",[permission])).rows[0];if(!a?.read||!a?.write)throw new ForbiddenException();return work(db);});}
 @Get('entries')
 list(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){return this.read(r.actor,company,raw,false);}
 @Get('balances')
 balances(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){return this.read(r.actor,company,raw,true);}
 private read(actor:Actor,company:string,raw:unknown,balances:boolean){const q=parse(query,raw);if(balances&&q.from)throw new BadRequestException('Balances support an as-of date only');return this.run(actor,company,'pallets.read',async db=>{
 const params=[company,q.customer_id??null,q.supplier_id??null,q.pallet_type_id??null,q.from??null,q.to??null];
 const where='company_id=$1 and ($2::uuid is null or customer_id=$2) and ($3::uuid is null or supplier_id=$3) and ($4::uuid is null or pallet_type_id=$4) and ($5::date is null or occurred_on >= $5) and ($6::date is null or occurred_on <= $6)';
 const sql=balances?`select company_id,customer_id,supplier_id,pallet_type_id,sum(quantity)::text as quantity,(array_agg(snapshot order by created_at desc,id desc))[1] as snapshot from app.pallet_entries where ${where} group by company_id,customer_id,supplier_id,pallet_type_id`:`select * from app.pallet_entries where ${where}`;
 const order=balances?'customer_id nulls last,supplier_id nulls last,pallet_type_id':'occurred_on desc,created_at desc,id desc';
 return{items:(await db.query(`select * from (${sql}) x order by ${order} limit $7 offset $8`,[...params,q.limit,(q.page-1)*q.limit])).rows,total:(await db.query(`select count(*)::int total from (${sql}) x`,params)).rows[0].total,page:q.page,limit:q.limit};
 });}
 @Get('entries/:id')
 get(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,'pallets.read',async db=>{const row=(await db.query('select * from app.pallet_entries where company_id=$1 and id=$2',[company,parse(uuid,id)])).rows[0];if(!row)throw new NotFoundException();return row;});}
 @Post('movements')
 create(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()raw:unknown){const c=parse(command.extend({action:z.enum(['outbound','inbound','correction']),data:movement}),raw);if(c.action!=='correction'&&c.data.quantity.startsWith('-'))throw new BadRequestException();return this.post(r.actor,company,c,c.action,c.data);}
 @Post('entries/:id/reverse')
 reverse(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()raw:unknown){return this.post(r.actor,company,parse(command,raw),'reverse',{entry_id:parse(uuid,id)});}
 @Get('shipments/:id')
 declaration(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,'pallets.read',async db=>{if(!(await db.query("select app.allowed('shipments.read') ok")).rows[0].ok)throw new ForbiddenException();const row=(await db.query('select id,company_id,version,status,pallet_exchange from app.shipments where company_id=$1 and id=$2',[company,parse(uuid,id)])).rows[0];if(!row)throw new NotFoundException();return{...row,history:(await db.query("select id,created_at,actor_id,reason,result from app.pallet_events where company_id=$1 and action='declare' and request->>'shipment_id'=$2 order by created_at,id",[company,id])).rows};});}
 @Post('shipments/:id')
 declare(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()raw:unknown){const c=parse(command.extend({version:z.number().int().min(1).max(2147483646),lines:z.array(z.object({pallet_type_id:uuid,quantity:amount}).strict()).max(100)}),raw);return this.post(r.actor,company,c,'declare',{shipment_id:parse(uuid,id),version:c.version,lines:c.lines});}
 private async post(actor:Actor,company:string,c:z.infer<typeof command>,action:string,request:object){for(let attempt=0;;attempt++)try{return await this.run(actor,company,['correction','reverse'].includes(action)?'pallets.adjust':'pallets.manage',async db=>{
 const old=(await db.query('select result,(action=$3 and request=$4::jsonb and reason=$5) as same from app.pallet_events where company_id=$1 and idempotency_key=$2',[company,c.idempotency_key,action,JSON.stringify(request),c.reason])).rows[0];
 if(old){if(!old.same)throw new ConflictException();return old.result;}
 return(await db.query('insert into app.pallet_events(company_id,idempotency_key,action,request,reason) values($1,$2,$3,$4,$5) returning result',[company,c.idempotency_key,action,JSON.stringify(request),c.reason])).rows[0].result;
 });}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='pallet_events_company_id_idempotency_key_key'))continue;throw e;}}
}
