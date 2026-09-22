import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {accessApi} from './auth-client';
type Choice={id:string;code:string;name:string};
type Options={items:Choice[];more_items:boolean;owners:Choice[];orders:{id:string;code:string;status:string}[];reservations:{id:string;reference:string;quantity:string}[]};
type Arrival={reference:string;date:string;quantity:string};
type View={company_id:string;as_of:string;sha256:string;item:Choice&{symbol:string};owner:Choice;physical:string;reserved:string;in_production:string;planning_available:string;expected_arrivals:string;remaining_demand:string;reservation_credit:string;projected_available:string;shortage:string;assumptions:string[];timeline:{kind:string;source_id:string;reference:string;date:string|null;quantity:string;reservation_credit:string;projected_available:string}[];sources:unknown};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const error=(e:unknown)=>e instanceof Error?e.message:'Prognosen kunne ikke beregnes.';
export function Forecast({company}:{company:string}){
 const [search,setSearch]=useState(''),[q,setQ]=useState(''),[item,setItem]=useState(''),[owner,setOwner]=useState(''),[to,setTo]=useState(today),[orders,setOrders]=useState<string[]>([]),[reservations,setReservations]=useState<string[]>([]),[arrivals,setArrivals]=useState<Arrival[]>([]),[view,setView]=useState<View|null>(null),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false);
 const revision=useRef(0);
 const invalidate=()=>{revision.current++;setView(null);setFailure('');};
 const options=useQuery({queryKey:['forecast-options',company,q,item,owner],queryFn:()=>accessApi<Options>(`/companies/${company}/forecast/options?`+new URLSearchParams({q,...(item?{item_id:item}:{}),...(owner?{owner_id:owner}:{})})),retry:false});
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(x=>x!==id):[...list,id];
 async function preview(){const version=revision.current;setBusy(true);setView(null);setFailure('');try{const result=await accessApi<View>(`/companies/${company}/forecast/preview`,'POST',{item_id:item,owner_id:owner,to,production_order_ids:orders,production_reservation_ids:reservations,arrivals});if(version===revision.current){if(result.company_id!==company)throw new Error('Virksomheden matcher ikke beregningen.');setView(result);}}catch(e){if(version===revision.current)setFailure(error(e)+' Kontrollér datoer, hele antal ved stk., unikke leveringsreferencer og at valgte ordrer/reservationer stadig er aktive.');}finally{setBusy(false);}}
 function download(){if(!view)return;const url=URL.createObjectURL(new Blob([JSON.stringify(view,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='prognose-'+view.sha256.slice(0,12)+'.json';a.click();URL.revokeObjectURL(url);}
 return <section className="access-card"><p>Beregn et scenarie for én vare og én lagerejer. Beregningen ændrer ikke lageret. Forventede leverancer og valg gemmes ikke; hent beregningsgrundlaget, hvis du vil bevare det.</p>
  <form onSubmit={e=>{e.preventDefault();invalidate();setItem('');setOrders([]);setReservations([]);setQ(search);}}><label>Søg vare<input value={search} maxLength={120} onChange={e=>setSearch(e.target.value)}/></label><button>Søg varer</button></form>
  {options.isPending&&<p role="status">Henter prognosevalg…</p>}{options.error&&<p role="alert">{error(options.error)}</p>}
  {options.data&&<form onSubmit={e=>{e.preventDefault();void preview();}}><fieldset disabled={busy}>
   <label>Vare<select required value={item} onChange={e=>{invalidate();setItem(e.target.value);setOrders([]);setReservations([]);setArrivals([]);}}><option value="">Vælg vare</option>{options.data.items.map(i=><option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></label>{options.data.more_items&&<p>Viser de første 50 varer. Afgræns søgningen.</p>}
   <label>Lagerejer<select required value={owner} onChange={e=>{invalidate();setOwner(e.target.value);setReservations([]);}}><option value="">Vælg ejer</option>{options.data.owners.map(o=><option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}</select></label>
   <label>Beregn frem til<input required type="date" min={today()} value={to} onChange={e=>{invalidate();setTo(e.target.value);}}/></label>
   {item&&<details><summary>Produktionsbehov og reservationer</summary><p>Vælg de ordrer, hvis resterende behov skal dækkes af den valgte ejer. Andre ordrers fremtidige behov indgår ikke. Udleveret materiale trækkes automatisk fra behovet.</p>
    {options.data.orders.length===0&&<p>Ingen relevante åbne produktionsordrer.</p>}{options.data.orders.map(o=><label className="check" key={o.id}><input type="checkbox" checked={orders.includes(o.id)} onChange={()=>{invalidate();setOrders(toggle(orders,o.id));}}/>{o.code}</label>)}
    <p>Vælg kun frie reservationer, som dækker netop disse produktionsbehov. De modregnes én gang. Forsendelsesreservationer håndteres automatisk.</p>{options.data.reservations.map(r=><label className="check" key={r.id}><input type="checkbox" checked={reservations.includes(r.id)} onChange={()=>{invalidate();setReservations(toggle(reservations,r.id));}}/>{r.reference} · {r.quantity}</label>)}
   </details>}
   <details><summary>Forventede leverancer (valgfrit)</summary><p>Angiv kun resterende, endnu ikke modtagne mængder i varens lagerenhed. Dette opretter ingen bestilling eller modtagelse.</p>
    {arrivals.map((a,i)=><fieldset key={i}><legend>Leverance {i+1}</legend>{(['reference','date','quantity'] as const).map(k=><label key={k}>{{reference:'Leveringsreference',date:'Forventet dato',quantity:'Forventet mængde'}[k]}<input required type={k==='date'?'date':'text'} inputMode={k==='quantity'?'decimal':undefined} min={k==='date'?today():undefined} max={k==='date'?to:undefined} maxLength={k==='reference'?120:undefined} pattern={k==='quantity'?'(0|[1-9][0-9]{0,11})(\\.[0-9]{1,8})?':undefined} value={a[k]} onChange={e=>{invalidate();setArrivals(arrivals.map((row,j)=>j===i?{...row,[k]:e.target.value}:row));}}/></label>)}<button type="button" onClick={()=>{invalidate();setArrivals(arrivals.filter((_,j)=>j!==i));}}>Fjern leverance {i+1}</button></fieldset>)}
    <button type="button" disabled={arrivals.length>=50} onClick={()=>{invalidate();setArrivals([...arrivals,{reference:'',date:to,quantity:''}]);}}>Tilføj forventet leverance</button>
   </details><button disabled={!item||!owner||orders.length>50||reservations.length>50}>{busy?'Beregner…':'Beregn prognose'}</button>
  </fieldset></form>}
  {failure&&<p role="alert">{failure}</p>}
  {view&&<section aria-label="Prognoseresultat"><h2>{view.item.code} · {view.owner.name}</h2><p role="status">Scenarie beregnet · {new Date(view.as_of).toLocaleString('da-DK')}</p><p>Forventet disponibelt: <strong>{view.projected_available} {view.item.symbol}</strong> · Største mangel undervejs: {view.shortage} {view.item.symbol}</p>
   <dl>{([['physical','Fysisk lager nu'],['reserved','Reserveret nu'],['in_production','Allerede bundet i produktion'],['planning_available','Til rådighed ved start'],['expected_arrivals','Forventet tilgang'],['remaining_demand','Resterende behov'],['reservation_credit','Heraf allerede reserveret (modregnes)']] as const).map(([k,label])=><div key={k}><dt>{label}</dt><dd>{view[k]} {view.item.symbol}</dd></div>)}</dl>
   <ul>{view.assumptions.map(a=><li key={a}>{a}</li>)}</ul>
   {view.timeline.length===0?<p>Ingen tilgange eller valgte behov i perioden.</p>:<div className="table-scroll"><table><caption>Bevægelser i scenariet · {view.item.symbol}</caption><thead><tr><th>Dato</th><th>Kilde</th><th>Mængde</th><th>Modregnet reservation</th><th>Disponibelt efter</th></tr></thead><tbody>{view.timeline.map((e,i)=><tr key={i}><td>{e.date??'Udateret'}</td><td>{{arrival:'Forventet leverance',production:'Produktionsbehov',shipment:'Forsendelse'}[e.kind]} · {e.reference}</td><td>{e.quantity}</td><td>{e.reservation_credit}</td><td>{e.projected_available}</td></tr>)}</tbody></table></div>}
   <button onClick={download}>Hent beregningsgrundlag</button><p className="hint">Indeholder input, kilde-ID'er, versioner og beregnede mængder. Ingen ændringer gemmes på serveren.</p>
  </section>}
 </section>;
}
