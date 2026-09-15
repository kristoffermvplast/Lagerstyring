import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
import {calculate,decimal,scaled} from './recipe-calculation';
const uuid=z.string().uuid(),reason=z.string().trim().min(3).max(1000);
const quantity=z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/).refine(x=>scaled(x)>0n);
const line=z.object({item_id:uuid,owner_id:uuid,location_id:uuid,handling_unit_id:uuid.nullable().default(null),quantity,packing_revision_id:uuid.nullable().default(null),pallet_spaces:z.string().regex(/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$/).nullable().default(null)}).strict();
const data=z.object({code:z.string().trim().min(1).max(60),customer_id:uuid,ship_date:z.string().date(),reference:z.string().trim().max(160).default(''),carrier:z.string().trim().max(160).default(''),notes:z.string().max(4000).default(''),lines:z.array(line).min(1).max(100)}).strict();
const command=z.object({idempotency_key:uuid,version:z.number().int().min(0).max(2147483646),reason}).strict();
const status=z.enum(['draft','planned','reserved','ready','dispatched','cancelled']);
const filters=z.object({q:z.string().trim().max(120).default(''),status:status.optional(),customer_id:uuid.optional(),from:z.string().date().optional(),to:z.string().date().optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new BadRequestException();return r.data;}
export function shipmentPacking(lines:any[]){
 let pallets=0n,spaces=0n;let unknownPacking=false,unknownSpaces=false;
 const rows=lines.map((l:any)=>{const p=l.snapshot?.packing;const result=p?calculate(l.quantity,undefined,p):null;
 const n=l.handling_unit_id?1n:result?.pallets?BigInt(result.pallets.count):0n;pallets+=n;
 if(l.pallet_spaces===null)unknownSpaces=true;else spaces+=scaled(l.pallet_spaces);
 if(!p&&!l.handling_unit_id)unknownPacking=true;
 return{item_id:l.item_id,handling_unit_id:l.handling_unit_id,quantity:l.quantity,pallets:n.toString(),packing:result};});
 return{lines:rows,pallets:unknownPacking?null:pallets.toString(),pallet_spaces:unknownSpaces?null:decimal(spaces),packing_complete:!unknownPacking,note:'Packing describes shipped goods; it does not consume packaging again.'};
}
@AuthRequired()
@Controller('companies/:companyId/shipments')
export class ShipmentsController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:string|null,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const a=(await db.query("select app.allowed('shipments.read') as read,app.allowed($1) as write",[write??'shipments.read'])).rows[0];if(!a?.read||write&&!a?.write)throw new ForbiddenException();return work(db);});}
 private async detail(db:PoolClient,company:string,id:string){const row=(await db.query('select * from app.shipments where company_id=$1 and id=$2',[company,parse(uuid,id)])).rows[0];if(!row)throw new NotFoundException();return{...row,packing:shipmentPacking(row.lines),reservations:(await db.query('select * from app.shipment_reservations where company_id=$1 and shipment_id=$2 order by line_number',[company,id])).rows,events:(await db.query('select id,action,reason,actor_id,created_at,expected_version from app.shipment_events where company_id=$1 and shipment_id=$2 order by created_at,id',[company,id])).rows};}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,null,async db=>{const p=[company,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%',q.status??null,q.customer_id??null,q.from??null,q.to??null];const where="company_id=$1 and (code ilike $2 or reference ilike $2 or snapshot->'customer'->>'name' ilike $2) and ($3::text is null or status=$3) and ($4::uuid is null or customer_id=$4) and ($5::date is null or ship_date >= $5) and ($6::date is null or ship_date <= $6)";return{items:(await db.query('select id,company_id,code,status,version,ship_date,reference,carrier,snapshot from app.shipments where '+where+' order by ship_date,id limit $7 offset $8',[...p,q.limit,(q.page-1)*q.limit])).rows,total:(await db.query('select count(*)::int total from app.shipments where '+where,p)).rows[0].total,page:q.page,limit:q.limit};});}
 @Get(':id')
 get(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,null,db=>this.detail(db,company,id));}
 private async post(actor:Actor,company:string,id:string,action:string,c:z.infer<typeof command>,request:object){
  for(let attempt=0;;attempt++)try{return await this.run(actor,company,action==='dispatch'?'shipments.dispatch':'shipments.manage',async db=>{
   const old=(await db.query('select result,(shipment_id=$3 and action=$4 and expected_version=$5 and reason=$6 and request=$7::jsonb) as same from app.shipment_events where company_id=$1 and idempotency_key=$2',[company,c.idempotency_key,id,action,c.version,c.reason,JSON.stringify(request)])).rows[0];
   if(old){if(!old.same)throw new ConflictException();return old.result;}
   if(action!=='create')await this.detail(db,company,id);
   const result=(await db.query('insert into app.shipment_events(company_id,shipment_id,idempotency_key,action,expected_version,reason,request) values($1,$2,$3,$4,$5,$6,$7) returning result',[company,id,c.idempotency_key,action,c.version,c.reason,JSON.stringify(request)])).rows[0].result;
   // A malformed historical packing must fail before committing, never render invented quantities.
   shipmentPacking(result.lines);return result;
  });}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='shipment_events_company_id_idempotency_key_key'))continue;throw e;}
 }
 @Post()
 create(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()raw:unknown){const v=parse(command.extend({data}),raw);if(v.version!==0)throw new BadRequestException();return this.post(r.actor,company,v.idempotency_key,'create',v,v.data);}
 @Post(':id/edit')
 edit(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()raw:unknown){const v=parse(command.extend({data}),raw);return this.post(r.actor,company,parse(uuid,id),'edit',v,v.data);}
 @Post(':id/:action')
 transition(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Param('action')action:string,@Body()raw:unknown){return this.post(r.actor,company,parse(uuid,id),parse(z.enum(['plan','reserve','ready','dispatch','cancel']),action),parse(command,raw),{});}
}
