import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const require=createRequire(import.meta.url);const {DatabaseService}=require('../apps/api/dist/database.js');const {loadConfig}=require('../apps/api/dist/config.js');
it('rolls back actor context and discards a connection if rollback fails',async()=>{
 const service=new DatabaseService(loadConfig({}));const calls:string[]=[];let discarded=false;
 service.pool={connect:async()=>({query:async(sql:string)=>{calls.push(sql);if(sql==='ROLLBACK')throw Error('broken connection');return {rows:[{valid:true}]};},release:(drop:boolean)=>{discarded=drop;}})};
 await expect(service.asActor({userId:'u',sessionId:'s'},'c',async()=>{throw Error('operation failed');})).rejects.toThrow('operation failed');
 expect(calls[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');expect(calls.at(-1)).toBe('ROLLBACK');expect(discarded).toBe(true);
});
it('rejects privileged Supabase API keys in backend configuration',()=>{
 expect(()=>loadConfig({SUPABASE_PUBLISHABLE_KEY:'sb_secret_test'})).toThrow('public Supabase');
 const key='e30.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';
 expect(()=>loadConfig({SUPABASE_PUBLISHABLE_KEY:key})).toThrow('public Supabase');
});
