import {useId,useRef,useState} from 'react';
type Option={id:string;code:string;name:string;active?:boolean};
/** Search text is never a business identifier; only an explicit option commits a value. */
export function SearchSelect({label,value,change,query,search,items,pending,error,retry,optional=false}:{label:string;value:string;change:(id:string)=>void;query:string;search:(q:string)=>void;items:Option[];pending:boolean;error:string;retry:()=>void;optional?:boolean}){
 const id=useId(),input=useRef<HTMLInputElement>(null),[open,setOpen]=useState(false),[index,setIndex]=useState(-1),[invalid,setInvalid]=useState(false);
 const remembered=useRef<Option|undefined>(undefined);
 const selected=items.find(x=>x.id===value)??(remembered.current?.id===value?remembered.current:undefined);
 if(selected)remembered.current=selected;
 const caption=selected?`${selected.code} · ${selected.name}`:value?'Valgt registrering':'';
 function choose(option:Option){setInvalid(false);remembered.current=option;change(option.id);setOpen(false);setIndex(-1);input.current?.focus();}
 return <div className="search-select" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
 <label htmlFor={id}>{label}</label>{!optional&&<small>Påkrævet</small>}
 <input id={id} ref={input} role="combobox" autoComplete="off" aria-expanded={open} aria-controls={id+'-options'} aria-autocomplete="list" aria-activedescendant={open&&!pending&&!error&&items[index]?id+'-'+index:undefined} aria-required={!optional} value={open?query:caption}
 onFocus={()=>{setOpen(true);setIndex(-1);}} onChange={e=>{search(e.target.value);setOpen(true);setIndex(-1);}}
 onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);setIndex(-1);}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setIndex(n=>Math.max(0,Math.min(items.length-1,n+(e.key==='ArrowDown'?1:-1))));}if(e.key==='Enter'&&open){e.preventDefault();if(items[index])choose(items[index]);}}}/>
 {value&&<small>Valgt: {caption} <button type="button" onClick={()=>{change('');search('');setOpen(true);input.current?.focus();}}>Ryd {label.toLowerCase()}</button></small>}
 <select className="selection-validity" tabIndex={-1} aria-label={label+' (valgt værdi)'} required={!optional} value={value} onChange={()=>{}} onInvalid={e=>{e.preventDefault();setInvalid(true);setOpen(true);input.current?.focus();}}><option value=""/>{value&&<option value={value}>{caption}</option>}</select>
 {invalid&&<p role="alert">Vælg {label.toLowerCase()} fra listen.</p>}
 {open&&<div className="search-options">
 {pending&&<p role="status">Søger…</p>}{error&&<div role="alert">{error}<button type="button" onClick={retry}>Prøv opslag igen</button></div>}
 <div id={id+'-options'} role="listbox" aria-label={label}>{!pending&&!error&&items.map((item,n)=><button type="button" role="option" aria-selected={value===item.id} id={id+'-'+n} key={item.id} data-value={item.id} data-highlighted={index===n} tabIndex={-1} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(item)}>{item.code} · {item.name}{item.active===false?' (inaktiv)':''}</button>)}</div>
 {!pending&&!error&&!items.length&&<p role="status">Ingen resultater. Prøv en anden søgning.</p>}{items.length>=100&&<small>Viser de første 100. Søg mere præcist.</small>}
 </div>}
 </div>;
}
