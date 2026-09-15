import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,Post,Param,Req} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
import {calculate,decimal} from './recipe-calculation';
const uuid=z.string().uuid();
const acknowledgement=z.object({key:z.string().min(1).max(160),fingerprint:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const maximum=200;
const units=(s:string)=>{if(!/^\d+(\.\d{1,8})?$/.test(s))throw new Error('Invalid stored quantity');const[a,b='']=s.split('.');return BigInt(a!)*100000000n+BigInt(b.padEnd(8,'0'));};
export type DashboardTarget={page:'Produktion'|'Forsendelser'|'Modtagelse'|'Lager'|'Optælling';id?:string;q?:string};
type Alert={key:string;fingerprint:string;severity:'critical'|'attention';title:string;detail:string;target:DashboardTarget;permission:string;state:'open'|'acknowledged'|'resolved';acknowledged_at?:string};
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const r=schema.safeParse(raw);if(!r.success)throw new BadRequestException();return r.data;}
export function copenhagenDay(date:Date){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
@AuthRequired()
@Controller('companies/:companyId/dashboard')
export class DashboardController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private async run<T>(actor:Actor,company:string,work:(db:PoolClient)=>Promise<T>){parse(uuid,company);for(let attempt=0;;attempt++)try{return await this.database.asActor(actor,company,async db=>{if(!(await db.query("select app.allowed('dashboard.read') ok")).rows[0]?.ok)throw new ForbiddenException();return work(db);});}catch(e:any){if(attempt<2&&['40001','40P01'].includes(e?.code))continue;throw e;}}
 private async overview(db:PoolClient,company:string){
  const permissions=(await db.query("select code from app.permissions where app.allowed(code)")).rows.map(r=>r.code as string),can=(p:string)=>permissions.includes(p);
  const now=new Date(),day=copenhagenDay(now),alerts:Alert[]=[],limited:string[]=[];
  const add=(key:string,title:string,detail:string,target:DashboardTarget,permission:string,revision:unknown,severity:'critical'|'attention'='attention')=>alerts.push({key,title,detail,target,permission,fingerprint:fingerprint([key,revision,title,detail,severity]),severity,state:'open'});
  async function bounded(label:string,sql:string,values:unknown[]){const rows=(await db.query(sql+' limit 201',values)).rows;if(rows.length>maximum)limited.push(label);return rows.slice(0,maximum);}
  const orders=can('production.read')?await bounded('Produktion',"select id,code,status,quantity,problem,planned_start,deadline,version,snapshot from app.production_orders where company_id=$1 and status<>'completed' order by (problem<>'') desc,deadline nulls last,id",[company]):[];
  for(const o of orders){
   if(o.problem)add('order-problem:'+o.id,`${o.code}: problem`,o.problem,{page:'Produktion',id:o.id},'production.read',o.version,'critical');
   if(o.deadline&&new Date(o.deadline)<now)add('order-late:'+o.id,`${o.code}: deadline overskredet`,'Åbn ordren og afklar planen.',{page:'Produktion',id:o.id},'production.read',[o.version,o.deadline],'critical');
   if(!o.snapshot.bom||!o.snapshot.packing||!o.snapshot.machine)add('order-setup:'+o.id,`${o.code}: planlægningsgrundlag mangler`,'Kontrollér stykliste, pakning og maskine i ordren.',{page:'Produktion',id:o.id},'production.read',o.version);
  }
  const shipments=can('shipments.read')?await bounded('Forsendelser',"select id,code,status,ship_date::text,version from app.shipments where company_id=$1 and (ship_date=$2::date or (ship_date<$2::date and status not in ('dispatched','cancelled'))) order by ship_date,id",[company,day]):[];
  for(const s of shipments)if(s.ship_date<day&&!['dispatched','cancelled'].includes(s.status))add('shipment-late:'+s.id,`${s.code}: forsendelse forsinket`,'Åbn forsendelsen og afklar reservation, klargøring eller afsendelse.',{page:'Forsendelser',id:s.id},'shipments.read',[s.version,s.ship_date],'critical');
  const receipts=can('inventory.read')?await bounded('Modtagelser',"select e.id,e.reference,e.receipt_received_at as received_at,exists(select 1 from app.inventory_entries r where r.company_id=e.company_id and r.reverses_id=e.id) reversed from app.inventory_entries e where e.company_id=$1 and e.kind='receipt' and (e.receipt_received_at at time zone 'Europe/Copenhagen')::date=$2::date order by e.receipt_received_at desc,e.id",[company,day]):[];
  const counts=can('inventory.read')&&can('counts.read')?await bounded('Optælling',"select c.id,c.version,c.baseline_revision,b.physical_revision from app.stock_counts c join app.stock_balances b using(company_id,item_id,owner_id,location_id) where c.company_id=$1 and c.status in ('open','counted') and c.baseline_revision<>b.physical_revision order by c.created_at,c.id",[company]):[];
  for(const c of counts)add('count-stale:'+c.id,'Optælling kræver gentælling','Lageret har flyttet sig. Åbn optællingen, annullér og tæl igen.',{page:'Optælling',id:c.id},'counts.read',[c.version,c.physical_revision],'critical');
  // Only company-owned stock is a planning pool. Customer/supplier stock is never borrowed.
  const stock=can('inventory.read')&&can('masterdata.read')?await bounded('Lager',"select i.id,i.code,i.name,i.unit_id,i.minimum_stock::text,i.reorder_level::text,i.version,coalesce(sum(b.quantity-b.reserved_quantity) filter(where o.kind='company' and o.active),0)::text available,coalesce(sum(b.physical_revision),0)::text revision from app.items i left join app.stock_balances b on b.company_id=i.company_id and b.item_id=i.id left join app.stock_owners o on o.company_id=b.company_id and o.id=b.owner_id where i.company_id=$1 and i.active group by i.id order by i.code,i.id",[company]):[];
  for(const s of stock){const threshold=s.reorder_level??s.minimum_stock;if(threshold&&units(s.available)<units(threshold))add('stock-low:'+s.id,`${s.code}: lav disponibel beholdning`,`${s.name}: ${s.available} disponibelt virksomhedsejet; grænse ${threshold}. Kontrollér ejer og placering før genbestilling.`,{page:'Lager',q:s.code},'inventory.read',[s.version,s.revision,s.available,threshold]);}
  const pool=new Map(stock.map(s=>[s.id,{...s,left:units(s.available)}]));
  // Planned/ready orders consume this indicative pool in start/deadline order, once per component.
  const scheduled=(o:any)=>o.planned_start||o.deadline?new Date(o.planned_start??o.deadline).getTime():Infinity;
  const planned=orders.filter(o=>['planned','ready'].includes(o.status)).sort((a,b)=>(scheduled(a)-scheduled(b))||a.id.localeCompare(b.id));
  if(can('inventory.read')&&can('masterdata.read'))for(const o of planned){
   if(!o.snapshot.bom&&!o.snapshot.packing)continue;
   const needs=calculate(o.quantity,o.snapshot.bom,o.snapshot.packing);
   for(const n of [...needs.materials,...needs.packaging.map(p=>({...p,...p.snapshot}))]){
    const s=pool.get(n.component_id);if(!s)continue;const component=[...(o.snapshot.bom?.lines??[]),...(o.snapshot.packing?.lines??[])].find((l:any)=>l.component_id===n.component_id);if(component?.snapshot.unit_id!==s.unit_id){limited.push('Enhed for '+s.code);continue;}const demand=units(n.quantity),short=demand>s.left?demand-s.left:0n;s.left=demand>s.left?0n:s.left-demand;
    if(short>0n)add('shortage:'+o.id+':'+n.component_id,`${o.code}: kommende materialemangel`,`${s.name}: beregnet mangel ${decimal(short)}. Indikativt fuldt ordrebehov mod virksomhedsejet disponibelt lager; allerede udleveret materiale er ikke fratrukket. Kontrollér behov, ejerskab og udleveringer på ordren.`,{page:'Produktion',id:o.id},'production.read',[o.version,s.revision,s.available,n.quantity,short.toString()]);
   }
  }
  const acks=(await db.query('select alert_key,fingerprint,acknowledged_at from app.alert_acknowledgements where company_id=$1 and (alert_key,fingerprint) in (select key,fingerprint from jsonb_to_recordset($2::jsonb) as x(key text,fingerprint text))',[company,JSON.stringify(alerts.map(a=>({key:a.key,fingerprint:a.fingerprint})))])).rows;
  const history=(await db.query('select distinct on (alert_key) alert_key,fingerprint,acknowledged_at from app.alert_acknowledgements where company_id=$1 and not(alert_key=any($2::text[])) order by alert_key,acknowledged_at desc limit 501',[company,alerts.map(a=>a.key)])).rows;
  if(history.length>500)limited.push('Kvitteringshistorik');
  for(const a of alerts){const ack=acks.find(x=>x.alert_key===a.key&&x.fingerprint===a.fingerprint);if(ack){a.state='acknowledged';a.acknowledged_at=ack.acknowledged_at;}}
  // Never infer resolution from a truncated scan. Historical entries contain no business snapshots.
  const seen=new Set(alerts.map(a=>a.key));
  const sources=new Map<string,any>();
  if(!limited.length)for(const [table,permission,kinds] of [
   ['items','masterdata.read',['stock-low']],['stock_counts','counts.read',['count-stale']],
   ['shipments','shipments.read',['shipment-late']],['production_orders','production.read',['order-problem','order-late','order-setup','shortage']],
  ] as const){
   if(!can(permission)||(table==='items'||table==='stock_counts')&&!can('inventory.read'))continue;
   const sourceIds=history.filter(h=>(kinds as readonly string[]).includes(h.alert_key.split(':')[0])).map(h=>h.alert_key.split(':')[1]).filter(id=>uuid.safeParse(id).success);
   if(sourceIds.length)for(const row of (await db.query(`select id${table==='items'?',code':''} from app.${table} where company_id=$1 and id=any($2::uuid[])`,[company,sourceIds])).rows)sources.set(table+':'+row.id,row);
  }
  if(!limited.length)for(const ack of history){if(seen.has(ack.alert_key))continue;seen.add(ack.alert_key);const [kind,id]=ack.alert_key.split(':');
   const permission=kind==='stock-low'?'inventory.read':kind==='count-stale'?'counts.read':kind==='shipment-late'?'shipments.read':kind?.startsWith('order-')||kind==='shortage'?'production.read':null;
   if(!permission||!can(permission)||((kind==='stock-low'||kind==='shortage')&&(!can('masterdata.read')||!can('inventory.read')))||(kind==='count-stale'&&!can('inventory.read')))continue;
   const table=kind==='stock-low'?'items':kind==='count-stale'?'stock_counts':kind==='shipment-late'?'shipments':'production_orders';
   const source=sources.get(table+':'+id);if(!source)continue;
   alerts.push({key:ack.alert_key,fingerprint:ack.fingerprint,severity:'attention',title:'Tidligere kvitteret advarsel er ikke længere aktuel',detail:'Problembetingelsen er ikke længere til stede i de aktuelle data.',permission,state:'resolved',acknowledged_at:ack.acknowledged_at,target:{page:kind==='stock-low'?'Lager':kind==='count-stale'?'Optælling':kind==='shipment-late'?'Forsendelser':'Produktion',...(kind==='stock-low'?{q:source.code}:{id})}});
  }
  return{company_id:company,as_of:now.toISOString(),day,time_zone:'Europe/Copenhagen',limited,permissions,alerts,orders:orders.map(({snapshot,...o})=>({...o,product:snapshot.product?.name})),shipments:shipments.filter(s=>s.ship_date===day),receipts};
 }
 @Get()
 get(@Req()r:{actor:Actor},@Param('companyId')c:string){return this.run(r.actor,c,db=>this.overview(db,c));}
 @Post('acknowledge')
 acknowledge(@Req()r:{actor:Actor},@Param('companyId')c:string,@Body()raw:unknown){const x=parse(acknowledgement,raw);return this.run(r.actor,c,async db=>{
  if(!(await db.query("select app.allowed('dashboard.acknowledge') ok")).rows[0]?.ok)throw new ForbiddenException();
  const view=await this.overview(db,c),a=view.alerts.find(a=>a.key===x.key&&a.fingerprint===x.fingerprint&&a.state!=='resolved');
  if(!a)throw new ConflictException('Advarslen er ændret. Genindlæs dashboardet.');
  await db.query('insert into app.alert_acknowledgements(company_id,alert_key,fingerprint) values($1,$2,$3) on conflict do nothing',[c,x.key,x.fingerprint]);return{company_id:c,key:x.key,fingerprint:x.fingerprint,state:'acknowledged'};
 });}
}
