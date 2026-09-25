import {Boxes, Home, Warehouse, Factory, ScanLine, Menu, X, ChevronDown, Database, Settings} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';

const groups = [
 ['Rapporter', ['Prognose', 'Rapporter']],
 ['Lager', ['Lager', 'Modtagelse', 'Lagerflytning', 'Reservationer', 'Pallestyring', 'Forsendelser', 'Optælling', 'Pallemellemværender']],
 ['Produktion', ['Produktion', 'Styklister og pakning', 'Maskiner']],
 ['Stamdata', ['Varer', 'Materialer', 'Emballage', 'Kunder', 'Leverandører', 'Lagerplaceringer', 'Produktgrupper', 'Enheder', 'Maskintyper', 'Materialetyper', 'Palletyper', 'Import']],
 ['Administration', ['Min profil', 'Adgang']],
] as const;
export function focusMenu(){
 window.dispatchEvent(new Event('workspace-menu-open'));
 requestAnimationFrame(()=>{const menu=document.getElementById('workspace-menu');
 if(menu)menu.scrollTop=0;menu?.scrollIntoView({block:'start'});menu?.focus({preventScroll:true});});
}
export function WorkspaceNavigation({pages,current,choose,children}:{pages:string[];current:string;choose:(page:string)=>void;children:ReactNode}){
 const [mobileOpen,setMobileOpen]=useState(false);
 useEffect(()=>{const show=()=>setMobileOpen(true);window.addEventListener('workspace-menu-open',show);return()=>window.removeEventListener('workspace-menu-open',show);},[]);
 const navigate=(page:string)=>{setMobileOpen(false);choose(page);};
 const icons:Record<string,typeof Home>={Rapporter:Home,Lager:Warehouse,Produktion:Factory,Stamdata:Database,Administration:Settings};
 const groupFor=(page:string)=>(page==='Overblik'||page==='Scan QR')?'':groups.find(([,items])=>(items as readonly string[]).includes(page))?.[0]??'Stamdata';
 const [expanded,setExpanded]=useState<string>(groupFor(current));
 useEffect(()=>setExpanded(groupFor(current)),[current]);
 const button=(name:string)=><button type="button" key={name} aria-current={current===name?'page':undefined} onClick={()=>navigate(name)}>{name}</button>;
 return <><aside id="workspace-menu" tabIndex={-1} aria-label="Arbejdsområder" className={"access-nav"+(mobileOpen?" mobile-open":"")} onKeyDown={e=>{if(e.key==='Escape'){setMobileOpen(false);document.getElementById('mobile-menu-button')?.focus();}}}>
 <div className="nav-brand"><Boxes aria-hidden="true"/>Lagerstyring</div><button className="close-navigation" onClick={()=>{setMobileOpen(false);document.getElementById("mobile-menu-button")?.focus();}}><X aria-hidden="true"/>Luk menu</button>{button('Overblik')}
 {groups.map(([name,items])=>{
 const visible=pages.filter(page=>(items as readonly string[]).includes(page)||name==='Stamdata'&&page!=='Scan QR'&&page!=='Overblik'&&!groups.some(([,known])=>(known as readonly string[]).includes(page)));
 const Icon=icons[name]??Home;return visible.length>0&&<section key={name} className="workspace-nav-group"><button type="button" aria-label={name+' — menu'} aria-expanded={expanded===name} aria-controls={'menu-'+name} onClick={()=>setExpanded(expanded===name?'':name)}><Icon aria-hidden="true"/><span>{name}</span><ChevronDown aria-hidden="true" className={expanded===name?"expanded":""}/></button><div id={'menu-'+name} hidden={expanded!==name}>{visible.map(button)}</div></section>;
 })}{pages.includes('Scan QR')&&<div className="nav-qr">{button('Scan QR')}</div>}<div className="nav-account">{children}</div></aside><nav className="mobile-bottom-nav" aria-label="Hurtig navigation">
 {([['Overblik','Hjem',Home],['Lager','Lager',Warehouse],['Scan QR','Scan',ScanLine]] as const).filter(([page])=>pages.includes(page)).map(([name,label,Icon])=><button key={name} aria-label={label+' — genvej'} aria-current={current===name?'page':undefined} onClick={()=>navigate(name)}><Icon aria-hidden="true"/>{label}</button>)}
 <button id="mobile-menu-button" aria-expanded={mobileOpen} aria-controls="workspace-menu" onClick={()=>mobileOpen?setMobileOpen(false):focusMenu()}><Menu aria-hidden="true"/>Menu</button></nav></>;
}
