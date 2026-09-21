import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {accessApi} from './auth-client';
const types={customers:'Kunder',suppliers:'Leverandører',products:'Varer',materials:'Materialer',opening_stock:'Startbeholdninger'};
type Kind=keyof typeof types;
type Issue={row:number;field:string;message:string};
type Preview={company_id:string;kind:Kind;rows:Record<string,string>[];errors:Issue[];job_id:string|null;sha256?:string};
type Receipt={id:string;job_id:string;created_at:string;sha256:string;result:{row:number;id:string}[]};
const failure=(e:unknown)=>e instanceof Error?e.message:'Handlingen kunne ikke gennemføres.';
export function Imports({company,permissions}:{company:string;permissions:string[]}){
 const available=(Object.keys(types) as Kind[]).filter(k=>permissions.includes('masterdata.read')&&(k==='opening_stock'?permissions.includes('inventory.read')&&permissions.includes('inventory.adjust'):permissions.includes('masterdata.manage')));
 const[kind,setKind]=useState<Kind>(available[0]??'customers');
 if(!available.length)return <p>Du mangler rettigheder til import.</p>;
 return <><label>Importtype<select value={kind} onChange={e=>setKind(e.target.value as Kind)}>{available.map(k=><option key={k} value={k}>{types[k]}</option>)}</select></label>{available.includes(kind)&&<ImportFile key={company+':'+kind} company={company} kind={kind}/>}</>;
}
function ImportFile({company,kind}:{company:string;kind:Kind}){
 const[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[receipt,setReceipt]=useState<Receipt|null>(null);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const cache=useQueryClient(),base=`/companies/${company}/imports/${kind}`;
 const template=useQuery({queryKey:['import-template',company,kind],queryFn:()=>accessApi<{company_id:string;kind:Kind;required:string[];optional:string[];csv:string}>(base+'/template'),retry:false});
 const history=useQuery({queryKey:['import-history',company,kind],queryFn:()=>accessApi<{company_id:string;kind:Kind;items:Receipt[]}>(base+'/history'),retry:false});
 function download(){const t=template.data;if(!t||t.company_id!==company||t.kind!==kind)return;const url=URL.createObjectURL(new Blob(['\uFEFF'+t.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=kind+'-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function inspect(){if(!file||busy)return;setBusy(true);setError('');setPreview(null);setReceipt(null);try{
  if(file.size>32768||!file.name.toLowerCase().endsWith('.csv'))throw new Error('Vælg en CSV UTF-8-fil på højst 32 KB. Gem Excel-arket som CSV UTF-8 først.');
  const csv=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(!alive.current)return;
  const p=await accessApi<Preview>(base+'/preview','POST',{filename:file.name,csv});if(!alive.current)return;if(p.company_id!==company||p.kind!==kind)throw new Error('Forkert virksomhed eller importtype.');setPreview(p);
 }catch(e){if(alive.current)setError(failure(e));}finally{if(alive.current)setBusy(false);}}
 async function confirm(){if(!preview?.job_id||preview.errors.length||busy)return;setBusy(true);setError('');try{
  const r=await accessApi<{company_id:string;kind:Kind;receipt:Receipt|null;errors:Issue[]}>(`${base}/${preview.job_id}/confirm`,'POST',{confirm:true});if(!alive.current)return;
  if(r.company_id!==company||r.kind!==kind)throw new Error('Forkert virksomhed eller importtype.');
  if(r.errors.length){setPreview({...preview,errors:r.errors,job_id:null});return;}setReceipt(r.receipt);setPreview(null);
  await cache.invalidateQueries({queryKey:['import-history',company,kind]});
 }catch(e){if(alive.current)setError(failure(e)+' Ved forbindelsesfejl kan du trykke Bekræft igen: samme import gemmes kun én gang. Ved ændrede data: lav en ny forhåndsvisning.');}finally{if(alive.current)setBusy(false);}}
 return <><p>Importér én datatype ad gangen: kunder og leverandører først, derefter varer/materialer og til sidst startbeholdninger. Eksisterende data overskrives ikke.</p>
 <p>CSV UTF-8 med semikolon eller komma. Højst 100 datarækker og 32 KB pr. fil. Excel: gem arket som CSV UTF-8. Bevar koder som tekst og brug punktum i decimaler.</p>
 {kind==='opening_stock'&&<p>Brug eksisterende varekode, lagerejerkode og placeringskode. Varen skal have en lagerenhed. Mængden skal være positiv. Eksisterende lagerhistorik på samme vare/ejer/placering blokerer importen. Der oprettes en sporbar lagerkorrektion.</p>}
 {template.error&&<p role="alert">Skabelonen kunne ikke hentes.</p>}{template.data&&<><button type="button" onClick={download}>Hent CSV-skabelon</button><p>Nødvendige kolonner: {template.data.required.join(', ')}</p>{!!template.data.optional.length&&<details><summary>Valgfrie kolonner</summary><p>{template.data.optional.join(', ')}</p><p>Referencer angives som eksisterende koder i denne virksomhed. Blanke felter bruger standardværdier.</p></details>}</>}
 <form onSubmit={e=>{e.preventDefault();void inspect();}}><label>CSV-fil<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setReceipt(null);setError('');}}/></label><button disabled={busy||!file}>Validér og vis forhåndsvisning</button></form>
 {busy&&<p role="status">Behandler import…</p>}{error&&<p role="alert">{error}</p>}
 {preview&&<section><h2>Forhåndsvisning · {preview.rows.length} rækker</h2><p>Ingen stamdata eller lagerbeholdninger er gemt endnu. Bekræftelse genvaliderer alle rækker og gemmer hele filen samlet. Forhåndsvisningen gælder i 24 timer.</p>
 {!!preview.errors.length&&<div role="alert"><p>Ret fejlene i filen, vælg den igen og validér på ny. Ingen rækker importeres, før alle fejl er rettet.</p><ul>{preview.errors.map((e,i)=><li key={i}>{e.row?`Række ${e.row}`:'Fil'} · {e.field}: {e.message}</li>)}</ul></div>}
 {!!preview.rows.length&&<div className="table-scroll"><table><caption>Filens værdier før import</caption><thead><tr><th>Række</th>{Object.keys(preview.rows[0]!).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{preview.rows.map((r,i)=><tr key={i}><td>{i+2}</td>{Object.keys(preview.rows[0]!).map(h=><td key={h}>{r[h]||'—'}</td>)}</tr>)}</tbody></table></div>}
 <button disabled={busy||!preview.job_id||!!preview.errors.length} onClick={()=>void confirm()}>Bekræft import af {preview.rows.length} rækker</button></section>}
 {receipt&&<p role="status">Import gennemført: {receipt.result.length} rækker. Kvittering {receipt.id}.</p>}
 <h2>Seneste importer</h2>{history.error&&<p role="alert">Historikken kunne ikke hentes.</p>}{history.data?.company_id===company&&history.data.kind===kind&&history.data.items.map(r=><details key={r.id}><summary>{new Date(r.created_at).toLocaleString('da-DK')} · {r.result.length} rækker</summary><p>Kvittering {r.id} · Filfingeraftryk {r.sha256}</p><ul>{r.result.map(x=><li key={x.row}>Række {x.row}: {x.id}</li>)}</ul></details>)}
 </>;
}
