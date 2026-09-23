import {openWorkspace} from './ux-helpers';
import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',job='50000000-0000-4000-8000-000000000001';
async function setup(page:Page,manage=true){
 const user='20000000-0000-4000-8000-000000000001',payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['masterdata.read',...(manage?['masterdata.manage','inventory.read','inventory.adjust']:[])].map(code=>({code}))}}));
 const confirms:any[]=[],previews:any[]=[];
 await page.route('**/api/companies/*/imports/**',async r=>{
  const url=new URL(r.request().url()),kind=url.pathname.split('/')[5],c=url.pathname.split('/')[3];
  if(url.pathname.endsWith('/template'))return r.fulfill({json:{company_id:c,kind,required:['code','name'],optional:['email'],csv:'code;name\r\n'}});
  if(url.pathname.endsWith('/history'))return r.fulfill({json:{company_id:c,kind,items:[]}});
  if(url.pathname.endsWith('/preview')){const body=r.request().postDataJSON();previews.push(body);const invalid=body.csv.includes('BAD');return r.fulfill({json:{company_id:c,kind,job_id:invalid?null:job,rows:[{code:'C',name:'Imported customer'}],errors:invalid?[{row:2,field:'code',message:'Dublet i filen.'}]:[]}});}
  confirms.push({url:r.request().url(),body:r.request().postDataJSON()});
  if(confirms.length===1)return r.abort('connectionreset');
  return r.fulfill({json:{company_id:c,kind,errors:[],receipt:{id:'receipt',result:[{row:2,id:'customer'}]}}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');
 if(manage)await openWorkspace(page,'Import');
 return {confirms,previews};
}
test('preview shows rows without committing, retries same job after a lost response',async({page})=>{
 const f=await setup(page);await page.getByLabel('CSV-fil').setInputFiles({name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from('code;name\nC;Customer')});await page.getByRole('button',{name:'Validér og vis forhåndsvisning'}).click();await expect(page.getByText('Imported customer',{exact:true})).toBeVisible();expect(f.confirms).toHaveLength(0);
 await page.getByRole('button',{name:'Bekræft import af 1 rækker'}).click();await expect(page.getByRole('alert')).toContainText('samme import gemmes kun én gang');await page.getByRole('button',{name:'Bekræft import af 1 rækker'}).click();await expect(page.getByRole('status').filter({hasText:'Import gennemført'})).toContainText('Import gennemført');expect(f.confirms).toHaveLength(2);expect(f.confirms[0]).toEqual(f.confirms[1]);
});
test('row errors block confirmation, replacing file clears stale preview, company change clears state',async({page})=>{
 const f=await setup(page);await page.getByLabel('CSV-fil').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('code;name\nBAD;Name')});await page.getByRole('button',{name:'Validér og vis forhåndsvisning'}).click();await expect(page.getByRole('alert')).toContainText('Række 2');await expect(page.getByRole('button',{name:'Bekræft import af 1 rækker'})).toBeDisabled();
 await page.getByLabel('CSV-fil').setInputFiles({name:'new.csv',mimeType:'text/csv',buffer:Buffer.from('code;name\nNEW;Name')});await expect(page.getByRole('heading',{name:/Forhåndsvisning/})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await expect(page.getByRole('heading',{name:'Overblik',exact:true})).toBeVisible();expect(f.confirms).toHaveLength(0);
});
test('import entry is hidden for read-only users',async({page})=>{await setup(page,false);await expect(page.getByRole('button',{name:'Import',exact:true})).toHaveCount(0);});
