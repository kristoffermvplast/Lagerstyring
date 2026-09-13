import {RecipeRevision,SCALE} from './recipe-calculation';
// Quantities from PostgreSQL aggregates can exceed a single input's 12-digit limit.
function units(s:string):bigint {if(!/^-?\d+(\.\d{1,8})?$/.test(s))throw new Error('Invalid stored quantity');const neg=s.startsWith('-');const [a,b='']=(neg?s.slice(1):s).split('.');const n=BigInt(a!+b.padEnd(8,'0'));return neg?-n:n;}
function format(n:bigint,d=1n):string {if(d<=0n)throw new Error('Invalid denominator');const sign=n<0n?'-':'';const a=n<0n?-n:n;const q=(a+d/2n)/d;return(q===0n?'':sign)+(q/SCALE).toString()+'.'+(q%SCALE).toString().padStart(8,'0');}
const percent=(n:bigint,d:bigint)=>d>0n?format(n*100n*SCALE,d):null;
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
type Stock={item:{name:string;code?:string};unit:{symbol:string;dimension?:string};owner?:{name:string}};
type Material={issue_id:string;item_id:string;owner_id:string;unit_id:string;issued_quantity:string;returned_quantity:string;remaining_quantity:string;snapshot:Stock};
type Waste={item_id:string;owner_id:string;unit_id:string;quantity:string;issue_id:string;snapshot:{stock:Stock}};
type Review={company_id:string;order_id:string;status:string;good_quantity:string;materials:Material[];order_snapshot:{bom?:RecipeRevision;packing?:RecipeRevision}};
export function analyzeMaterials(review:Review,waste:Waste[]) {
 const good=units(review.good_quantity);const theory=new Map<string,{n:bigint;d:bigint;unit_id:string;name:string;unit:string;owner:string}>();
 const bom=review.order_snapshot.bom,packing=review.order_snapshot.packing;
 for(const l of bom?.lines??[])theory.set(l.component_id,{n:good*units(l.quantity),d:units(bom!.base_quantity),unit_id:String(l.snapshot.unit_id),name:String(l.snapshot.name),unit:String(l.snapshot.unit),owner:'bom'});
 if(packing){let capacity=1n;const counts=new Map<number,bigint>();
  for(const l of [...packing.lines].filter(l=>l.kind==='container').sort((a,b)=>a.level-b.level)){
   capacity=l.level===0?units(l.quantity):capacity*units(l.quantity)/SCALE;const count=ceil(good,capacity);counts.set(l.level,count);
   if(theory.has(l.component_id))throw new Error('Duplicate consumption owner');
   theory.set(l.component_id,{n:count*SCALE,d:1n,unit_id:String(l.snapshot.unit_id),name:String(l.snapshot.name),unit:String(l.snapshot.unit),owner:'packing'});
  }
  for(const l of packing.lines.filter(l=>l.kind==='accessory')){if(theory.has(l.component_id))throw new Error('Duplicate consumption owner');theory.set(l.component_id,{n:counts.get(l.level)!*units(l.quantity),d:1n,unit_id:String(l.snapshot.unit_id),name:String(l.snapshot.name),unit:String(l.snapshot.unit),owner:'packing'});}
 }
 const groups=new Map<string,{item_id:string;unit_id:string;name:string;unit:string;issued:bigint;returned:bigint;net:bigint;waste:bigint;owners:Map<string,{owner_id:string;name:string;net:bigint;waste:bigint}>;warnings:Set<string>}>();
 function group(item:string,unit:string,name:string,symbol:string){const key=item+':'+unit;let g=groups.get(key);if(!g){g={item_id:item,unit_id:unit,name,unit:symbol,issued:0n,returned:0n,net:0n,waste:0n,owners:new Map(),warnings:new Set()};groups.set(key,g);}return g;}
 function owner(g:ReturnType<typeof group>,id:string,name:string){let o=g.owners.get(id);if(!o){o={owner_id:id,name,net:0n,waste:0n};g.owners.set(id,o);}return o;}
 for(const [id,t]of theory)group(id,t.unit_id,t.name,t.unit);
 const activeIssues=new Set(review.materials.map(m=>m.issue_id));
 for(const m of review.materials){const g=group(m.item_id,m.unit_id,m.snapshot.item.name,m.snapshot.unit.symbol);g.issued+=units(m.issued_quantity);g.returned+=units(m.returned_quantity);g.net+=units(m.remaining_quantity);owner(g,m.owner_id,m.snapshot.owner?.name??'').net+=units(m.remaining_quantity);}
 for(const w of waste){const g=group(w.item_id,w.unit_id,w.snapshot.stock.item.name,w.snapshot.stock.unit.symbol);g.waste+=units(w.quantity);owner(g,w.owner_id,w.snapshot.stock.owner?.name??'').waste+=units(w.quantity);if(!activeIssues.has(w.issue_id))g.warnings.add('WASTE_ISSUE_REVERSED');}
 return {company_id:review.company_id,order_id:review.order_id,final:review.status==='completed',good_quantity:review.good_quantity,calculation_version:1,rounding:'HALF_UP_TO_8_DECIMALS',percentage_basis:'NET_ISSUED_MINUS_RETURNED',materials:[...groups.values()].map(g=>{
  const candidate=theory.get(g.item_id),t=candidate?.unit_id===g.unit_id?candidate:undefined;
  if(!t)g.warnings.add(candidate?'UNIT_MISMATCH':'THEORETICAL_BASIS_MISSING');
  if(review.status!=='completed')g.warnings.add('PROVISIONAL_UNRETURNED_STOCK');
  if(g.waste>g.net)g.warnings.add('MEASURED_WASTE_EXCEEDS_NET');
  const diff=t?g.net*t.d-t.n:null;if(diff!==null&&diff<0n)g.warnings.add('NEGATIVE_MATERIAL_DIFFERENCE');
  return {item_id:g.item_id,unit_id:g.unit_id,name:g.name,unit:g.unit,consumption_owner:t?.owner??null,issued_quantity:format(g.issued),returned_quantity:format(g.returned),net_quantity:format(g.net),theoretical_quantity:t?format(t.n,t.d):null,theoretical_exact:t?{numerator:t.n.toString(),denominator:(t.d*SCALE).toString()}:null,difference_quantity:diff===null?null:format(diff,t!.d),measured_waste_quantity:format(g.waste),unexplained_quantity:diff===null?null:format(diff-g.waste*t!.d,t!.d),difference_percent:diff===null?null:percent(diff,g.net*t!.d),waste_percent:percent(g.waste,g.net),warnings:[...g.warnings],owners:[...g.owners.values()].map(o=>({owner_id:o.owner_id,name:o.name,net_quantity:format(o.net),measured_waste_quantity:format(o.waste)}))};
 })};
}
