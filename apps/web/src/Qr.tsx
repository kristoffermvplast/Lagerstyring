import {useEffect,useRef,useState} from 'react';
import {accessApi} from './auth-client';
import {encodeQr,parseQr,qrPath,QrKind,QrReference} from './qr-reference';

export function QrLabel({company,kind,id,label}:{company:string;kind:QrKind;id:string;label:string}) {
 const [visible,setVisible]=useState(false),[image,setImage]=useState(''),[error,setError]=useState('');
 const value=encodeQr({company,kind,id});
 useEffect(()=>{let alive=true;if(visible){void import('qrcode').then(q=>q.toDataURL(value,{width:384,margin:4,errorCorrectionLevel:'M'})).then(url=>{if(alive)setImage(url);}).catch(()=>{if(alive)setError('QR-koden kunne ikke dannes.');});}return()=>{alive=false;};},[visible,value]);
 return <div><button type="button" onClick={()=>setVisible(v=>!v)}>{visible?'Skjul QR':'Vis QR'}</button>{visible&&<figure><figcaption>{label}</figcaption>{image&&<><img src={image} alt={`QR-kode for ${label}`} width="256" height="256"/><a href={image} download={`lager-${kind}-${id}.png`}>Download QR</a></>}<label>QR-reference<input readOnly value={value} onFocus={e=>e.target.select()}/></label>{error&&<p role="alert">{error}</p>}</figure>}</div>;
}

/** Starts camera only by explicit action; no images leave the device. */
export function QrInput({company,kind,onRead,label='Scan QR'}:{company:string;kind?:QrKind;onRead:(ref:QrReference)=>void;label?:string}) {
 const [value,setValue]=useState(''),[camera,setCamera]=useState(false),[error,setError]=useState('');
 const video=useRef<HTMLVideoElement>(null),callback=useRef(onRead);callback.current=onRead;
 function accept(raw:string){try{const ref=parseQr(raw,company,kind);setError('');setValue('');setCamera(false);callback.current(ref);}catch(e){setError(e instanceof Error?e.message:'QR-koden kunne ikke læses.');}}
 useEffect(()=>{
  if(!camera)return;let cancelled=false,consumed=false;let scanner:{destroy:()=>void}|undefined;
  const hide=()=>{if(document.hidden)setCamera(false);};document.addEventListener('visibilitychange',hide);
  void import('qr-scanner').then(async({default:Scanner})=>{
   if(cancelled||!video.current)return;
   const instance=new Scanner(video.current,result=>{if(cancelled||consumed)return;consumed=true;accept(result.data);setCamera(false);},{preferredCamera:'environment',maxScansPerSecond:5,onDecodeError:()=>{}});
   scanner=instance;await instance.start();if(cancelled)instance.destroy();
  }).catch(()=>{if(!cancelled){setError('Kameraet kunne ikke åbnes. Tillad kamera på HTTPS/localhost, eller brug kodefeltet.');setCamera(false);}});
  return()=>{cancelled=true;scanner?.destroy();document.removeEventListener('visibilitychange',hide);};
 },[camera,company,kind]);
 return <div className="access-card"><label>{label}<input maxLength={160} autoComplete="off" value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();accept(value);}}}/></label><button type="button" disabled={!value} onClick={()=>accept(value)}>Læs kode</button><button type="button" onClick={()=>{setError('');setCamera(v=>!v);}}>{camera?'Stop kamera':'Start kamera'}</button>{camera&&<video ref={video} muted playsInline style={{maxWidth:'100%',width:360}} aria-label="QR-kamera"/>}{error&&<p role="alert">{error}</p>}</div>;
}

export function QrWorkspace({company,permissions,open}:{company:string;permissions:string[];open:(ref:QrReference)=>void}){
 const [result,setResult]=useState<{ref:QrReference;label:string;active:boolean}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 async function read(ref:QrReference){const version=++generation.current;setResult(null);setError('');setBusy(true);
  try{
   const required=ref.kind==='pallet'?['inventory.read','production.read']:ref.kind==='order'?['production.read']:['masterdata.read'];
   if(!required.every(p=>permissions.includes(p)))throw new Error('Du har ikke adgang til denne type.');
   const row=await accessApi<{id:string;company_id?:string;name?:string;code?:string;active?:boolean}>(qrPath(ref));
   if(row.id!==ref.id||(row.company_id&&row.company_id!==company))throw new Error('Svaret matcher ikke QR-koden.');
   if(version===generation.current)setResult({ref,label:row.name??row.code??ref.id,active:row.active!==false});
  }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'Opslaget mislykkedes.');}finally{if(version===generation.current)setBusy(false);}
 }
 return <><p>Scan en palle, lagerplacering, produktionsordre eller maskine. Scanning ændrer ikke lageret.</p><QrInput company={company} onRead={ref=>void read(ref)}/>{busy&&<p role="status">Kontrollerer adgang og registrering…</p>}{error&&<p role="alert">{error}</p>}{result&&<section className="access-card"><h2>{result.label}</h2>{!result.active&&<p>Registreringen er inaktiv.</p>}<QrLabel company={company} kind={result.ref.kind} id={result.ref.id} label={result.label}/><button onClick={()=>open(result.ref)}>Åbn registrering</button></section>}</>;
}
