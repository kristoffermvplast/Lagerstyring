import { PoolClient } from 'pg';
import { z } from 'zod';
// Operator-only initialization. Never registered as an HTTP endpoint.
// The supplied user must already exist in Supabase Auth. No passwords here.
export async function bootstrapCompany(client: Pick<PoolClient,'query'>, userId: string, name: string) {
  z.string().uuid().parse(userId); name=z.string().trim().min(1).max(160).parse(name);
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query('SET LOCAL ROLE app_owner');
    await client.query('insert into app.profiles(id) values($1) on conflict do nothing',[userId]);
    await client.query("select set_config('app.user_id',$1,true)",[userId]);
    const company=await client.query('insert into app.companies(name) values($1) returning id',[name]);
    const companyId=company.rows[0].id;
    await client.query("select set_config('app.company_id',$1,true)",[companyId]);
    let adminRole='';
    for(const [roleName,admin,canRead] of [['ADMINISTRATOR',true,true],['KONTOR',false,true],['LAGER',false,false],['PRODUKTION',false,false],['LÆSEADGANG',false,true]] as const){
      const role=await client.query('insert into app.roles(company_id,name,is_admin) values($1,$2,$3) returning id',[companyId,roleName,admin]);
      if(admin)adminRole=role.rows[0].id;
      else if(canRead)await client.query("insert into app.role_permissions values($1,$2,'access.read')",[companyId,role.rows[0].id]);
    }
    await client.query('insert into app.memberships(company_id,user_id,role_id) values($1,$2,$3)',[companyId,userId,adminRole]);
    await client.query('COMMIT');return companyId;
  }catch(error){await client.query('ROLLBACK');throw error;}
}
