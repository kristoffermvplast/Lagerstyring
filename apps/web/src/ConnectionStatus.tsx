import {useEffect,useState} from 'react';
/** Browser connectivity is a hint, never proof that the backend accepted a command. */
export function ConnectionStatus(){
 const[offline,setOffline]=useState(()=>!navigator.onLine),[reconnected,setReconnected]=useState(false);
 useEffect(()=>{const down=()=>{setOffline(true);setReconnected(false);};const up=()=>{setOffline(false);setReconnected(true);};window.addEventListener('offline',down);window.addEventListener('online',up);return()=>{window.removeEventListener('offline',down);window.removeEventListener('online',up);};},[]);
 if(!offline&&!reconnected)return null;
 return <div className="connection-status" role="status" aria-live="polite">{offline?'Enheden er offline. Viste data kan være forældede. Behold en igangværende formular åben; registreringer sendes ikke automatisk senere.':'Enheden melder netværk igen. Kontrollér status og brug samme formular til genforsøg, hvis en registrering havde et usikkert svar.'}{!offline&&<button type="button" onClick={()=>setReconnected(false)}>Skjul netværksbesked</button>}</div>;
}
