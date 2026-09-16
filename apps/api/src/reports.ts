import {BadRequestException,Body,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,PayloadTooLargeException,Post,Query,Req} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
export const reportKinds=['stock','inventory','production','consumption','waste','shipments'] as const;
type Kind=typeof reportKinds[number];
const permissions:Record<Kind,string[]>={stock:['inventory.read'],inventory:['inventory.read'],production:['production.read'],consumption:['inventory.read','production.read'],waste:['inventory.read','production.read'],shipments:['inventory.read','shipments.read']};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>s>='0001-01-01'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const filters=z.object({from:date.optional(),to:date.optional(),item_id:uuid.optional(),owner_id:uuid.optional(),location_id:uuid.optional(),order_id:uuid.optional(),q:z.string().trim().max(120).default('')}).strict();
const paging={page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)};
const listQuery=filters.extend(paging);
function parse<T>(s:z.ZodType<T>,v:unknown):T{const r=s.safeParse(v);if(!r.success)throw new BadRequestException('Ugyldige rapportfiltre. Kontrollér datoer og ID-felter.');return r.data;}
const kind=(s:string):Kind=>{if(!(reportKinds as readonly string[]).includes(s))throw new NotFoundException();return s as Kind;};
// All identifiers and expressions below are fixed server-side, never request text.
function projection(k:Kind):string{
 if(k==='stock')return `select concat(b.item_id,'/',b.owner_id,'/',b.location_id) row_id,b.updated_at occurred_at,null::uuid source_id,null::uuid entry_id,null::uuid order_id,b.item_id,b.owner_id,b.location_id,b.unit_id,b.snapshot->'item'->>'code' code,b.snapshot->'item'->>'name' name,b.snapshot->'owner'->>'name' owner,b.snapshot->'location'->>'name' location,b.snapshot->'unit'->>'symbol' unit,''::text reference,'balance'::text kind,b.quantity,b.reserved_quantity,(b.quantity-b.reserved_quantity) available_quantity,null::uuid reverses_id from app.stock_balances b where b.company_id=$1`;
 if(k==='production')return `select r.id::text row_id,r.created_at occurred_at,r.id source_id,null::uuid entry_id,r.order_id,(r.snapshot->'product'->>'id')::uuid item_id,null::uuid owner_id,null::uuid location_id,(r.snapshot->'unit'->>'id')::uuid unit_id,r.snapshot->'product'->>'code' code,r.snapshot->'product'->>'name' name,''::text owner,''::text location,r.snapshot->'unit'->>'symbol' unit,r.snapshot->>'order_code' reference,r.kind,case when r.kind='reversal' then -r.quantity else r.quantity end quantity,0::numeric reserved_quantity,0::numeric available_quantity,r.reverses_id from app.production_registrations r where r.company_id=$1`;
 if(k==='waste')return `select w.id::text row_id,w.created_at occurred_at,w.id source_id,w.issue_id entry_id,w.order_id,w.item_id,w.owner_id,l.location_id,w.unit_id,w.snapshot->'stock'->'item'->>'code' code,w.snapshot->'stock'->'item'->>'name' name,w.snapshot->'stock'->'owner'->>'name' owner,w.snapshot->'stock'->'location'->>'name' location,w.snapshot->'stock'->'unit'->>'symbol' unit,w.snapshot->>'order_code' reference,w.kind,case when w.kind='reversal' then -w.quantity else w.quantity end quantity,0::numeric reserved_quantity,0::numeric available_quantity,w.reverses_id from app.production_waste w join app.inventory_lines l on l.company_id=w.company_id and l.entry_id=w.issue_id and l.quantity>0 where w.company_id=$1`;
 const shipment=k==='shipments';
 return `select l.id::text row_id,e.posted_at occurred_at,${shipment?'s.id':'e.id'} source_id,e.id entry_id,e.production_order_id order_id,l.item_id,l.owner_id,l.location_id,l.unit_id,l.snapshot->'item'->>'code' code,l.snapshot->'item'->>'name' name,l.snapshot->'owner'->>'name' owner,l.snapshot->'location'->>'name' location,l.snapshot->'unit'->>'symbol' unit,${shipment?'s.code':'e.reference'} reference,e.kind,${k==='inventory'?'l.quantity':'-l.quantity'} quantity,0::numeric reserved_quantity,0::numeric available_quantity,e.reverses_id from app.inventory_entries e join app.inventory_lines l on l.company_id=e.company_id and l.entry_id=e.id ${shipment?"join app.shipments s on s.company_id=e.company_id and s.entry_id=e.id and s.status='dispatched'":''} where e.company_id=$1 ${k==='consumption'?"and e.kind='production_consumption'":shipment?"and e.kind='shipment'":''}`;
}
const fields=['row_id','occurred_at','source_id','entry_id','order_id','item_id','owner_id','location_id','unit_id','code','name','owner','location','unit','reference','kind','quantity','reserved_quantity','available_quantity','reverses_id'] as const;
const numeric=new Set(['quantity','reserved_quantity','available_quantity']);
export function csvCell(value:unknown,isNumber=false){let s=value==null?'':value instanceof Date?value.toISOString():String(value);if(isNumber&&!/^-?\d+(\.\d+)?$/.test(s))throw new Error('Invalid report number');if(!isNumber&&(/^[\s\uFEFF]*[=+@-]/.test(s)||/^[\x00-\x1f]/.test(s)))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
@AuthRequired()
@Controller('companies/:companyId/reports')
export class ReportsController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,c:string,k:Kind|null,exporting:boolean,work:(db:PoolClient)=>Promise<T>){parse(uuid,c);return this.database.asActor(actor,c,async db=>{
  const required=['reports.read',...(exporting?['reports.export']:[]),...(k?permissions[k]:[])];
  if(!(await db.query('select bool_and(app.allowed(code)) ok from unnest($1::text[]) code',[required])).rows[0]?.ok)throw new ForbiddenException();
  await db.query("set local statement_timeout='8s'");return work(db);
 });}
 private async read(db:PoolClient,c:string,k:Kind,q:z.infer<typeof listQuery>,exporting=false){
  if(q.from&&q.to&&q.from>q.to)throw new BadRequestException('Fra-dato skal være før til-dato.');
  if(k==='stock'&&(q.from||q.to||q.order_id))throw new BadRequestException('Aktuel beholdning er et øjebliksbillede uden periode eller ordre. Brug lagerjournalen for bevægelser.');
  if(k==='production'&&(q.owner_id||q.location_id))throw new BadRequestException('Produktionsregistreringer har ingen lagerejer eller placering.');
  const values=[c,q.from??null,q.to??null,q.item_id??null,q.owner_id??null,q.location_id??null,q.order_id??null,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'];
  const cte=`with source as (${projection(k)}), filtered as (select * from source where ($2::date is null or occurred_at >= ($2::date::timestamp at time zone 'Europe/Copenhagen')) and ($3::date is null or occurred_at < (($3::date+1)::timestamp at time zone 'Europe/Copenhagen')) and ($4::uuid is null or item_id=$4) and ($5::uuid is null or owner_id=$5) and ($6::uuid is null or location_id=$6) and ($7::uuid is null or order_id=$7) and (coalesce(code,'') ilike $8 or coalesce(name,'') ilike $8 or coalesce(reference,'') ilike $8)) `;
  const total=(await db.query(cte+'select count(*)::int total from filtered',values)).rows[0].total;
  if(exporting&&total>2000)throw new PayloadTooLargeException('Eksport er begrænset til 2.000 rækker. Afgræns periode eller filtre.');
  const totals=(await db.query(cte+'select unit_id,min(unit) unit,sum(quantity)::text quantity,sum(reserved_quantity)::text reserved_quantity,sum(available_quantity)::text available_quantity from filtered group by unit_id order by unit_id limit 101',values)).rows;
  if(totals.length>100)throw new PayloadTooLargeException('For mange enheder. Afgræns filtrene.');
  const items=(await db.query(cte+`select ${fields.map(f=>numeric.has(f)?f+'::text':f).join(',')} from filtered order by occurred_at desc,row_id limit $9 offset $10`,[...values,exporting?2000:q.limit,exporting?0:(q.page-1)*q.limit])).rows;
  const as_of=(await db.query('select transaction_timestamp() as t')).rows[0].t;
  const {page,limit,...applied}=q;
  return{company_id:c,report:k,as_of,time_zone:'Europe/Copenhagen',filters:applied,page,limit,total,totals,items,quantity_basis:k==='stock'?'CURRENT_PHYSICAL_RESERVED_AVAILABLE':k==='inventory'?'SIGNED_PHYSICAL_MOVEMENTS':k==='production'?'SIGNED_GOOD_REGISTRATIONS':k==='waste'?'SIGNED_MEASURED_WASTE':k==='consumption'?'POSTED_NET_CONSUMPTION':'DISPATCHED_JOURNAL_QUANTITY'};
 }
 @Get('exports')
 history(@Req()r:{actor:Actor},@Param('companyId')c:string,@Query()raw:unknown){const q=parse(z.object(paging).strict(),raw);return this.run(r.actor,c,null,true,async db=>({company_id:c,items:(await db.query('select id,report,filters,row_count,sha256,created_at from app.report_exports where company_id=$1 order by created_at desc,id desc limit $2 offset $3',[c,q.limit,(q.page-1)*q.limit])).rows}));}
 @Get(':kind')
 list(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('kind')rawKind:string,@Query()raw:unknown){const k=kind(rawKind),q=parse(listQuery,raw);return this.run(r.actor,c,k,false,db=>this.read(db,c,k,q));}
 @Post(':kind/export')
 export(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('kind')rawKind:string,@Body()raw:unknown){const k=kind(rawKind),q=parse(filters,raw);return this.run(r.actor,c,k,true,async db=>{
  const result=await this.read(db,c,k,{...q,page:1,limit:100},true);
  const columns=['company_id','report','as_of','filters',...fields];
  const csv='\uFEFF'+columns.map(x=>csvCell(x)).join(';')+'\r\n'+result.items.map(row=>columns.map(f=>csvCell(f==='company_id'?c:f==='report'?k:f==='as_of'?result.as_of:f==='filters'?JSON.stringify(result.filters):row[f],numeric.has(f))).join(';')).join('\r\n');
  if(Buffer.byteLength(csv,'utf8')>4*1024*1024)throw new PayloadTooLargeException('Eksporten er for stor. Afgræns filtrene.');
  const sha256=createHash('sha256').update(csv,'utf8').digest('hex');
  const receipt=(await db.query('insert into app.report_exports(company_id,report,filters,row_count,sha256) values($1,$2,$3,$4,$5) returning id,created_at',[c,k,JSON.stringify(result.filters),result.total,sha256])).rows[0];
  return{company_id:c,report:k,as_of:result.as_of,filters:result.filters,totals:result.totals,row_count:result.total,sha256,receipt,filename:`rapport-${k}-${receipt.id}.csv`,csv};
 });}
}
