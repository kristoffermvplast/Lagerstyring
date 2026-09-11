import { beforeAll,afterAll,expect,it } from 'vitest';
import { fixture,ids,asUser } from './helpers/access-fixture';
let db:Awaited<ReturnType<typeof fixture>>;let customer:string;
beforeAll(async()=>{db=await fixture();});afterAll(async()=>{await db?.close();});
it('creates a customer with an immutable audited snapshot, and updates by version',async()=>{
 await asUser(db,ids.adminA,ids.a,async()=>{
  const r=await db.query<{id:string}>('insert into app.customers(company_id,code,name) values($1,$2,$3) returning id',[ids.a,'C-001','Test customer']);customer=r.rows[0].id;
  await db.query('update app.customers set name=$1,version=version+1 where id=$2',['Revised',customer]);
  const audit=await db.query<{before_value:any;after_value:any}>('select before_value,after_value from app.masterdata_audit where entity_id=$1 order by occurred_at,id',[customer]);
  expect(audit.rows).toHaveLength(2);expect(audit.rows.find(r=>r.before_value===null)?.after_value.name).toBe('Test customer');expect(audit.rows.find(r=>r.before_value!==null)?.before_value.name).toBe('Test customer');expect(audit.rows.find(r=>r.before_value!==null)?.after_value.name).toBe('Revised');
 });
});
it('isolates reads and writes and history between two companies',async()=>{
 await asUser(db,ids.adminB,ids.b,async()=>{
  expect((await db.query('select * from app.customers where id=$1',[customer])).rows).toEqual([]);
  expect((await db.query('select * from app.masterdata_audit where entity_id=$1',[customer])).rows).toEqual([]);
  expect((await db.query('update app.customers set name=$1,version=version+1 where id=$2 returning id',['Foreign',customer])).rows).toEqual([]);
 },ids.sessionB);
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query('insert into app.customers(company_id,code,name) values($1,$2,$3)',[ids.b,'FORGED','Forbidden']))).rejects.toMatchObject({code:'42501'});
});
it('enforces per-company case-insensitive codes',async()=>{
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query('insert into app.customers(company_id,code,name) values($1,$2,$3)',[ids.a,'c-001','Duplicate']))).rejects.toMatchObject({code:'23505'});
 await asUser(db,ids.adminB,ids.b,()=>db.query('insert into app.customers(company_id,code,name) values($1,$2,$3)',[ids.b,'C-001','Separate']),ids.sessionB);
});
it('requires masterdata permissions independently of access administration',async()=>{
 await asUser(db,ids.reader,ids.a,async()=>{expect((await db.query('select * from app.customers')).rows).toEqual([]);},ids.sessionRead);
 await db.query("insert into app.role_permissions values($1,$2,'masterdata.read')",[ids.a,ids.readRole]);
 await asUser(db,ids.reader,ids.a,async()=>{expect((await db.query('select * from app.customers')).rows.length).toBe(1);},ids.sessionRead);
 await expect(asUser(db,ids.reader,ids.a,()=>db.query('insert into app.customers(company_id,code,name) values($1,$2,$3)',[ids.a,'NO','No']),ids.sessionRead)).rejects.toMatchObject({code:'42501'});
});
it('cannot delete records, rewrite audit, mutate identity or omit version increments',async()=>{
 for(const sql of ['delete from app.customers','delete from app.masterdata_audit',"update app.customers set company_id='10000000-0000-4000-8000-000000000002'"]){await expect(asUser(db,ids.adminA,ids.a,()=>db.exec(sql))).rejects.toMatchObject({code:'42501'});}
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query('update app.customers set name=$1 where id=$2',['No version',customer]))).rejects.toMatchObject({code:'23514'});
});
it('blocks cross-company machine type references and preserves inactive data',async()=>{
 const r=await asUser(db,ids.adminB,ids.b,()=>db.query<{id:string}>('insert into app.machine_types(company_id,code,name) values($1,$2,$3) returning id',[ids.b,'TYPE','Fixture type']),ids.sessionB);
 await expect(asUser(db,ids.adminA,ids.a,()=>db.query('insert into app.machines(company_id,code,name,machine_type_id) values($1,$2,$3,$4)',[ids.a,'M','Machine',r.rows[0].id]))).rejects.toMatchObject({code:'23503'});
 await asUser(db,ids.adminA,ids.a,async()=>{await db.query('update app.customers set active=false,version=version+1 where id=$1',[customer]);expect((await db.query<{active:boolean}>('select active from app.customers where id=$1',[customer])).rows[0].active).toBe(false);});
});
it('prevents unit dimension changes and direct browser access to all new tables',async()=>{
 await asUser(db,ids.adminA,ids.a,()=>db.query("insert into app.units(company_id,code,name,symbol,dimension) values($1,'TEST_KG','Test mass','kg','mass')",[ids.a]));
 await expect(asUser(db,ids.adminA,ids.a,()=>db.exec("update app.units set dimension='count',version=version+1"))).rejects.toMatchObject({code:'42501'});
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('BEGIN; SET LOCAL ROLE '+role);
  try{await expect(db.exec('select * from app.customers')).rejects.toMatchObject({code:'42501'});}finally{await db.exec('ROLLBACK');}
 }
});
