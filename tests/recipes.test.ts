import { beforeAll, afterAll, it, expect } from 'vitest';
import { fixture, ids, asUser } from './helpers/access-fixture';
import { calculate } from '../apps/api/src/recipe-calculation';
let db:Awaited<ReturnType<typeof fixture>>,product:string,material:string,box:string,pallet:string,frame:string,bom:string,pack:string,bomRev:string,packRev:string;
const actor=<T>(work:()=>Promise<T>)=>asUser(db,ids.adminA,ids.a,work);
async function recipe(kind:string,name:string){return(await db.query<{id:string}>('insert into app.recipes(company_id,product_id,kind,name) values($1,$2,$3,$4) returning id',[ids.a,product,kind,name])).rows[0].id;}
async function publish(id:string,lines:{component_id:string;kind:string;level?:number;quantity:string}[],base='1'){
 const rev=(await db.query<{id:string}>('insert into app.recipe_revisions(company_id,recipe_id,revision,base_quantity) select $1,$2,coalesce(max(revision),0)+1,$3 from app.recipe_revisions where recipe_id=$2 returning id',[ids.a,id,base])).rows[0].id;
 for(const l of lines)await db.query('insert into app.recipe_lines(company_id,revision_id,component_id,kind,level,quantity) values($1,$2,$3,$4,$5,$6)',[ids.a,rev,l.component_id,l.kind,l.level??0,l.quantity]);
 await db.query('update app.recipe_revisions set sealed=true where id=$1',[rev]);await db.query('update app.recipes set current_revision_id=$2,version=version+1 where id=$1',[id,rev]);return rev;
}
async function load(id:string){return{...(await db.query<any>('select * from app.recipe_revisions where id=$1',[id])).rows[0],lines:(await db.query<any>('select * from app.recipe_lines where revision_id=$1',[id])).rows};}
beforeAll(async()=>{
 db=await fixture();await actor(async()=>{
  const unit=(await db.query<{id:string}>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'EA','Each','stk.','count') returning id",[ids.a])).rows[0].id;
  const mass=(await db.query<{id:string}>("insert into app.units(company_id,code,name,symbol,dimension) values($1,'KG','Mass','kg','mass') returning id",[ids.a])).rows[0].id;
  const made=[];for(const [code,kind,u]of[['P','product',unit],['M','material',mass],['B','packaging',unit],['PAL','packaging',unit],['F','packaging',unit]])made.push((await db.query<{id:string}>('insert into app.items(company_id,code,name,kind,unit_id) values($1,$2,$2,$3,$4) returning id',[ids.a,code,kind,u])).rows[0].id);
  [product,material,box,pallet,frame]=made;bom=await recipe('bom','BOM');pack=await recipe('packing','Packing');
  bomRev=await publish(bom,[{component_id:material,kind:'component',quantity:'0.00825'}]);
  packRev=await publish(pack,[{component_id:box,kind:'container',quantity:'12'},{component_id:pallet,kind:'container',level:1,quantity:'42'},{component_id:frame,kind:'accessory',level:1,quantity:'3'}]);
 });
});
afterAll(async()=>{await db?.close();});
it('calculates exact multi-material requirements and full/partial nested packs',async()=>{await actor(async()=>{
 const result=calculate('1009',await load(bomRev),await load(packRev));expect(result.materials[0].quantity).toBe('8.32425');expect(result.containers.map(x=>[x.count,x.capacity,x.full,x.partial,x.remainder])).toEqual([['85','12','84','1','1'],['3','504','2','1','1']]);expect(result.packaging.map(x=>x.quantity)).toEqual(['85','3','9']);
 const b=await load(bomRev);b.base_quantity='12';b.lines[0].quantity='1';expect(calculate('1',b).materials[0].quantity).toBe('0.08333334');expect(calculate('12',b).materials[0].quantity).toBe('1');
 b.base_quantity='1';b.lines[0].quantity='999999999999.99999999';expect(calculate('999999999999',b).materials[0].quantity).toBe('999999999998999999990000.00000001');
});});
it('preserves snapshots and old revision after master changes and a new revision',async()=>{await actor(async()=>{
 await db.query("update app.items set name='Renamed',version=version+1 where id=$1",[material]);await publish(bom,[{component_id:material,kind:'component',quantity:'0.02'}]);expect((await load(bomRev)).lines[0].snapshot.name).toBe('M');expect(calculate('1000',await load(bomRev)).materials[0].quantity).toBe('8.25');
});});
it('blocks changes, inserts into sealed versions and partial commits',async()=>{
 for(const sql of ['delete from app.recipe_lines','update app.recipe_lines set quantity=2','update app.recipe_revisions set snapshot=\'{}\'','update app.recipes set product_id=product_id'])await expect(actor(()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
 await expect(actor(()=>db.query('update app.recipe_revisions set sealed=false where id=$1',[bomRev]))).rejects.toMatchObject({code:'23514'});
 await expect(actor(()=>db.query("insert into app.recipe_lines(company_id,revision_id,component_id,kind,quantity) values($1,$2,$3,'component',1)",[ids.a,bomRev,box]))).rejects.toMatchObject({code:'23514'});
 await expect(actor(()=>db.query('insert into app.recipe_revisions(company_id,recipe_id,revision) values($1,$2,99)',[ids.a,bom]))).rejects.toMatchObject({code:'23514'});
});
it('rejects double consumption, malformed packing, fractional containers and self-reference atomically',async()=>{
 await expect(actor(()=>publish(bom,[{component_id:box,kind:'component',quantity:'1'}]))).rejects.toMatchObject({code:'23514'});
 for(const lines of [[{component_id:box,kind:'container',level:1,quantity:'12'}],[{component_id:box,kind:'container',quantity:'12.5'}],[{component_id:material,kind:'container',quantity:'12'}],[{component_id:box,kind:'container',quantity:'12'},{component_id:frame,kind:'accessory',level:2,quantity:'1'}]])await expect(actor(()=>publish(pack,lines))).rejects.toMatchObject({code:'23514'});
 await expect(actor(()=>publish(bom,[{component_id:product,kind:'component',quantity:'1'}]))).rejects.toMatchObject({code:'23514'});
 await actor(async()=>{expect((await db.query<any>('select count(*)::int as n from app.recipe_revisions where recipe_id=$1',[pack])).rows[0].n).toBe(1);});
});
it('enforces one default, revision ownership, historical conflict and reactivation guard',async()=>{
 await actor(async()=>{await db.query('update app.recipes set is_default=true,version=version+1 where id=$1',[pack]);});
 await expect(actor(()=>db.query('update app.recipes set current_revision_id=$2,version=version+1 where id=$1',[bom,packRev]))).rejects.toMatchObject({code:'23514'});
 await actor(async()=>{await db.query('update app.recipes set active=false,is_default=false,version=version+1 where id=$1',[pack]);await publish(bom,[{component_id:box,kind:'component',quantity:'1'}]);});
 await actor(async()=>{const current=(await db.query<any>('select current_revision_id from app.recipes where id=$1',[bom])).rows[0].current_revision_id;const a=await load(current),b=await load(packRev);expect(()=>calculate('1',a,b)).toThrow('two consumption');});
 await expect(actor(()=>db.query('update app.recipes set active=true,version=version+1 where id=$1',[pack]))).rejects.toMatchObject({code:'23514'});
});
it('isolates all three tables, read-only permissions, browser roles and foreign references',async()=>{
 await asUser(db,ids.adminB,ids.b,async()=>{for(const t of ['recipes','recipe_revisions','recipe_lines'])expect((await db.query('select * from app.'+t)).rows).toHaveLength(0);},ids.sessionB);
 await expect(asUser(db,ids.adminB,ids.b,()=>db.query("insert into app.recipes(company_id,product_id,kind,name) values($1,$2,'bom','Foreign')",[ids.b,product]),ids.sessionB)).rejects.toMatchObject({code:'23514'});
 await db.query("insert into app.role_permissions values($1,$2,'masterdata.read')",[ids.a,ids.readRole]);
 await asUser(db,ids.reader,ids.a,async()=>{expect((await db.query('select * from app.recipes')).rows.length).toBeGreaterThan(0);},ids.sessionRead);
 await expect(asUser(db,ids.reader,ids.a,()=>db.query("insert into app.recipes(company_id,product_id,kind,name) values($1,$2,'bom','Denied')",[ids.a,product]),ids.sessionRead)).rejects.toMatchObject({code:'42501'});
 for(const role of ['anon','authenticated','service_role'])for(const t of ['recipes','recipe_revisions','recipe_lines']){await db.exec('BEGIN; SET LOCAL ROLE '+role);try{await expect(db.exec('select * from app.'+t)).rejects.toMatchObject({code:'42501'});}finally{await db.exec('ROLLBACK');}}
});
it('supports multiple materials, alternative packs and a single atomic default',async()=>{
 let alternate:string;
 await actor(async()=>{
  alternate=await recipe('packing','Alternative');await publish(alternate,[{component_id:pallet,kind:'container',quantity:'480'}]);await db.query('update app.recipes set is_default=true,version=version+1 where id=$1',[alternate]);
  const extra=await recipe('packing','Half size');await publish(extra,[{component_id:pallet,kind:'container',quantity:'240'}]);
  await db.query('savepoint before_default');await expect(db.query('update app.recipes set is_default=true,version=version+1 where id=$1',[extra])).rejects.toMatchObject({code:'23505'});await db.exec('rollback to savepoint before_default');
  const r=await load(bomRev);r.lines.push({...r.lines[0],component_id:frame,quantity:'2',snapshot:{name:'Second material',unit:'m'}});expect(calculate('100',r).materials.map(l=>l.quantity)).toEqual(['0.825','200']);
 });
});
