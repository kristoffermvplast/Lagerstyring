import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, LayoutDashboard, Factory, Package, Layers, PackageOpen, ArrowDownToLine, Truck, Users, Building2, ChartNoAxesCombined, Settings2, Menu, X, ArrowUpRight, ChevronRight, CircleHelp } from 'lucide-react';
import { checkApi } from './api';

const groups = [
  { label: 'ARBEJDSOMRÅDER', links: [ ['Produktion', Factory], ['Lager', Boxes], ['Modtagelse', ArrowDownToLine], ['Forsendelser', Truck] ] },
  { label: 'KARTOTEKER', links: [ ['Varer', Package], ['Materialer', Layers], ['Emballage', PackageOpen], ['Kunder', Users], ['Leverandører', Building2] ] },
  { label: 'OVERBLIK', links: [ ['Pallestyring', Boxes], ['Rapporter', ChartNoAxesCombined], ['Administration', Settings2] ] },
] as const;

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const api = useQuery({ queryKey: ['api-live'], queryFn: checkApi, refetchInterval: 60000 });
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">Gå til indhold</a>
      {menuOpen && <button className="menu-scrim" aria-label="Luk menu" onClick={() => setMenuOpen(false)} />}
      <aside id="main-navigation" className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <a className="brand" href="/" aria-label="Lagerstyring, startside"><span className="brand-icon"><Boxes size={23} /></span><span>Lagerstyring<span className="brand-sub">LAGER & PRODUKTION</span></span></a>
        <button className="mobile-close icon-button" aria-label="Luk navigation" onClick={() => setMenuOpen(false)}><X size={22} /></button>
        <nav aria-label="Hovednavigation">
          <a className="nav-item active" href="/" aria-current="page"><LayoutDashboard size={19} />Overblik<span className="active-dot" /></a>
          {groups.map(group => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.links.map(([label, Icon]) => <button className="nav-item" key={label} disabled title="Tilføjes i en kommende fase"><Icon size={19} /><span>{label}</span></button>)}</div>)}
        </nav>
        <div className="sidebar-footer"><span className="small-mark">L</span><div>Dit arbejdsrum<small>Samlet ét sted</small></div></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><button className="mobile-toggle icon-button" aria-label="Åbn navigation" aria-controls="main-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={22} /></button><span>Arbejdsrum</span><ChevronRight size={14} /><strong>Overblik</strong></div>
          <span className="foundation-label"><span />Under opbygning</span>
        </header>
        <main id="content">
          <div className="page-heading"><div><p className="eyebrow">DIT ARBEJDSRUM</p><h1>Overblik</h1><p>Plads til hele vejen fra materiale til færdig vare.</p></div><button className="help-button" aria-expanded={helpOpen} aria-controls="about-workspace" onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={17} />Om arbejdsrummet</button></div>
          {helpOpen && <div className="help-panel" id="about-workspace">Dette er grundlayoutet. Login og arbejdsfunktioner tilføjes i de næste godkendte faser. Menuens øvrige områder er derfor endnu ikke aktive.</div>}
          <section className="welcome-card" aria-labelledby="welcome-title">
            <div className="welcome-copy"><span className="section-tag">ÉT SAMLET OVERBLIK</span><h2 id="welcome-title">Styr på lageret.<br />Ro i produktionen.</h2><p>Her får du overblik over beholdning, igangværende produktion og det, der skal videre.</p><div className="welcome-note"><span className="note-line" />Arbejdsrummet er klar til at blive bygget videre.</div></div>
            <div className="workflow-preview" aria-label="Systemets kommende arbejdsområder"><span className="preview-label">FRA MODTAGELSE TIL AFSENDELSE</span><div className="flow-row"><span className="flow-icon"><ArrowDownToLine size={21} /></span><div><strong>Modtag</strong><small>Materialer og emballage</small></div><span className="flow-number">01</span></div><div className="flow-row"><span className="flow-icon"><Factory size={21} /></span><div><strong>Producér</strong><small>Ordrer og materialeforbrug</small></div><span className="flow-number">02</span></div><div className="flow-row"><span className="flow-icon"><Truck size={21} /></span><div><strong>Send</strong><small>Varer, paller og forsendelser</small></div><span className="flow-number">03</span></div></div>
          </section>
          <div className="section-heading"><h2>Dine arbejdsområder</h2><span>Tilføjes i kommende faser</span></div>
          <div className="area-grid">
            {[{ title: 'Lager', text: 'Hvad har vi, og hvor står det?', Icon: Boxes, foot: 'Beholdning · Placeringer · Paller' }, { title: 'Produktion', text: 'Fra planlagt ordre til færdig vare.', Icon: Factory, foot: 'Ordrer · Materialer · Registrering' }, { title: 'Forsendelser', text: 'Overblik over det, der skal afsted.', Icon: Truck, foot: 'Reservation · Pluk · Afsendelse' }].map(({ title, text, Icon, foot }) => <article className="area-card" key={title}><div className="area-card-top"><span className="area-icon"><Icon size={23} /></span><ArrowUpRight size={18} className="muted-arrow" /></div><h3>{title}</h3><p>{text}</p><div className="area-card-footer">{foot}</div></article>)}
          </div>
          <section className="empty-state"><span className="empty-icon"><Layers size={23} /></span><div><h2>Et rent udgangspunkt</h2><p>Der er endnu ingen virksomhedsdata. Kartoteker og daglige arbejdsgange tilføjes trin for trin.</p></div></section>
          <footer className="page-footer"><span>Lagerstyring</span><span role="status" className="api-status"><span className={`status-dot ${api.data ? 'online' : ''}`} />{api.isPending ? 'Kontrollerer API-forbindelse…' : api.data ? 'API svarer' : 'API kan ikke nås'}</span></footer>
        </main>
      </div>
    </div>
  );
}
