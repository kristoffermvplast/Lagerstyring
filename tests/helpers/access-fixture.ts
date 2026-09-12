import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
export const ids = {
 a:'10000000-0000-4000-8000-000000000001', b:'10000000-0000-4000-8000-000000000002',
 adminA:'20000000-0000-4000-8000-000000000001', adminB:'20000000-0000-4000-8000-000000000002',
 reader:'20000000-0000-4000-8000-000000000003', newcomer:'20000000-0000-4000-8000-000000000004',
 roleA:'30000000-0000-4000-8000-000000000001', roleB:'30000000-0000-4000-8000-000000000002', readRole:'30000000-0000-4000-8000-000000000003',
 session:'40000000-0000-4000-8000-000000000001', sessionB:'40000000-0000-4000-8000-000000000002', sessionRead:'40000000-0000-4000-8000-000000000003',sessionNew:'40000000-0000-4000-8000-000000000004',
};
export async function fixture() { return seedDatabase(new PGlite()); }
// Shared bootstrap for isolated, disposable local PostgreSQL tests only.
export async function seedDatabase<T extends Pick<PGlite,'exec'|'query'>>(db:T) {
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users);');
 for(const file of readdirSync('supabase/migrations').filter(p=>p.endsWith('.sql')).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
 for(const user of [ids.adminA,ids.adminB,ids.reader,ids.newcomer]) {await db.query('insert into auth.users values($1)',[user]);await db.query('insert into app.profiles(id) values($1)',[user]);}
 for(const [session,user] of [[ids.session,ids.adminA],[ids.sessionB,ids.adminB],[ids.sessionRead,ids.reader],[ids.sessionNew,ids.newcomer]])await db.query('insert into auth.sessions values($1,$2)',[session,user]);
 await db.query('insert into app.companies(id,name) values($1,$2),($3,$4)',[ids.a,'Isolation A (test only)',ids.b,'Isolation B (test only)']);
 await db.query('insert into app.roles(id,company_id,name,is_admin) values($1,$2,$3,true),($4,$5,$3,true),($6,$2,$7,false)',[ids.roleA,ids.a,'Administrator',ids.roleB,ids.b,ids.readRole,'Read only']);
 await db.query("insert into app.role_permissions values($1,$2,'access.read')",[ids.a,ids.readRole]);
 await db.query('insert into app.memberships(company_id,user_id,role_id) values($1,$2,$3),($4,$5,$6),($1,$7,$8)',[ids.a,ids.adminA,ids.roleA,ids.b,ids.adminB,ids.roleB,ids.reader,ids.readRole]);
 return db;
}
export async function asUser<T>(db:PGlite,user:string,company:string|null,work:()=>Promise<T>,session=ids.session) {
 await db.exec('BEGIN; SET LOCAL ROLE app_backend;');
 try {
 await db.query("select set_config('app.user_id',$1,true),set_config('app.company_id',$2,true),set_config('app.session_id',$3,true)",[user,company??'',session]);
 const result=await work();await db.exec('COMMIT');return result;
 }catch(e){await db.exec('ROLLBACK');throw e;}
}
