import {ArrowDownToLine, ArrowLeftRight, Factory, Truck, ArrowUpRight} from 'lucide-react';
import type {ReactNode} from 'react';

export function Surface({title,children,className=''}:{title:string;children:ReactNode;className?:string}){
 return <section className={'access-card '+className}><h2>{title}</h2>{children}</section>;
}
/** Navigation only: existing workspaces retain their own action permissions and validation. */
export function QuickActions({pages,choose}:{pages:string[];choose:(page:string)=>void}){
 const actions=[{page:'Modtagelse',title:'Modtag varer',detail:'Registrér modtagelse',Icon:ArrowDownToLine},{page:'Lagerflytning',title:'Flyt varer',detail:'Mellem placeringer',Icon:ArrowLeftRight},{page:'Produktion',title:'Produktion',detail:'Ordrer og opgaver',Icon:Factory},{page:'Forsendelser',title:'Forsendelser',detail:'Klargør forsendelse',Icon:Truck}];
 return <nav className="quick-actions" aria-label="Dagens opgaver">{actions.filter(a=>pages.includes(a.page)).map(({page,title,detail,Icon})=><button key={page} onClick={()=>choose(page)}><Icon aria-hidden="true"/><strong>{title}</strong><span>{detail}</span><ArrowUpRight className="quick-arrow" aria-hidden="true"/></button>)}</nav>;
}
export function StatusBadge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'attention'}){
 return <span className={'status-badge status-'+tone}>{children}</span>;
}
