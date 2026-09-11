import { beforeAll, afterAll, it, expect } from 'vitest';
import { fixture, ids, asUser } from './helpers/access-fixture';
let db: Awaited<ReturnType<typeof fixture>>;
let id: string;
beforeAll(async()=>{ db=await fixture(); });
afterAll(async()=>{ await db?.close(); });
it('stores all kinds with stable identity and immutable audit',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{
  for(const kind of ['product','material','packaging']) {
   const r=await db.query<{id:string}>('insert into app.items(company_id,kind,code,name) values($1,$2,$2,$2) returning id',[ids.a,kind]);
   id=r.rows[0].id;
   await db.query('update app.items set name=$1,version=version+1 where id=$2',['New name',id]);
   const h=await db.query<{before_value:any}>('select before_value from app.masterdata_audit where entity_id=$1 and before_value is not null',[id]);
   expect(h.rows[0].before_value.name).toBe(kind);
  }
 });
});
it('blocks foreign reads, writes, references and audit access',async()=>{
 await asUser(db,ids.adminB,ids.b,async()=>{
  expect((await db.query('select * from app.items')).rows).toHaveLength(0);
  expect((await db.query('select * from app.masterdata_audit')).rows).toHaveLength(0);
  expect((await db.query('update app.items set name=$1,version=version+1 where id=$2 returning id',['Attack',id])).rows).toHaveLength(0);
 },ids.sessionB);
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.items(company_id,kind,code,name) values($1,'product','X','X')",[ids.b]))).rejects.toMatchObject({code:'42501'});
 const foreign=await asUser(db,ids.adminB,ids.b,()=>db.query<{id:string}>("insert into app.customers(company_id,code,name) values($1,'C','C') returning id",[ids.b]),ids.sessionB);
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.items(company_id,kind,code,name,customer_id) values($1,'product','C','C',$2)",[ids.a,foreign.rows[0].id]))).rejects.toMatchObject({code:'23514'});
});
it('runtime cannot delete, rewrite identity, kind, timestamps, audit or omit version',async()=>{
 for(const sql of ['delete from app.items',"update app.items set kind='material'",'update app.items set company_id=company_id', 'update app.items set created_at=now()', 'delete from app.masterdata_audit']) {
  await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});
 }
 await expect(asUser(db,ids.adminA,ids.a,()=>db.exec("update app.items set name='No version'"))).rejects.toMatchObject({code:'23514'});
});
it('browser roles cannot access items and backend privileges remain constrained',async()=>{
 for(const role of ['anon','authenticated','service_role']) {
  await db.exec('BEGIN; SET LOCAL ROLE '+role);
  try { await expect(db.exec('select * from app.items')).rejects.toMatchObject({code:'42501'}); } finally { await db.exec('ROLLBACK'); }
 }
 const r=await db.query<{rls:boolean;owner:string}>("select relrowsecurity as rls, pg_get_userbyid(relowner) as owner from pg_class where oid='app.items'::regclass");
 expect(r.rows[0]).toEqual({rls:true,owner:'app_owner'});
});
