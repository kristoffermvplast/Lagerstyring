/** Fixed-point inputs, arbitrary precision intermediates, explicit upward rounding at 8 decimals. */
export const SCALE=100000000n;
export function scaled(value:string):bigint {
 if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value)) throw new Error('Invalid decimal');
 const [a,b='']=value.split('.');return BigInt(a!+b.padEnd(8,'0'));
}
export function decimal(n:bigint):string {const a=n/SCALE,b=(n%SCALE).toString().padStart(8,'0').replace(/0+$/,'');return a.toString()+(b?'.'+b:'');}
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
export type RecipeLine={component_id:string;kind:string;level:number;quantity:string;snapshot:Record<string,unknown>};
export type RecipeRevision={id:string;base_quantity:string;snapshot:Record<string,unknown>;lines:RecipeLine[]};
export function calculate(quantity:string,bom?:RecipeRevision,packing?:RecipeRevision) {
 const amount=scaled(quantity); if(amount<=0n)throw new Error('Positive quantity required');
 if(!bom&&!packing)throw new Error('Select a revision');
 for(const r of [bom,packing].filter(Boolean) as RecipeRevision[]) if(r.snapshot.dimension==='count'&&amount%SCALE!==0n)throw new Error('Whole product units required');
 if(bom&&packing&&(bom.snapshot.product_id!==packing.snapshot.product_id||bom.snapshot.unit_id!==packing.snapshot.unit_id))throw new Error('Incompatible product units');
 const used=new Set(bom?.lines.map(l=>l.component_id));
 if(packing?.lines.some(l=>used.has(l.component_id)))throw new Error('Component has two consumption owners');
 const materials=bom?.lines.map(l=>({component_id:l.component_id,...l.snapshot,quantity:decimal(ceil(amount*scaled(l.quantity),scaled(bom.base_quantity))),owner:'bom'}))??[];
 const containers: {level:number;component_id:string;snapshot:Record<string,unknown>;count:string;capacity:string;full:string;partial:string;remainder:string}[]=[];
 const packaging: {component_id:string;snapshot:Record<string,unknown>;quantity:string;owner:string}[]=[];
 if(packing) {
  let capacity=1n;
  for(const line of packing.lines.filter(l=>l.kind==='container').sort((a,b)=>a.level-b.level)) {
   capacity=line.level===0?scaled(line.quantity):capacity*(scaled(line.quantity)/SCALE);
   const count=ceil(amount,capacity);
   containers.push({level:line.level,component_id:line.component_id,snapshot:line.snapshot,count:count.toString(),capacity:decimal(capacity),full:(amount/capacity).toString(),partial:amount%capacity===0n?'0':'1',remainder:decimal(amount%capacity)});
   packaging.push({component_id:line.component_id,snapshot:line.snapshot,quantity:count.toString(),owner:'packing'});
  }
  for(const line of packing.lines.filter(l=>l.kind==='accessory')) {
   const parent=containers.find(c=>c.level===line.level);if(!parent)throw new Error('Missing container');
   packaging.push({component_id:line.component_id,snapshot:line.snapshot,quantity:(BigInt(parent.count)*scaled(line.quantity)/SCALE).toString(),owner:'packing'});
  }
 }
 return {quantity,rounding:'UP_TO_8_DECIMALS',bom_revision_id:bom?.id??null,packing_revision_id:packing?.id??null,materials,packaging,containers,pallets:packing?.snapshot.pallet_type?containers.at(-1)??null:null};
}
