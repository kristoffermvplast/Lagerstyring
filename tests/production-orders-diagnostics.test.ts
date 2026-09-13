import { createRequire } from 'node:module';
import { it,expect } from 'vitest';
const {verify}=createRequire(import.meta.url)('../scripts/verify-production-orders.cjs');
it('online helper makes no business mutations, validates isolation and never logs secrets',async()=>{
 const output:string[]=[],calls:any[]=[];const company='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002';
 const config={authOrigin:'https://auth.example.test',apiOrigin:'https://api.example.test',key:'SECRET_KEY_SENTINEL',email:'PRIVATE_EMAIL_SENTINEL',password:'PASSWORD_SENTINEL',companyName:'Fixture',isolationCompanyId:foreign};
 const request=async(url:string,options:any)=>{
  calls.push({url,options});let status=200,body:any={};
  if(url.includes('token?'))body={access_token:'TOKEN_SENTINEL',user:{id:'user'}};
  else if(url.endsWith('/me'))body={user:{id:'user'},memberships:[{company_id:company,name:'Fixture'}]};
  else if(url.endsWith('/access'))body={permissions:[{code:'production.read'},{code:'production.manage'}]};
  else if(url.includes(foreign))status=403;
  else if(url.includes('/production-orders')&&url.includes('?limit='))body={items:[]};
  else if(url.includes('/production-orders'))status=404;
  return new Response(JSON.stringify(body),{status});
 };
 await verify(config,request,(s:string)=>output.push(s));expect(output.at(-1)).toBe('PHASE_10_READ_ONLY_VERIFICATION: PASS');
 expect(output.join('\n')).not.toMatch(/SECRET_KEY_SENTINEL|PRIVATE_EMAIL_SENTINEL|PASSWORD_SENTINEL|TOKEN_SENTINEL/);
 expect(config.password).toBe('');
 expect(calls.filter(c=>c.url.includes('/api/')).every(c=>c.options.method==='GET')).toBe(true);
 expect(calls.some(c=>c.url.includes('logout?scope=local'))).toBe(true);
});
it('online helper sanitizes upstream errors and stops on login failure',async()=>{
 const out:string[]=[];await expect(verify({authOrigin:'https://auth.example.test',key:'PRIVATE',password:'PRIVATE'},async()=>new Response(JSON.stringify({message:'PRIVATE',error_code:'PRIVATE'}),{status:400}),(s:string)=>out.push(s))).rejects.toThrow();expect(out.join('\n')).not.toContain('PRIVATE');expect(out).toContain('LOGIN_ERROR_CODE: UNCLASSIFIED');
});
