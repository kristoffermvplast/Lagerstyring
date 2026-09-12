import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {PoolClient} from 'pg';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
const qty=z.string().regex(/^-?(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/).refine(x=>!/^[-]?0(\.0+)?$/.test(x));
const line=z.object({item_id:uuid,owner_id:uuid,location_id:uuid,quantity:qty}).strict();
const correction=z.object({idempotency_key:uuid,reason:z.string().trim().min(3).max(1000),reference:z.string().trim().max(160).default(''),lines:z.array(line).min(1).max(100)}).strict();
const reverse=correction.omit({lines:true});
const owner=z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(1).max(160),kind:z.enum(['company','customer','supplier','other']),customer_id:uuid.nullable().default(null),supplier_id:uuid.nullable().default(null),notes:z.string().max(4000).default('')}).strict();
const ownerUpdate=z.object({version:z.number().int().positive(),data:z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(1).max(160),active:z.boolean(),notes:z.string().max(4000).default('')}).strict()}).strict();
const filters=z.object({item_id:uuid.optional(),owner_id:uuid.optional(),location_id:uuid.optional(),q:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict();
function parse<T>(schema:z.ZodType<T>,body:unknown):T{const r=schema.safeParse(body);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/inventory')
export class InventoryController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:boolean,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const a=await db.query("select app.allowed('inventory.read') as read,app.allowed('inventory.adjust') as write");if(!a.rows[0]?.read||(write&&!a.rows[0]?.write))throw new ForbiddenException();return work(db);});}
 private async detail(db:PoolClient,company:string,id:string){parse(uuid,id);const r=await db.query('select * from app.inventory_entries where company_id=$1 and id=$2',[company,id]);if(!r.rows[0])throw new NotFoundException();return {...r.rows[0],lines:(await db.query('select * from app.inventory_lines where company_id=$1 and entry_id=$2 order by item_id,owner_id,location_id',[company,id])).rows};}
 @Get('owners')
 owners(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters.pick({q:true,page:true,limit:true}),raw);return this.run(r.actor,company,false,async db=>{const search='%'+q.q.replace(/[\\%_]/g,'\\$&')+'%';const p=[company,search];const total=(await db.query('select count(*)::int total from app.stock_owners where company_id=$1 and (code ilike $2 or name ilike $2)',p)).rows[0].total;return{items:(await db.query('select * from app.stock_owners where company_id=$1 and (code ilike $2 or name ilike $2) order by code,id limit $3 offset $4',[...p,q.limit,(q.page-1)*q.limit])).rows,total,page:q.page,limit:q.limit};});}
 @Post('owners')
 createOwner(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()body:unknown){const data=parse(owner,body);return this.run(r.actor,company,true,async db=>(await db.query('insert into app.stock_owners(company_id,code,name,kind,customer_id,supplier_id,notes) values($1,$2,$3,$4,$5,$6,$7) returning *',[company,data.code,data.name,data.kind,data.customer_id,data.supplier_id,data.notes])).rows[0]);}
 @Patch('owners/:id')
 updateOwner(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()body:unknown){parse(uuid,id);const data=parse(ownerUpdate,body);return this.run(r.actor,company,true,async db=>{const old=(await db.query('select version from app.stock_owners where company_id=$1 and id=$2 for update',[company,id])).rows[0];if(!old)throw new NotFoundException();if(old.version!==data.version)throw new ConflictException();return(await db.query('update app.stock_owners set code=$3,name=$4,active=$5,notes=$6,version=version+1 where company_id=$1 and id=$2 returning *',[company,id,data.data.code,data.data.name,data.data.active,data.data.notes])).rows[0];});}
 @Get('owners/:id/history')
 ownerHistory(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){parse(uuid,id);return this.run(r.actor,company,false,async db=>{if(!(await db.query('select 1 from app.stock_owners where company_id=$1 and id=$2',[company,id])).rows[0])throw new NotFoundException();return(await db.query("select * from app.masterdata_audit where company_id=$1 and entity_type='stock_owners' and entity_id=$2 order by occurred_at desc,id desc limit 100",[company,id])).rows;});}
 @Get('balances')
 balances(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,false,async db=>{const p=[company,q.item_id??null,q.owner_id??null,q.location_id??null,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'];const where="company_id=$1 and ($2::uuid is null or item_id=$2) and ($3::uuid is null or owner_id=$3) and ($4::uuid is null or location_id=$4) and (snapshot->'item'->>'code' ilike $5 or snapshot->'item'->>'name' ilike $5)";const total=(await db.query('select count(*)::int total from app.stock_balances where '+where,p)).rows[0].total;return{items:(await db.query('select * from app.stock_balances where '+where+' order by item_id,owner_id,location_id limit $6 offset $7',[...p,q.limit,(q.page-1)*q.limit])).rows,total,page:q.page,limit:q.limit};});}
 @Get('entries')
 entries(@Req()r:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const q=parse(filters,raw);return this.run(r.actor,company,false,async db=>{const p=[company,q.item_id??null,q.owner_id??null,q.location_id??null,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'];const where='e.company_id=$1 and (e.reason ilike $5 or e.reference ilike $5) and exists(select 1 from app.inventory_lines l where l.company_id=e.company_id and l.entry_id=e.id and ($2::uuid is null or l.item_id=$2) and ($3::uuid is null or l.owner_id=$3) and ($4::uuid is null or l.location_id=$4))';const total=(await db.query('select count(*)::int total from app.inventory_entries e where '+where,p)).rows[0].total;return{items:(await db.query('select e.* from app.inventory_entries e where '+where+' order by posted_at desc,id desc limit $6 offset $7',[...p,q.limit,(q.page-1)*q.limit])).rows,total,page:q.page,limit:q.limit};});}
 @Get('entries/:id')
 entry(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(r.actor,company,false,db=>this.detail(db,company,id));}
 private async post(actor:Actor,company:string,input:z.infer<typeof reverse>,lines:unknown[],reverses:string|null){
  // Retry entire SERIALIZABLE transaction only; stable key prevents duplicate posting after a lost response.
  for(let attempt=0;;attempt++)try{return await this.run(actor,company,true,async db=>{
   const kind=reverses?'reversal':'correction';
   const existing=(await db.query('select id,(kind=$3 and reason=$4 and reference=$5 and request=$6::jsonb and reverses_id is not distinct from $7::uuid) as same from app.inventory_entries where company_id=$1 and idempotency_key=$2',[company,input.idempotency_key,kind,input.reason,input.reference,JSON.stringify(lines),reverses])).rows[0];
   if(existing){if(!existing.same)throw new ConflictException();return this.detail(db,company,existing.id);}
   if(reverses)await this.detail(db,company,reverses);
   const e=(await db.query('insert into app.inventory_entries(company_id,idempotency_key,kind,reason,reference,request,reverses_id) values($1,$2,$3,$4,$5,$6,$7) returning id',[company,input.idempotency_key,kind,input.reason,input.reference,JSON.stringify(lines),reverses])).rows[0];return this.detail(db,company,e.id);
  });}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='inventory_entries_company_id_idempotency_key_key'))continue;throw e;}
 }
 @Post('corrections')
 correction(@Req()r:{actor:Actor},@Param('companyId')company:string,@Body()body:unknown){const data=parse(correction,body);const lines=[...data.lines].sort((a,b)=>JSON.stringify([a.item_id,a.owner_id,a.location_id]).localeCompare(JSON.stringify([b.item_id,b.owner_id,b.location_id])));return this.post(r.actor,company,data,lines,null);}
 @Post('entries/:id/reverse')
 reverse(@Req()r:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()body:unknown){return this.post(r.actor,company,parse(reverse,body),[],parse(uuid,id));}
}
