import {useEffect, useState, type ReactNode} from 'react';

const groups = [
 ['Overblik', ['Overblik', 'Prognose', 'Rapporter']],
 ['Lager', ['Lager', 'Modtagelse', 'Lagerflytning', 'Reservationer', 'Pallestyring', 'Forsendelser', 'Optælling', 'Pallemellemværender']],
 ['Produktion', ['Produktion', 'Styklister og pakning', 'Maskiner']],
 ['Stamdata', ['Varer', 'Materialer', 'Emballage', 'Kunder', 'Leverandører', 'Lagerplaceringer', 'Produktgrupper', 'Enheder', 'Maskintyper', 'Materialetyper', 'Palletyper', 'Import']],
 ['Administration', ['Min profil', 'Adgang']],
] as const;
export function focusMenu(){
 const menu=document.getElementById('workspace-menu');
 if(menu)menu.scrollTop=0;menu?.scrollIntoView({block:'start'});menu?.focus({preventScroll:true});
}
export function WorkspaceNavigation({pages,current,choose,children}:{pages:string[];current:string;choose:(page:string)=>void;children:ReactNode}){
 const groupFor=(page:string)=>groups.find(([,items])=>(items as readonly string[]).includes(page))?.[0]??'Stamdata';
 const [expanded,setExpanded]=useState<string>(groupFor(current));
 useEffect(()=>setExpanded(groupFor(current)),[current]);
 const button=(name:string)=><button type="button" key={name} aria-current={current===name?'page':undefined} onClick={()=>choose(name)}>{name}</button>;
 return <aside id="workspace-menu" tabIndex={-1} aria-label="Arbejdsområder" className="access-nav">
 {children}{pages.includes('Scan QR')&&button('Scan QR')}
 {groups.map(([name,items])=>{
 const visible=pages.filter(page=>(items as readonly string[]).includes(page)||name==='Stamdata'&&page!=='Scan QR'&&!groups.some(([,known])=>(known as readonly string[]).includes(page)));
 return visible.length>0&&<section key={name} className="workspace-nav-group"><button type="button" aria-label={name+' — menu'} aria-expanded={expanded===name} aria-controls={'menu-'+name} onClick={()=>setExpanded(expanded===name?'':name)}>{name}<span aria-hidden="true">{expanded===name?'−':'+'}</span></button><div id={'menu-'+name} hidden={expanded!==name}>{visible.map(button)}</div></section>;
 })}</aside>;
}
