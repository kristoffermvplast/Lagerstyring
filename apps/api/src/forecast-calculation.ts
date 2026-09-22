import {decimal} from './recipe-calculation';

// Aggregated database quantities can exceed a single numeric(20,8) input.
export function amount(value:string):bigint {
 if(!/^\d+(\.\d{1,8})?$/.test(value))throw new Error('Invalid forecast quantity');
 const [whole,fraction='']=value.split('.');return BigInt(whole!)*100000000n+BigInt(fraction.padEnd(8,'0'));
}
export const signed=(value:bigint)=>value<0n?'-'+decimal(-value):decimal(value);
export type ForecastEvent={kind:'arrival'|'production'|'shipment';source_id:string;reference:string;date:string|null;quantity:string;reservation_credit:string};
export function forecast(physical:string,reserved:string,inProduction:string,events:ForecastEvent[]){
 const start=amount(physical)-amount(reserved)-amount(inProduction);
 let balance=start,minimum=start,arrivals=0n,demand=0n,credit=0n;
 // Undated/overdue needs come first. On the same day demand precedes uncertain arrivals.
 const ordered=[...events].sort((a,b)=>(a.date??'').localeCompare(b.date??'')||Number(a.kind==='arrival')-Number(b.kind==='arrival')||a.source_id.localeCompare(b.source_id));
 const timeline=ordered.map(event=>{
  const q=amount(event.quantity),r=amount(event.reservation_credit);
  if(event.kind==='arrival'&&r!==0n||r>q)throw new Error('Invalid reservation credit');
  if(event.kind==='arrival'){arrivals+=q;balance+=q;}else{demand+=q;credit+=r;balance+=r-q;}
  if(balance<minimum)minimum=balance;
  return{...event,projected_available:signed(balance)};
 });
 return{physical,reserved,in_production:inProduction,planning_available:signed(start),expected_arrivals:signed(arrivals),remaining_demand:signed(demand),reservation_credit:signed(credit),projected_available:signed(balance),minimum_available:signed(minimum),shortage:signed(minimum<0n?-minimum:0n),timeline};
}
