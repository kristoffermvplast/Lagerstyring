import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const {verify}=createRequire(import.meta.url)('../scripts/verify-stock-counts.cjs');
it('online count helper uses read-only business requests, checks isolation and cleans session',async()=>{
 const company='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002';
 const calls:any[]=[],out:string[]=[];
 const config={authOrigin:'https://auth.example.test',apiOrigin:'https://api.example.test',key:'SECRET_KEY',email:'SECRET_EMAIL',password:'SECRET_PASSWORD',companyName:'Fixture',isolationCompanyId:foreign};
 const request=async(url:string,options:any)=>{
  calls.push({url,options});let body:any={},status=200;
  if(url.includes('token?'))body={access_token:'SECRET_TOKEN',user:{id:'user'}};
  else if(url.endsWith('/me'))body={user:{id:'user'},memberships:[{company_id:company,name:'Fixture'}]};
  else if(url.endsWith('/access'))body={permissions:['inventory.read','inventory.adjust','counts.read','counts.manage','counts.approve'].map(code=>({code}))};
  else if(url.includes(foreign))status=403;
  else if(url.includes('/stock-counts?'))body={items:[]};
  else if(url.includes('/stock-counts/'))status=404;
  return new Response(JSON.stringify(body),{status});
 };
 await verify(config,request,(s:string)=>out.push(s));expect(out.at(-1)).toBe('PHASE_20_READ_ONLY_VERIFICATION: PASS');expect(out.join('\n')).not.toContain('SECRET_');expect(config.password).toBe('');expect(calls.filter(c=>c.url.includes('/api/')).every(c=>c.options.method==='GET')).toBe(true);expect(calls.some(c=>c.url.includes('logout?scope=local'))).toBe(true);
});
it('a cross-company row stops verification and still cleans the temporary session',async()=>{
 const out:string[]=[];const company='10000000-0000-4000-8000-000000000001';
 const request=async(url:string)=>new Response(JSON.stringify(url.includes('token?')?{access_token:'HIDDEN',user:{id:'u'}}:url.endsWith('/me')?{user:{id:'u'},memberships:[{company_id:company,name:'Fixture'}]}:url.endsWith('/access')?{permissions:['inventory.read','inventory.adjust','counts.read','counts.manage','counts.approve'].map(code=>({code}))}:url.includes('/stock-counts?')?{items:[{company_id:'foreign'}]}:{}),{status:200});
 await expect(verify({authOrigin:'https://auth.example.test',apiOrigin:'https://api.example.test',key:'HIDDEN',email:'HIDDEN',password:'HIDDEN',companyName:'Fixture',isolationCompanyId:'10000000-0000-4000-8000-000000000002'},request,(s:string)=>out.push(s))).rejects.toThrow();expect(out).toContain('COUNT_RESPONSE_SCOPE: FAIL');expect(out).toContain('SUPABASE_SESSION_CLEANUP: PASS');expect(out.join('\n')).not.toContain('HIDDEN');
});
