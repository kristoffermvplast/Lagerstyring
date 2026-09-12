import { FormEvent, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { authClient, accessApi } from './auth-client';
import { checkApi } from './api';
import { Masterdata, masterdataPages } from './Masterdata';
import { Inventory } from './Inventory';
import { Locations } from './Locations';
import { Recipes } from './Recipes';
import { Items, itemPages } from './Items';

type Me = { user: { id: string; display_name: string; email: string }; memberships: { company_id: string; name: string; role_id: string }[] };
type Role = { id: string; name: string; is_admin: boolean; permissions: string[] };
type Member = { display_name?: string; user_id: string; role_id: string; active: boolean; version: number };
const message = (e: unknown) => e instanceof Error ? e.message : 'Handlingen kunne ikke gennemføres.';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!authClient);
  const cache = useQueryClient();
  useEffect(() => {
    if (!authClient) return;
    let alive = true;
    const { data: { subscription } } = authClient.auth.onAuthStateChange((_event, value) => {
      if (!alive) return;
      cache.clear(); setSession(value); setLoading(false);
      if (_event === 'SIGNED_IN') void authClient!.auth.startAutoRefresh();
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [cache]);
  if (loading) return <main className="auth-page"><p role="status">Kontrollerer din session…</p></main>;
  return session ? <Workspace key={session.user.id} localLogout={()=>{authClient!.auth.stopAutoRefresh();window.sessionStorage.removeItem('lager-auth-session');cache.clear();setSession(null);}} /> : <Login />;
}
function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy,setBusy] = useState(false);
  const api = useQuery({ queryKey: ['api-live'], queryFn: checkApi, retry: false });
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!authClient || busy) return;
    setBusy(true); setError('');
    try {
      const result = await authClient.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) setError('Login mislykkedes. Kontrollér e-mail og adgangskode, og prøv igen.');
    } catch { setError('Login kan ikke nås. Prøv igen.'); }
    finally { setPassword(''); setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><Boxes />Lagerstyring</div><h1>Velkommen tilbage</h1><p>Log ind for at åbne dit arbejdsrum.</p>
    <form onSubmit={submit}><label>E-mail<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <label>Adgangskode<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
    <button className="primary" disabled={!authClient || busy}>{busy ? 'Logger ind…' : 'Log ind'}</button></form>
    {!authClient && <p role="status">Login er endnu ikke tilgængeligt i dette miljø.</p>}{error && <p role="alert">{error}</p>}
    <p className="hint">Mangler du adgang eller har du glemt din adgangskode? Kontakt din administrator.</p>
    <p className="hint" role="status">{api.isPending ? 'Kontrollerer API-forbindelse…' : api.data ? 'API svarer' : 'API kan ikke nås'}</p>
  </section></main>;
}
function Workspace({localLogout}:{localLogout:()=>void}) {
  const cache = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: ()=>accessApi<Me>('/me'), retry: false });
  const [company,setCompany] = useState(''); const [page,setPage] = useState('Overblik'); const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const memberships = me.data?.memberships ?? [];
  const selected = memberships.find(m=>m.company_id===company) ?? memberships[0];
  const id = selected?.company_id;
  const access = useQuery({ queryKey: ['access',id], queryFn: ()=>accessApi<{ permissions: { code: string }[] }>(`/companies/${id}/access`), enabled: !!id, retry: false, refetchOnWindowFocus: true });
  const canRead = access.data?.permissions.some(p=>p.code==='access.read') ?? false;
  const canManage = access.data?.permissions.some(p=>p.code==='access.manage') ?? false;
  const canMasterRead = access.data?.permissions.some(p=>p.code==='masterdata.read') ?? false;
  const canInventoryRead=access.data?.permissions.some(p=>p.code==='inventory.read')??false;
  const canInventoryAdjust=access.data?.permissions.some(p=>p.code==='inventory.adjust')??false;
  const canMasterManage = access.data?.permissions.some(p=>p.code==='masterdata.manage') ?? false;
  async function logout() {
    if (busy) return; setBusy(true); setError('');
    try {
      await accessApi('/auth/logout','POST');
      await authClient!.auth.signOut({ scope: 'local' });
      localLogout();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <div className="access-shell"><a className="skip-link" href="#content">Gå til indhold</a><header className="access-header"><div className="auth-brand"><Boxes />Lagerstyring</div><button onClick={logout} disabled={busy}>Log ud</button></header>
    <div className="access-body"><aside className="access-nav"><label>Virksomhed<select aria-label="Virksomhed" value={id ?? ''} onChange={e=>{setCompany(e.target.value);setPage('Overblik');cache.removeQueries({queryKey:['members']});cache.removeQueries({queryKey:['roles']});}}>
      {!memberships.length && <option value="">Ingen virksomhed</option>}{memberships.map(m=><option key={m.company_id} value={m.company_id}>{m.name}</option>)}</select></label>
      {['Overblik',...(canInventoryRead?['Lager']:[]),...(canMasterRead?[...Object.keys(itemPages),'Styklister og pakning','Lagerplaceringer',...Object.keys(masterdataPages)]:[]),'Min profil',...(canRead?['Adgang']:[])].map(name=><button key={name} aria-current={page===name?'page':undefined} onClick={()=>setPage(name)}>{name}</button>)}</aside>
    <main id="content" className="access-content"><h1>{page}</h1>{error && <div role="alert"><p>{error}</p><button onClick={localLogout}>Luk kun sessionen på denne enhed</button><p>Serverens logout er ikke bekræftet, hvis forbindelsen fejlede.</p></div>}{me.isPending && <p role="status">Henter dit arbejdsrum…</p>}{me.error && <p role="alert">{message(me.error)}</p>}{access.error && <p role="alert">{message(access.error)}</p>}
      {me.data && page==='Min profil' && <Profile me={me.data} />}
      {me.data && page==='Overblik' && <section className="auth-card"><h2>Hej{me.data.user.display_name ? `, ${me.data.user.display_name}` : ''}</h2><p>{id ? `Du er logget ind hos ${selected.name}.` : 'Du har endnu ingen aktiv virksomhedsadgang. Kontakt en administrator og oplys dit bruger-ID fra Min profil.'}</p><p>Vælg et kartotek i menuen. Produktion tilføjes i senere faser.</p></section>}
      {id && canMasterRead && masterdataPages[page] && <Masterdata key={id+':'+page} company={id} kind={masterdataPages[page]} title={page} canManage={canMasterManage}/> }
      {id && canMasterRead && itemPages[page] && <Items key={id+':'+page} company={id} kind={itemPages[page]} title={page} canManage={canMasterManage}/> }
      {id && canMasterRead && page==='Styklister og pakning' && <Recipes key={id} company={id} canManage={canMasterManage}/>}
      {id && canInventoryRead && page==='Lager' && <Inventory key={id} company={id} canAdjust={canInventoryAdjust} canMasterRead={canMasterRead}/>}
      {id && canMasterRead && page==='Lagerplaceringer' && <Locations key={id} company={id} canManage={canMasterManage}/>}
      {page==='Adgang' && id && canRead && <Administration key={id} company={id} canManage={canManage} />}
    </main></div></div>;
}
function Profile({me}: {me:Me}) {
  const [name,setName]=useState(me.user.display_name); const [status,setStatus]=useState(''); const [busy,setBusy]=useState(false); const cache=useQueryClient();
  async function save(e:FormEvent) {e.preventDefault();setBusy(true);try{await accessApi('/me','PATCH',{displayName:name});await cache.invalidateQueries({queryKey:['me']});setStatus('Profilen er gemt.');}catch(e){setStatus(message(e));}finally{setBusy(false);}}
  return <section className="auth-card"><form onSubmit={save}><label>Dit navn<input required maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label><p>{me.user.email}</p><label>Bruger-ID<input readOnly value={me.user.id} onFocus={e=>e.target.select()}/></label><button className="primary" disabled={busy}>Gem profil</button></form><p role="status">{status}</p></section>;
}
function Administration({company,canManage}:{company:string;canManage:boolean}) {
  const cache=useQueryClient(); const prefix=`/companies/${company}`;
  const members=useQuery({queryKey:['members',company],queryFn:()=>accessApi<Member[]>(`${prefix}/members`),retry:false});
  const roles=useQuery({queryKey:['roles',company],queryFn:()=>accessApi<Role[]>(`${prefix}/roles`),retry:false});
  const audit=useQuery({queryKey:['audit',company],queryFn:()=>accessApi<{id:string;action:string;occurred_at:string}[]>(`${prefix}/access-audit`),retry:false});
  const [status,setStatus]=useState(''); const [busy,setBusy]=useState(false); const [userId,setUserId]=useState(''); const [roleId,setRoleId]=useState('');
  const [editing,setEditing]=useState(''); const [roleName,setRoleName]=useState(''); const [read,setRead]=useState(false); const [manage,setManage]=useState(false); const [masterRead,setMasterRead]=useState(false); const [masterManage,setMasterManage]=useState(false); const [inventoryRead,setInventoryRead]=useState(false); const [inventoryAdjust,setInventoryAdjust]=useState(false);
  async function mutate(path:string,method:string,body:unknown) {if(busy)return;setBusy(true);setStatus('');try{await accessApi(prefix+path,method,body);await cache.invalidateQueries();setStatus('Ændringen er gemt.');}catch(e){setStatus(message(e));}finally{setBusy(false);}}
  return <><p>Administrér adgangen til den valgte virksomhed.</p>{[members.error,roles.error,audit.error].filter(Boolean).map((e,i)=><p role="alert" key={i}>{message(e)}</p>)}<p role="status">{status}</p>
  <section className="access-card"><h2>Medlemmer</h2><div className="table-scroll"><table><thead><tr><th>Bruger-ID</th><th>Rolle</th><th>Status</th>{canManage&&<th>Handling</th>}</tr></thead><tbody>{members.data?.map(m=><MemberRow key={m.user_id+':'+m.version} member={m} roles={roles.data??[]} canManage={canManage} busy={busy} save={(body)=>mutate(`/members/${m.user_id}`,'PATCH',body)}/>)}</tbody></table></div>
  {canManage&&<form className="inline-form" onSubmit={e=>{e.preventDefault();void mutate('/members','POST',{userId,roleId});}}><label>Bruger-ID<input required value={userId} onChange={e=>setUserId(e.target.value)} placeholder="Fra brugerens Min profil"/></label><label>Rolle<select required value={roleId} onChange={e=>setRoleId(e.target.value)}><option value="">Vælg rolle</option>{roles.data?.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></label><button disabled={busy}>Tilføj medlem</button></form>}</section>
  <section className="access-card"><h2>Roller og rettigheder</h2>{roles.data?.map(r=><div className="role-row" key={r.id}><strong>{r.name}</strong><span>{r.is_admin?'Alle virksomhedens rettigheder':r.permissions.join(', ')||'Ingen administrationsrettigheder'}</span>{canManage&&!r.is_admin&&<button onClick={()=>{setEditing(r.id);setRoleName(r.name);setRead(r.permissions.includes('access.read'));setManage(r.permissions.includes('access.manage'));setMasterRead(r.permissions.includes('masterdata.read'));setMasterManage(r.permissions.includes('masterdata.manage'));setInventoryRead(r.permissions.includes('inventory.read'));setInventoryAdjust(r.permissions.includes('inventory.adjust'));}}>Redigér</button>}</div>)}
  {canManage&&<form onSubmit={e=>{e.preventDefault();void mutate(editing?`/roles/${editing}`:'/roles',editing?'PATCH':'POST',{name:roleName,permissions:[...(read?['access.read']:[]),...(manage?['access.manage']:[]),...(masterRead?['masterdata.read']:[]),...(masterManage?['masterdata.manage']:[]),...(inventoryRead?['inventory.read']:[]),...(inventoryAdjust?['inventory.adjust']:[])]});}}><h3>{editing?'Redigér rolle':'Ny rolle'}</h3><label>Rollenavn<input required maxLength={80} value={roleName} onChange={e=>setRoleName(e.target.value)}/></label><label className="check"><input type="checkbox" checked={read} onChange={e=>{setRead(e.target.checked);if(!e.target.checked)setManage(false);}}/>Se brugere og roller</label><label className="check"><input type="checkbox" checked={manage} onChange={e=>{setManage(e.target.checked);if(e.target.checked)setRead(true);}}/>Administrér adgang, inklusive administratorroller</label><label className="check"><input type="checkbox" checked={masterRead} onChange={e=>{setMasterRead(e.target.checked);if(!e.target.checked)setMasterManage(false);}}/>Se stamdata og historik</label><label className="check"><input type="checkbox" checked={masterManage} onChange={e=>{setMasterManage(e.target.checked);if(e.target.checked)setMasterRead(true);}}/>Oprette og ændre stamdata</label><label className="check"><input type="checkbox" checked={inventoryRead} onChange={e=>{setInventoryRead(e.target.checked);if(!e.target.checked)setInventoryAdjust(false);}}/>Se lager og posteringer</label><label className="check"><input type="checkbox" checked={inventoryAdjust} onChange={e=>{setInventoryAdjust(e.target.checked);if(e.target.checked)setInventoryRead(true);}}/>Lagerkorrektioner og ejere</label><button disabled={busy}>{editing?'Gem rolle':'Opret rolle'}</button>{editing&&<button type="button" onClick={()=>{setEditing('');setRoleName('');setRead(false);setManage(false);setMasterRead(false);setMasterManage(false);setInventoryRead(false);setInventoryAdjust(false);}}>Annullér redigering</button>}</form>}</section>
  <section className="access-card"><h2>Seneste adgangsændringer</h2>{audit.data?.length?audit.data.map(a=><p key={a.id}>{new Date(a.occurred_at).toLocaleString('da-DK')} · {a.action}</p>):<p>Ingen adgangsændringer registreret.</p>}</section></>;
}
function MemberRow({member,roles,canManage,busy,save}:{member:Member;roles:Role[];canManage:boolean;busy:boolean;save:(body:unknown)=>Promise<void>}) {
  const [roleId,setRoleId]=useState(member.role_id); const [active,setActive]=useState(member.active);
  return <tr><td className="user-id"><strong>{member.display_name || 'Navn ikke angivet'}</strong><br/>{member.user_id}</td><td>{canManage?<select aria-label={`Rolle for ${member.user_id}`} value={roleId} onChange={e=>setRoleId(e.target.value)}>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>:roles.find(r=>r.id===roleId)?.name}</td><td>{canManage?<label className="check"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>Aktiv</label>:active?'Aktiv':'Inaktiv'}</td>{canManage&&<td><button disabled={busy||(roleId===member.role_id&&active===member.active)} onClick={()=>{if(window.confirm('Gem ændringen? Brugerens adgang til virksomheden ændres med det samme.'))void save({roleId,active,version:member.version});}}>Gem</button></td>}</tr>;
}
