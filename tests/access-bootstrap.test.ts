import {createRequire} from 'node:module';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {fixture,ids} from './helpers/access-fixture';
const require=createRequire(import.meta.url);const {bootstrapCompany}=require('../apps/api/dist/bootstrap.js');
let db:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{db=await fixture();});afterAll(async()=>{await db?.close();});
it('operator bootstrap creates configured company, standard roles and audited initial admin',async()=>{
 const client={query:async(sql:string,values?:unknown[])=>{const result=await db.query(sql,values);return {rows:result.rows,rowCount:result.affectedRows??result.rows.length};}};
 const id=await bootstrapCompany(client,ids.newcomer,'Operator supplied test company');
 expect((await db.query('select count(*)::int as count from app.roles where company_id=$1',[id])).rows).toEqual([{count:5}]);
 expect((await db.query('select r.is_admin from app.memberships m join app.roles r on r.id=m.role_id and r.company_id=m.company_id where m.company_id=$1 and m.user_id=$2',[id,ids.newcomer])).rows).toEqual([{is_admin:true}]);
 expect((await db.query('select count(*)::int as count from app.access_audit where company_id=$1',[id])).rows[0].count).toBeGreaterThan(0);
});
