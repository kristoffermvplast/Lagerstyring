import {type ReactNode,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {accessApi} from './auth-client';

type Balance={item_id:string;owner_id:string;location_id:string;quantity:string;available_quantity?:string;snapshot:{owner:{name:string};location:{name:string};unit:{symbol:string}}};
const identity=(b:{owner_id:string;location_id:string})=>`${b.owner_id}:${b.location_id}`;

/** A user chooses one complete stock identity. A search result never implies an owner. */
export function StockContext({company,item,owner,location,onChoose,children}:{company:string;item:string;owner:string;location:string;onChoose:(owner:string,location:string)=>void;children:ReactNode}){
 const [manual,setManual]=useState(Boolean(owner||location)),[page,setPage]=useState(1),[remembered,setRemembered]=useState<Balance|null>(null);
 const stock=useQuery({queryKey:['stock-context',company,item,page],queryFn:()=>accessApi<{items:Balance[];total:number}>(`/companies/${company}/inventory/balances?item_id=${encodeURIComponent(item)}&page=${page}`),enabled:!!item&&!manual,retry:false});
 const value=owner&&location?`${owner}:${location}`:'';
 const options=stock.data?.items.filter(b=>b.item_id===item)??[];
 const selected=options.find(b=>identity(b)===value)??(remembered&&identity(remembered)===value?remembered:null);
 return <section aria-label="Ejer og placering">
 {manual?children:<>
 <label>Vælg beholdning<select aria-label="Vælg beholdning" required value={value} onChange={e=>{const b=options.find(b=>identity(b)===e.target.value);setRemembered(b??null);onChoose(b?.owner_id??'',b?.location_id??'');}}>
 <option value="">Vælg ejer og placering samlet</option>
 {value&&!options.some(b=>identity(b)===value)&&<option value={value}>Tidligere valgt beholdning — kontrolleres ved bogføring</option>}
 {options.map(b=><option key={identity(b)} value={identity(b)}>{b.snapshot.owner.name} · {b.snapshot.location.name} · {b.available_quantity??b.quantity} {b.snapshot.unit.symbol}</option>)}
 </select></label>
 {selected&&<p role="status">Valgt: {selected.snapshot.owner.name} · {selected.snapshot.location.name}. Fysisk: {selected.quantity} {selected.snapshot.unit.symbol}. Tilgængeligt: {selected.available_quantity??selected.quantity}.</p>}
 {!item&&<p>Vælg varen først.</p>}
 {item&&stock.isPending&&<p>Henter beholdninger…</p>}
 {stock.error&&<p role="alert">Beholdninger kunne ikke hentes. <button type="button" onClick={()=>void stock.refetch()}>Prøv beholdninger igen</button></p>}
 {stock.data&&!options.length&&<p>Ingen beholdning fundet. Du kan vælge ejer og placering manuelt.</p>}
 {(page>1||(stock.data?.total??0)>25)&&<div className="master-actions"><button type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Forrige beholdninger</button><button type="button" disabled={!stock.data||page*25>=stock.data.total} onClick={()=>setPage(p=>p+1)}>Flere beholdninger</button></div>}
 <small>Vælg selv mængden. Aktuel beholdning og reservationer kontrolleres ved bogføring.</small>
 </>}
 <button type="button" onClick={()=>setManual(v=>!v)}>{manual?'Vælg fra beholdning':'Vælg ejer og placering manuelt'}</button>
 </section>;
}
