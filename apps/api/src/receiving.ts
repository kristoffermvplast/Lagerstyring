import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
const quantity=z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/);
const bodySchema=z.object({idempotency_key:uuid,item_id:uuid,owner_id:uuid,location_id:uuid,quantity:quantity.refine(x=>!/^0(\.0+)?$/.test(x)),expected_quantity:quantity.nullable().default(null),supplier_id:uuid.nullable().default(null),pallet_count:z.number().int().min(0).max(1000000).nullable().default(null),reference:z.string().trim().max(160).default(''),comment:z.string().trim().max(4000).default('')}).strict();
const filters=z.object({q:z.string().trim().max(120).default(''),supplier_id:uuid.optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new BadRequestException();return r.data;}
const columns=`e.id,e.company_id,e.idempotency_key,e.actor_id,e.reference,e.posted_at,
 e.receipt_supplier_id as supplier_id,e.receipt_supplier_snapshot as supplier_snapshot,
 e.receipt_expected_quantity::text as expected_quantity,e.receipt_pallet_count as pallet_count,
 e.receipt_comment as comment,e.receipt_received_at as received_at,
 l.item_id,l.owner_id,l.location_id,l.unit_id,l.quantity::text as quantity,l.snapshot,
 (l.quantity-e.receipt_expected_quantity)::text as difference,
 (select r.id from app.inventory_entries r where r.company_id=e.company_id and r.reverses_id=e.id) as reversal_id`;
const source='app.inventory_entries e join app.inventory_lines l on l.company_id=e.company_id and l.entry_id=e.id';
@AuthRequired()
@Controller('companies/:companyId/receipts')
export class ReceivingController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:boolean,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const p=(await db.query("select app.allowed('inventory.read') as read,app.allowed('inventory.receive') as receive")).rows[0];if(!p?.read||write&&!p.receive)throw new ForbiddenException();return work(db);});}
 private async detail(db:PoolClient,company:string,id:string){parse(uuid,id);const row=(await db.query(`select ${columns} from ${source} where e.company_id=$1 and e.id=$2 and e.kind='receipt'`,[company,id])).rows[0];if(!row)throw new NotFoundException();return row;}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,false,async db=>{const p=[company,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%',q.supplier_id??null];const where="e.company_id=$1 and e.kind='receipt' and ($3::uuid is null or e.receipt_supplier_id=$3) and (e.reference ilike $2 or e.receipt_comment ilike $2 or e.receipt_supplier_snapshot->>'name' ilike $2 or l.snapshot->'item'->>'code' ilike $2 or l.snapshot->'item'->>'name' ilike $2)";const total=(await db.query(`select count(*)::int total from ${source} where ${where}`,p)).rows[0].total;const items=(await db.query(`select ${columns} from ${source} where ${where} order by e.posted_at desc,e.id desc limit $4 offset $5`,[...p,q.limit,(q.page-1)*q.limit])).rows;return{items,total,page:q.page,limit:q.limit};});}
 @Get(':id')
 get(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,false,db=>this.detail(db,company,id));}
 @Post()
 async receive(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()raw:unknown){const b=parse(bodySchema,raw);const lines=JSON.stringify([{item_id:b.item_id,owner_id:b.owner_id,location_id:b.location_id,quantity:b.quantity}]);
  for(let attempt=0;;attempt++)try{return await this.run(r.actor,company,true,async db=>{
   const p=[company,b.idempotency_key,lines,b.reference,b.supplier_id,b.expected_quantity,b.pallet_count,b.comment];
   const old=(await db.query("select id,(kind='receipt' and request=$3::jsonb and reference=$4 and receipt_supplier_id is not distinct from $5::uuid and receipt_expected_quantity is not distinct from $6::numeric and receipt_pallet_count is not distinct from $7::integer and receipt_comment=$8) as same from app.inventory_entries where company_id=$1 and idempotency_key=$2",p)).rows[0];
   if(old){if(!old.same)throw new ConflictException();return this.detail(db,company,old.id);}
   const entry=(await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request,reference,receipt_supplier_id,receipt_expected_quantity,receipt_pallet_count,receipt_comment) values($1,$2,'receipt','Modtagelse',$3,$4,$5,$6,$7,$8) returning id",p)).rows[0];
   return this.detail(db,company,entry.id);
  });}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='inventory_entries_company_id_idempotency_key_key'))continue;throw e;}
 }
}
