import {BadRequestException,Body,Controller,ForbiddenException,Get,HttpCode,Inject,NotFoundException,Param,PayloadTooLargeException,Post,Query,Req} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
import {calculate,decimal} from './recipe-calculation';
import {amount,forecast,ForecastEvent} from './forecast-calculation';
import {copenhagenDay} from './dashboard';

const uuid=z.string().uuid();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>s>='0001-01-01'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const quantity=z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,8})?$/).refine(s=>{try{return amount(s)>0n;}catch{return false;}});
const input=z.object({item_id:uuid,owner_id:uuid,to:day,production_order_ids:z.array(uuid).max(50).default([]),production_reservation_ids:z.array(uuid).max(50).default([]),arrivals:z.array(z.object({reference:z.string().trim().min(1).max(120),date:day,quantity}).strict()).max(50).default([])}).strict();
function parse<T>(schema:z.ZodType<T>,v:unknown):T{const r=schema.safeParse(v);if(!r.success)throw new BadRequestException('Kontrollér vare, ejer, dato og positive mængder (højst 8 decimaler).');return r.data;}
const rights=['inventory.read','production.read','masterdata.read','shipments.read'];
const componentMatch="(exists(select 1 from jsonb_array_elements(coalesce(snapshot->'bom'->'lines','[]')) l where l->>'component_id'=$2) or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'packing'->'lines','[]')) l where l->>'component_id'=$2))";
@AuthRequired()
@Controller('companies/:companyId/forecast')
export class ForecastController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,c:string,work:(db:PoolClient)=>Promise<T>){parse(uuid,c);return this.database.asActor(actor,c,async db=>{
  if(!(await db.query('select bool_and(app.allowed(code)) ok from unnest($1::text[]) code',[rights])).rows[0]?.ok)throw new ForbiddenException();
  return work(db);
 });}
 private async bounded(db:PoolClient,sql:string,values:unknown[],max=500){const rows=(await db.query(sql+` limit ${max+1}`,values)).rows;if(rows.length>max)throw new PayloadTooLargeException('For mange kilder til én beregning. Prognosen er ikke beregnet.');return rows;}
 @Get('options')
 options(@Req()r:{actor:Actor},@Param('companyId')c:string,@Query()raw:unknown){const q=parse(z.object({q:z.string().trim().max(120).default(''),item_id:uuid.optional(),owner_id:uuid.optional()}).strict(),raw);return this.run(r.actor,c,async db=>{
  const items=(await db.query("select id,code,name from app.items where company_id=$1 and active and (code ilike $2 or name ilike $2) order by code,id limit 51",[c,'%'+q.q.replace(/[\\%_]/g,'\\$&')+'%'])).rows;
  const owners=await this.bounded(db,'select id,code,name,kind from app.stock_owners where company_id=$1 and active order by code,id',[c],200);
  const orders=q.item_id?await this.bounded(db,"select id,code,status,planned_start,version from app.production_orders where company_id=$1 and status in ('planned','ready','in_production') and "+componentMatch+' order by planned_start nulls last,id',[c,q.item_id]):[];
  const reservations=q.item_id&&q.owner_id?await this.bounded(db,"select r.id,r.reference,r.quantity::text from app.stock_reservations r where r.company_id=$1 and r.item_id=$2 and r.owner_id=$3 and r.active and not exists(select 1 from app.shipment_reservations sr where sr.company_id=r.company_id and sr.reservation_id=r.id) order by r.id",[c,q.item_id,q.owner_id]):[];
  return{company_id:c,items:items.slice(0,50),more_items:items.length>50,owners,orders,reservations};
 });}
 @Post('preview')
 @HttpCode(200)
 preview(@Req()r:{actor:Actor},@Param('companyId')c:string,@Body()raw:unknown){const x=parse(input,raw);return this.run(r.actor,c,async db=>{
  const asOf=(await db.query('select transaction_timestamp() as t')).rows[0].t,today=copenhagenDay(new Date(asOf));
  if(x.to<today||Date.parse(x.to)-Date.parse(today)>730*86400000||x.arrivals.some(a=>a.date<today||a.date>x.to)||new Set(x.production_order_ids).size!==x.production_order_ids.length||new Set(x.production_reservation_ids).size!==x.production_reservation_ids.length||new Set(x.arrivals.map(a=>a.reference.toLocaleLowerCase('da-DK'))).size!==x.arrivals.length)throw new BadRequestException('Brug fremtidige leveringsdatoer og unikke referencer/ordrer.');
  const item=(await db.query('select i.id,i.code,i.name,i.unit_id,u.symbol,u.dimension from app.items i join app.units u on u.company_id=i.company_id and u.id=i.unit_id where i.company_id=$1 and i.id=$2 and i.active',[c,x.item_id])).rows[0];
  const owner=(await db.query('select id,code,name,kind from app.stock_owners where company_id=$1 and id=$2 and active',[c,x.owner_id])).rows[0];
  if(!item||!owner)throw new NotFoundException();
  if(['count','package'].includes(item.dimension)&&x.arrivals.some(a=>amount(a.quantity)%100000000n!==0n))throw new BadRequestException('Enheden kræver hele antal.');
  const balances=await this.bounded(db,'select location_id,unit_id,quantity::text,reserved_quantity::text,physical_revision from app.stock_balances where company_id=$1 and item_id=$2 and owner_id=$3 order by location_id',[c,x.item_id,x.owner_id]);
  if(balances.some(b=>b.unit_id!==item.unit_id))throw new BadRequestException('Lagerenhed er ændret; afklar enheder før beregning.');
  const sum=(rows:any[],field:string)=>rows.reduce((n,row)=>n+amount(row[field]),0n);
  // Material still committed to ANY open order is physical stock, but not a free planning pool.
  // Reuse the existing journal-based function: returns and reversals are netted per issue.
  const openOrders=await this.bounded(db,"select id,code,status,quantity,planned_start,version,snapshot from app.production_orders where company_id=$1 and status<>'completed' and (id=any($3::uuid[]) or exists(select 1 from app.inventory_entries e join app.inventory_lines l on l.company_id=e.company_id and l.entry_id=e.id where e.company_id=$1 and e.production_order_id=app.production_orders.id and l.item_id=$2)) order by id",[c,x.item_id,x.production_order_ids]);
  const productionReservations=(await db.query("select r.id,r.reference,r.quantity::text from app.stock_reservations r where r.company_id=$1 and r.item_id=$2 and r.owner_id=$3 and r.id=any($4::uuid[]) and r.active and not exists(select 1 from app.shipment_reservations sr where sr.company_id=r.company_id and sr.reservation_id=r.id) order by r.id",[c,x.item_id,x.owner_id,x.production_reservation_ids])).rows;
  if(productionReservations.length!==x.production_reservation_ids.length)throw new NotFoundException();
  if(productionReservations.length&&!x.production_order_ids.length)throw new BadRequestException('Vælg de ordrer, reservationerne dækker.');
  let reservationPool=sum(productionReservations,'quantity');
  const states:any[]=[],events:ForecastEvent[]=[],requirements:any[]=[];
  const dueDay=(o:any)=>o.planned_start?copenhagenDay(new Date(o.planned_start)):today;
  openOrders.sort((a,b)=>(dueDay(a)<today?today:dueDay(a)).localeCompare(dueDay(b)<today?today:dueDay(b))||a.id.localeCompare(b.id));
  const materialStates=await this.bounded(db,"select o.id order_id,s.value as state from app.production_orders o cross join lateral jsonb_array_elements(app.production_material_state($1,o.id)) s where o.company_id=$1 and o.id=any($2::uuid[]) and s.value->>'item_id'=$3 order by o.id,s.value->>'issue_id'",[c,openOrders.map(o=>o.id),x.item_id],2000);
  for(const o of openOrders){
   const state=materialStates.filter(s=>s.order_id===o.id).map(s=>s.state);
   if(state.some((s:any)=>s.unit_id!==item.unit_id))throw new BadRequestException('Udleveringens enhed matcher ikke varen.');
   states.push(...state.map((s:any)=>({order_id:o.id,issue_id:s.issue_id,owner_id:s.owner_id,location_id:s.location_id,unit_id:s.unit_id,issued_quantity:s.issued_quantity,returned_quantity:s.returned_quantity,remaining_quantity:s.remaining_quantity})));
   if(!x.production_order_ids.includes(o.id))continue;
   if(!['planned','ready','in_production'].includes(o.status)||!o.snapshot.bom&&!o.snapshot.packing)throw new BadRequestException('Ordren er ikke længere klar til prognose.');
   const calculation=calculate(o.quantity,o.snapshot.bom,o.snapshot.packing),needs=[...calculation.materials,...calculation.packaging.map(p=>({...p,...p.snapshot}))].filter(n=>n.component_id===x.item_id);
   const component=[...(o.snapshot.bom?.lines??[]),...(o.snapshot.packing?.lines??[])].find((l:any)=>l.component_id===x.item_id);
   if(needs.length!==1||component?.snapshot.unit_id!==item.unit_id)throw new BadRequestException('Ordren har ikke et entydigt behov i varens enhed.');
   const full=amount(needs[0]!.quantity),issued=sum(state,'remaining_quantity'),remaining=full>issued?full-issued:0n;
   const due=o.planned_start?copenhagenDay(new Date(o.planned_start)):null;
   if(due&&due>x.to)throw new BadRequestException('Valgt ordre ligger efter prognosens slutdato.');
   requirements.push({order_id:o.id,code:o.code,version:o.version,bom_revision_id:calculation.bom_revision_id,packing_revision_id:calculation.packing_revision_id,full_requirement:decimal(full),net_issued_all_owners:decimal(issued),remaining_requirement:decimal(remaining),assumed_owner_id:x.owner_id});
   const credit=remaining<reservationPool?remaining:reservationPool;reservationPool-=credit;
   events.push({kind:'production',source_id:o.id,reference:o.code,date:due&&due>today?due:today,quantity:decimal(remaining),reservation_credit:decimal(credit)});
  }
  if(requirements.length!==x.production_order_ids.length)throw new NotFoundException();
  // Each shipment's own active reservation is credited exactly once, not all reservations.
  const shipments=await this.bounded(db,"select id,code,version,ship_date::text,lines from app.shipments where company_id=$1 and status in ('planned','reserved','ready') and ship_date<=$2::date and exists(select 1 from jsonb_array_elements(lines) l where l->>'item_id'=$3 and l->>'owner_id'=$4) order by ship_date,id",[c,x.to,x.item_id,x.owner_id]);
  const linked=(await db.query('select sr.shipment_id,sum(r.quantity)::text quantity from app.shipment_reservations sr join app.stock_reservations r on r.company_id=sr.company_id and r.id=sr.reservation_id where sr.company_id=$1 and sr.shipment_id=any($2::uuid[]) and r.item_id=$3 and r.owner_id=$4 and r.active group by sr.shipment_id',[c,shipments.map(s=>s.id),x.item_id,x.owner_id])).rows;
  for(const s of shipments){const lines=s.lines.filter((l:any)=>l.item_id===x.item_id&&l.owner_id===x.owner_id);if(lines.some((l:any)=>l.snapshot.unit.id!==item.unit_id))throw new BadRequestException('Forsendelsens enhed matcher ikke varen.');events.push({kind:'shipment',source_id:s.id,reference:s.code,date:s.ship_date<today?today:s.ship_date,quantity:decimal(sum(lines,'quantity')),reservation_credit:linked.find(l=>l.shipment_id===s.id)?.quantity??'0'});}
  x.arrivals.forEach((a,i)=>events.push({kind:'arrival',source_id:'scenario:'+i,...a,reservation_credit:'0'}));
  const result=forecast(decimal(sum(balances,'quantity')),decimal(sum(balances,'reserved_quantity')),decimal(sum(states.filter(s=>s.owner_id===x.owner_id),'remaining_quantity')),events);
  const payload={company_id:c,as_of:asOf,time_zone:'Europe/Copenhagen',basis:'OWNER_SCENARIO_V1',input:x,item,owner,...result,sources:{balances,production_reservations:productionReservations,material_issues:states,production:requirements,shipments:shipments.map(({lines,...s})=>s)},assumptions:['Kun valgt vare og ejer; alle ejerens placeringer indgår. Flytning mellem placeringer kan være nødvendig.','Kun valgte produktionsordrers resterende behov antages dækket af denne ejer. Kun udtrykkeligt valgte frie reservationer modregnes i produktionsbehov. Øvrige reservationer forbliver bundet.','Forventede leverancer er dine ubogførte scenarieinput og gemmes ikke. Indtast aldrig en allerede modtaget mængde.','Ingen automatisk tilgang fra planlagt produktion eller indkøb. Ingen kapacitets-, spild- eller salgsprognose. Behov samme dag regnes før tilgang.']};
  return{...payload,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
 });}
}
