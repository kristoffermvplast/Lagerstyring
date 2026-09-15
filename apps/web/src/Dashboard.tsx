import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {accessApi} from './auth-client';
export type DashboardTarget={page:'Produktion'|'Forsendelser'|'Modtagelse'|'Lager'|'Optælling';id?:string;q?:string};
type Alert={key:string;fingerprint:string;severity:'critical'|'attention';title:string;detail:string;state:'open'|'acknowledged'|'resolved';target:DashboardTarget};
type View={company_id:string;as_of:string;day:string;limited:string[];permissions:string[];alerts:Alert[];orders:{id:string;code:string;status:string;product?:string;quantity:string}[];shipments:{id:string;code:string;status:string}[];receipts:{id:string;reference:string;received_at:string;reversed:boolean}[]};
const msg=(e:unknown)=>e instanceof Error?e.message:'Dashboardet kunne ikke hentes.';
const status:Record<string,string>={draft:'Kladde',planned:'Planlagt',ready:'Klar',in_production:'I produktion',reconciliation:'Afstemning',reserved:'Reserveret',dispatched:'Afsendt',cancelled:'Annulleret'};
export function Dashboard({company,open}:{company:string;open:(target:DashboardTarget)=>void}){
 const base=`/companies/${company}/dashboard`,view=useQuery({queryKey:['dashboard',company],queryFn:async()=>{const v=await accessApi<View>(base);if(v.company_id!==company)throw new Error('Dashboardet har forkert virksomhed.');return v;},retry:false,refetchOnWindowFocus:false});
 const v=view.data;
 function group(title:string,alerts:Alert[]){return <section className="access-card"><h2>{title} · {alerts.length}</h2>{alerts.map(a=><article key={a.key+':'+a.fingerprint}><h3>{a.title}</h3><p>{a.detail}</p><button onClick={()=>open(a.target)}>Åbn {a.target.page.toLowerCase()}</button>{a.state==='open'&&v?.permissions.includes('dashboard.acknowledge')&&<Acknowledge base={base} alert={a} saved={async()=>{await view.refetch();}}/>}</article>)}</section>;}
 return <><button disabled={view.isFetching} onClick={()=>void view.refetch()}>Opdatér dashboard</button>{view.isPending&&<p>Henter dashboard…</p>}{view.error&&<p role="alert">{msg(view.error)} Genindlæs før du handler.</p>}{v&&!view.error&&<>
 <p>Overblik pr. {new Date(v.as_of).toLocaleString('da-DK')} · Dagens modtagelser og forsendelser: {v.day} (dansk tid). Opdatér for at se ændringer.</p>
 <p>Du ser kun områder, du har læseadgang til. Kvitteret betyder set af dig; problemet er først løst, når grundlaget ikke længere udløser advarslen.</p>
 {!!v.limited.length&&<p role="alert">Delvist overblik: {v.limited.join(', ')}. Åbn arbejdsområderne for alle poster. Fravær af advarsler er ikke en bekræftelse på, at alt er i orden.</p>}
 {group('Kritiske advarsler',v.alerts.filter(a=>a.state==='open'&&a.severity==='critical'))}
 <div className="master-grid"><section className="access-card"><h2>Aktive produktioner</h2>{!v.permissions.includes('production.read')?<p>Produktionsadgang mangler.</p>:v.orders.length?v.orders.map(o=><p key={o.id}><button onClick={()=>open({page:'Produktion',id:o.id})}>{o.code} · {o.product} · {status[o.status]??o.status} · {o.quantity}</button></p>):<p>Ingen aktive produktioner i udsnittet.</p>}</section>
 <section className="access-card"><h2>Dagens modtagelser</h2>{!v.permissions.includes('inventory.read')?<p>Lageradgang mangler.</p>:v.receipts.length?v.receipts.map(r=><p key={r.id}><button onClick={()=>open({page:'Modtagelse',id:r.id})}>{r.reference||'Modtagelse'} · {r.reversed?'Modposteret':'Bogført'}</button></p>):<p>Ingen modtagelser i dagens udsnit.</p>}<h2>Dagens forsendelser</h2>{!v.permissions.includes('shipments.read')?<p>Forsendelsesadgang mangler.</p>:v.shipments.length?v.shipments.map(s=><p key={s.id}><button onClick={()=>open({page:'Forsendelser',id:s.id})}>{s.code} · {status[s.status]??s.status}</button></p>):<p>Ingen forsendelser i dagens udsnit.</p>}</section></div>
 {group('Kræver opmærksomhed',v.alerts.filter(a=>a.state==='open'&&a.severity==='attention'))}{group('Kvitteret af dig',v.alerts.filter(a=>a.state==='acknowledged'))}{group('Løste, tidligere kvitterede advarsler',v.alerts.filter(a=>a.state==='resolved'))}
 </>}</>;
}
function Acknowledge({base,alert,saved}:{base:string;alert:Alert;saved:()=>Promise<void>}){
 const[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <><button disabled={busy} onClick={()=>{if(busy)return;setBusy(true);setError('');void accessApi(base+'/acknowledge','POST',{key:alert.key,fingerprint:alert.fingerprint}).then(saved).catch(e=>setError(msg(e)+' Ved ændret advarsel: opdatér dashboardet. Ved usikker forbindelse: prøv samme kvittering igen.')).finally(()=>setBusy(false));}}>Kvittér som set</button>{error&&<p role="alert">{error}</p>}</>;
}
