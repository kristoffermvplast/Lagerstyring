import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { fixture,ids,asUser } from './helpers/access-fixture';
let db:PGlite;beforeAll(async()=>{db=await fixture();});afterAll(async()=>{await db?.close();});
describe('two-company PostgreSQL isolation as app_backend',()=>{
 it('denies rows with no request context and resets transaction context',async()=>{
  await db.exec('SET ROLE app_backend');
  try {expect((await db.query('select * from app.memberships')).rows).toEqual([]);}finally{await db.exec('RESET ROLE');}
  await asUser(db,ids.adminA,ids.a,async()=>expect((await db.query('select * from app.roles')).rows.length).toBe(2));
  expect((await db.query("select nullif(current_setting('app.company_id',true),'') as context")).rows).toEqual([{context:null}]);
 });
 it('separates companies and denies a forged company context',async()=>{
  await asUser(db,ids.adminA,ids.a,async()=>{expect((await db.query('select id from app.companies')).rows).toEqual([{id:ids.a}]);expect((await db.query('select * from app.memberships where company_id=$1',[ids.b])).rows).toEqual([]);});
  await asUser(db,ids.adminA,ids.b,async()=>expect((await db.query('select * from app.roles')).rows).toEqual([]));
  await asUser(db,ids.adminB,ids.b,async()=>expect((await db.query('select id from app.roles')).rows).toEqual([{id:ids.roleB}]),ids.sessionB);
 });
 it('blocks cross-company role assignment with a composite foreign key',async()=>{
  await expect(asUser(db,ids.adminA,ids.a,()=>db.query('insert into app.memberships(company_id,user_id,role_id) values($1,$2,$3)',[ids.a,ids.newcomer,ids.roleB]))).rejects.toMatchObject({code:'23503'});
 });
 it('read-only member cannot create roles, add members or escalate itself',async()=>{
  await expect(asUser(db,ids.reader,ids.a,()=>db.query('insert into app.roles(company_id,name) values($1,$2)',[ids.a,'forbidden']),ids.sessionRead)).rejects.toMatchObject({code:'42501'});
  await asUser(db,ids.reader,ids.a,async()=>expect((await db.query('update app.memberships set role_id=$1 where company_id=$2 and user_id=$3 returning user_id',[ids.roleA,ids.a,ids.reader])).rows).toEqual([]),ids.sessionRead);
 });
 it('protects last administrator and audit records',async()=>{
  await expect(asUser(db,ids.adminA,ids.a,()=>db.query('update app.memberships set active=false where company_id=$1 and user_id=$2',[ids.a,ids.adminA]))).rejects.toMatchObject({code:'23514'});
  await asUser(db,ids.adminA,ids.a,async()=>{await db.query('insert into app.roles(company_id,name) values($1,$2)',[ids.a,'Audited role']);expect((await db.query("select * from app.access_audit where action='roles.insert'")).rows.length).toBe(1);});
  await expect(asUser(db,ids.adminA,ids.a,()=>db.query('delete from app.access_audit'))).rejects.toMatchObject({code:'42501'});
 });
 it('revokes membership immediately and restores only through an admin',async()=>{
  await asUser(db,ids.adminA,ids.a,()=>db.query('update app.memberships set active=false,version=version+1 where company_id=$1 and user_id=$2',[ids.a,ids.reader]));
  await asUser(db,ids.reader,ids.a,async()=>expect((await db.query("select app.allowed('access.read') as allowed")).rows).toEqual([{allowed:false}]),ids.sessionRead);
  await asUser(db,ids.adminA,ids.a,()=>db.query('update app.memberships set active=true,version=version+1 where company_id=$1 and user_id=$2',[ids.a,ids.reader]));
 });
 it('only exposes current user profile and detects missing sessions',async()=>{
  await asUser(db,ids.adminA,null,async()=>{expect((await db.query('select id from app.profiles')).rows).toEqual([{id:ids.adminA}]);expect((await db.query('select app.session_active() as active')).rows).toEqual([{active:true}]);});
  await asUser(db,ids.adminA,null,async()=>expect((await db.query('select app.session_active() as active')).rows).toEqual([{active:false}]),ids.sessionB);
 });
 it('browser roles cannot execute privileged helper functions or read app tables',async()=>{
  for(const role of ['anon','authenticated','service_role']) {await db.exec(`SET ROLE ${role}`);try{await expect(db.query('select app.session_active()')).rejects.toMatchObject({code:'42501'});}finally{await db.exec('RESET ROLE');}}
 });
});
