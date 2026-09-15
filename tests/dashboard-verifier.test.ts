import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const {verify}=createRequire(import.meta.url)('../scripts/verify-dashboard.cjs');
const company='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002';
async function run(wrongScope=false){
 const calls:{url:string;method:string}[]=[],messages:string[]=[];
 const config={authOrigin:'https://auth.example.test',apiOrigin:'https://api.example.test',key:'sb_publishable_test',email:'private@example.test',password:'secret',companyName:'A',isolationCompanyId:foreign};
 const request=async(url:string,options:any)=>{
  calls.push({url,method:options.method});let body:any={},status=200;
  if(url.includes('/token?'))body={access_token:'secret-token',user:{id:'user'}};
  else if(url.endsWith('/me'))body={user:{id:'user'},memberships:[{company_id:company,name:'A'}]};
  else if(url.endsWith('/access'))body={permissions:['dashboard.read','dashboard.acknowledge','production.read','inventory.read','masterdata.read','shipments.read','counts.read'].map(code=>({code}))};
  else if(url.includes(foreign))status=403;
  else if(url.endsWith('/dashboard'))body={company_id:wrongScope?foreign:company,alerts:[],orders:[],receipts:[],shipments:[],limited:[],permissions:[]};
  return new Response(JSON.stringify(body),{status});
 };
 const result=verify(config,request,(s:string)=>messages.push(s));if(wrongScope)await expect(result).rejects.toThrow();else await result;
 expect(config.password).toBe('');expect(calls.filter(c=>c.url.includes('/api')) .every(c=>c.method==='GET')).toBe(true);expect(calls.at(-1)?.url).toContain('logout?scope=local');expect(messages.join('\n')).not.toMatch(/secret|private@/);return messages;
}
it('verifies hosted reads without business writes or secret output',async()=>{expect(await run()).toContain('PHASE_21_READ_ONLY_VERIFICATION: PASS');});
it('fails closed on a foreign response and cleans up the session',async()=>{const messages=await run(true);expect(messages).toContain('DASHBOARD_RESPONSE_SCOPE: FAIL');expect(messages).not.toContain('PHASE_21_READ_ONLY_VERIFICATION: PASS');});
