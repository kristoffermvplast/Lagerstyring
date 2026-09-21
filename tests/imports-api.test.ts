import {createRequire} from 'node:module';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,ids,asUser} from './helpers/access-fixture';
const require=createRequire(import.meta.url),{ImportsController}=require('../apps/api/dist/imports.js'),{parseImportCsv}=require('../apps/api/dist/import-csv.js');
let db:Awaited<ReturnType<typeof fixture>>,service:any,imports:any;
const actor={userId:ids.adminA,sessionId:ids.session},reader={userId:ids.reader,sessionId:ids.sessionRead};
const preview=(kind:string,csv:string,a=actor,c=ids.a)=>imports.preview({actor:a},c,kind,{filename:'test.csv',csv});
const confirm=(kind:string,id:string,a=actor,c=ids.a)=>imports.confirm({actor:a},c,kind,id,{confirm:true});
const count=async(table:string)=>(await db.query<any>(`select count(*)::int as n from app.${table}`)).rows[0].n;
beforeAll(async()=>{
 db=await fixture();const {DatabaseService}=require('../apps/api/dist/database.js'),{loadConfig}=require('../apps/api/dist/config.js');service=new DatabaseService(loadConfig({NODE_ENV:'test'}));service.pool={connect:async()=>({query:async(sql:string,values?:unknown[])=>{if(sql.startsWith('BEGIN')){await db.exec('BEGIN; SET LOCAL ROLE app_backend;');return{rows:[]};}return db.query(sql,values);},release:()=>{}})};imports=new ImportsController(service);
 await asUser(db,ids.adminA,ids.a,async()=>{
  await db.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Kilogram','kg','mass'),($1,'PCS','Pieces','pcs','count')",[ids.a]);
  await db.query("insert into app.stock_owners(company_id,code,name,kind) values($1,'OWN','Own','company')",[ids.a]);
  await db.query("insert into app.locations(company_id,code,name) values($1,'L','Location')",[ids.a]);
 });
},30000);
afterAll(async()=>{await db.close();});
it('parses BOM, semicolons, quoted separators, escaped quotes and multiline cells; rejects malformed and oversized files',()=>{
 expect(parseImportCsv('\uFEFFcode;name\r\nA;"A; \"\"quote\"\"\nline"\r\n').rows).toEqual([{code:'A',name:'A; "quote"\nline'}]);
 for(const csv of ['code,code\nA,B','code,name\nA','code,name\nA,"bad','code,name\nA,"bad"x','code,name\nA,b\0','code,name\n','code,name\n'+('A,B\n'.repeat(101)),'x'.repeat(32769)])expect(()=>parseImportCsv(csv)).toThrow();
});
it('requires only code and name for contacts, previews before writes and traces all created rows',async()=>{
 const n=await count('customers'),p=await preview('customers','code;name\nC1;First customer\nC2;Second customer');expect(p.errors).toEqual([]);expect(p.rows).toHaveLength(2);expect(await count('customers')).toBe(n);
 const r=await confirm('customers',p.job_id);expect(r.receipt.result).toHaveLength(2);expect(await count('customers')).toBe(n+2);expect(await count('masterdata_audit')).toBeGreaterThan(1);
 const repeat=await confirm('customers',p.job_id);expect(repeat.replayed).toBe(true);expect(repeat.receipt.id).toBe(r.receipt.id);expect(await count('customers')).toBe(n+2);
 expect((await imports.history({actor},ids.a,'customers')).items[0].sha256).toBe(p.sha256);
});
it('reports per-row errors and rejects the whole file before saving any business records',async()=>{
 const n=await count('customers'),jobs=await count('import_jobs');
 const p=await preview('customers','code;name;email\nNEW;Valid;\nC1;Duplicate;\nX;Invalid;bad-email');
 expect(p.job_id).toBeNull();expect(p.errors.map((e:any)=>e.row)).toEqual([3,4]);expect(await count('customers')).toBe(n);expect(await count('import_jobs')).toBe(jobs);
 const duplicate=await preview('customers','code;name\nA;First\na;Again');expect(duplicate.errors[0].row).toBe(3);
 expect((await preview('customers','code;name;sql\nA;Name;DROP')).errors[0].field).toBe('sql');
});
it('imports suppliers, products and materials using optional existing codes, rejects unknown/cross-tenant references',async()=>{
 const s=await preview('suppliers','code;name;lead_time_days\nS1;Supplier;7');expect(s.errors).toEqual([]);await confirm('suppliers',s.job_id);
 const p=await preview('products','code;name;unit_code;customer_code\nP1;Product;PCS;C1');expect(p.errors).toEqual([]);await confirm('products',p.job_id);
 const m=await preview('materials','code;name;unit_code;supplier_code\nM1;Material;KG;S1');expect(m.errors).toEqual([]);await confirm('materials',m.job_id);
 const minimal=await preview('materials','code;name\nM2;No stock unit yet');expect(minimal.errors).toEqual([]);await confirm('materials',minimal.job_id);
 expect((await preview('materials','code;name;unit_code\nM3;Bad;MISSING')).errors[0].field).toBe('unit_code');
 expect((await preview('products','code;name\nM1;Cross kind duplicate')).errors[0].field).toBe('code');
 expect((await preview('suppliers','code;name;lead_time_days\nS2;Bad;1.5')).errors.length).toBeGreaterThan(0);
});
it('posts exact opening quantities through the journal with snapshots and prevents repeated opening stock',async()=>{
 const p=await preview('opening_stock','item_code;owner_code;location_code;quantity\nM1;OWN;L;100.00000001\nP1;OWN;L;3');expect(p.errors).toEqual([]);
 const r=await confirm('opening_stock',p.job_id);expect(r.receipt.result).toHaveLength(2);
 const lines=(await db.query<any>('select quantity::text,snapshot from app.inventory_lines order by app.inventory_lines.quantity')).rows;expect(lines.map(x=>x.quantity)).toEqual(['3.00000000','100.00000001']);expect(lines[0].snapshot.item.code).toBe('P1');
 expect((await db.query<any>('select reference from app.inventory_entries')).rows[0].reference).toBe('Import '+p.job_id);
 await confirm('opening_stock',p.job_id);expect(await count('inventory_entries')).toBe(1);
 const again=await preview('opening_stock','item_code;owner_code;location_code;quantity\nM1;OWN;L;2');expect(again.job_id).toBeNull();expect(again.errors[0].message).toContain('lagerhistorik');
});
it('rejects zero/negative/floating precision, fractional pieces, absent units and unknown inventory references',async()=>{
 for(const [item,q] of [['M1','0'],['M1','-1'],['M1','1e3'],['M1','0.000000001'],['P1','1.5'],['M2','2'],['MISSING','2']]){
  const p=await preview('opening_stock',`item_code;owner_code;location_code;quantity\n${item};OWN;L;${q}`);expect(p.job_id).toBeNull();expect(p.errors.length).toBeGreaterThan(0);
 }
});
it('revalidates at commit, preserving atomicity when a duplicate appears after preview',async()=>{
 const p=await preview('customers','code;name\nRACE1;New\nRACE2;New');
 await asUser(db,ids.adminA,ids.a,async()=>{await db.query("insert into app.customers(company_id,code,name) values($1,'RACE2','Concurrent')",[ids.a]);});
 const r=await confirm('customers',p.job_id);expect(r.receipt).toBeNull();expect(r.errors[0].row).toBe(3);expect((await db.query("select id from app.customers where code='RACE1'")).rows).toHaveLength(0);
});
it('rolls back all business writes if the receipt cannot be saved',async()=>{
 const p=await preview('customers','code;name\nROLL1;First\nROLL2;Second');
 const original=service.pool;service.pool={connect:async()=>{const c=await original.connect();return{...c,query:async(sql:string,v:unknown[])=>{if(sql.startsWith('insert into app.import_receipts'))throw new Error('Injected receipt failure');return c.query(sql,v);}};}};
 try{await expect(confirm('customers',p.job_id)).rejects.toThrow('Injected');}finally{service.pool=original;}
 expect((await db.query("select id from app.customers where code like 'ROLL%'")).rows).toHaveLength(0);
});
it('enforces permissions, tenant/job scope, strict confirmation and revoked sessions',async()=>{
 await expect(preview('customers','code;name\nA;B',reader)).rejects.toMatchObject({status:403});
 await expect(preview('customers','code;name\nA;B',actor,ids.b)).rejects.toMatchObject({status:403});
 const p=await preview('customers','code;name\nSCOPE;Scope');
 await expect(confirm('suppliers',p.job_id)).rejects.toMatchObject({status:404});
 expect(()=>imports.confirm({actor},ids.a,'customers',p.job_id,{confirm:false})).toThrow();
 await expect(confirm('customers',p.job_id,{userId:ids.adminB,sessionId:ids.sessionB},ids.b)).rejects.toMatchObject({status:404});
 await db.query('delete from auth.sessions where id=$1',[ids.session]);await expect(confirm('customers',p.job_id)).rejects.toBeDefined();await db.query('insert into auth.sessions values($1,$2)',[ids.session,ids.adminA]);
});
it('deduplicates equivalent files with reordered columns and returns the original receipt',async()=>{
 const a=await preview('customers','code;name\nSAME;Equivalent'),b=await preview('customers','name;code\nEquivalent;SAME');
 expect(a.sha256).toBe(b.sha256);const first=await confirm('customers',a.job_id),again=await confirm('customers',b.job_id);expect(again.receipt.id).toBe(first.receipt.id);
});
it('blocks changed reference targets and expired previews without writing masterdata',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{await db.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'SWAP','Old','s','mass')",[ids.a]);});
 const p=await preview('materials','code;name;unit_code\nSTALE;Stale;SWAP');
 await asUser(db,ids.adminA,ids.a,async()=>{await db.query("update app.units set code='OLD-SWAP',version=version+1 where company_id=$1 and code='SWAP'",[ids.a]);await db.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'SWAP','New','s','mass')",[ids.a]);});
 const r=await confirm('materials',p.job_id);expect(r.errors[0].message).toContain('Referencer er ændret');expect(r.receipt).toBeNull();
 await db.exec('alter table app.import_jobs disable trigger user');try{await db.query("update app.import_jobs set created_at=now()-interval '2 days' where id=$1",[p.job_id]);}finally{await db.exec('alter table app.import_jobs enable trigger user');}
 await expect(confirm('materials',p.job_id)).rejects.toMatchObject({status:409});
});
it('keeps jobs/receipts immutable and denied to browser roles and cross-company SQL reads',async()=>{
 await expect(asUser(db,ids.adminA,ids.a,async()=>{await db.query('delete from app.import_jobs');})).rejects.toBeDefined();
 await asUser(db,ids.adminB,ids.b,async()=>{expect((await db.query('select * from app.import_jobs')).rows).toHaveLength(0);expect((await db.query('select * from app.import_receipts')).rows).toHaveLength(0);},ids.sessionB);
 for(const role of ['anon','authenticated'])expect((await db.query<any>("select has_table_privilege($1,'app.import_jobs','SELECT') as allowed",[role])).rows[0].allowed).toBe(false);
});
it('registers preview, template, confirm and history behind HTTP auth',async()=>{
 const {createApp}=require('../apps/api/dist/app.js'),{loadConfig}=require('../apps/api/dist/config.js');const app=await createApp(loadConfig({NODE_ENV:'test'}),service);await app.listen(0,'127.0.0.1');try{
  for(const [path,method] of [['/customers/template','GET'],['/customers/history','GET'],['/customers/preview','POST'],['/customers/'+crypto.randomUUID()+'/confirm','POST']])expect((await fetch((await app.getUrl())+'/api/companies/'+ids.a+'/imports'+path,{method})).status).toBe(401);
 }finally{await app.close();}
});
