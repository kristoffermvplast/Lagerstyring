import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
async function fixture(page:Page,adjust=true){
 const user='20000000-0000-4000-8000-000000000001';const payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:[{code:'inventory.read'},{code:'masterdata.read'},...(adjust?[{code:'inventory.adjust'}]:[])]}}));
 const row={id:'50000000-0000-4000-8000-000000000001',code:'CODE',name:'Fixture',active:true,kind:'company',notes:'',version:1};const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(items|locations)/,r=>r.fulfill({json:r.request().url().includes(row.id)?{...row,path:[row]}:{items:[row],total:1}}));
 await page.route(/\/api\/companies\/[^/]+\/inventory/,async r=>{
  const url=new URL(r.request().url());if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());if(bodies.length===1)return r.fulfill({status:503,json:{message:'Unavailable'}});return r.fulfill({status:201,json:{id:'entry'}});}
  if(url.pathname.endsWith('/history'))return r.fulfill({json:[]});
  const items=url.pathname.endsWith('/owners')?[row]:url.pathname.includes(other)?[]:url.pathname.endsWith('/balances')?[{quantity:'12.00000000',snapshot:{item:{code:'MAT',name:'Material'},owner:{name:'Company stock'},location:{name:'Shelf'},unit:{symbol:'kg'}}}]:[];
  return r.fulfill({json:{items,total:items.length}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await page.getByRole('button',{name:'Lager',exact:true}).click();return{row,bodies};
}
test('shows ownership and physical stock; reader cannot adjust or edit owners',async({page})=>{
 await fixture(page,false);await expect(page.getByRole('cell',{name:'12.00000000 kg'})).toBeVisible();await expect(page.getByRole('button',{name:'Ny lagerkorrektion'})).toHaveCount(0);
 await page.getByRole('button',{name:'Ejere',exact:true}).click();await page.getByRole('button',{name:'Vis historik'}).click();await expect(page.getByRole('button',{name:'Gem ejer'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Lager',exact:true}).click();await expect(page.getByRole('cell',{name:'12.00000000 kg'})).toHaveCount(0);
});
test('confirms correction and retries identical body and key after failed response',async({page})=>{
 const {row,bodies}=await fixture(page);await page.getByRole('button',{name:'Ny lagerkorrektion'}).click();
 await page.getByLabel('Vare',{exact:true}).selectOption(row.id);await page.getByLabel('Ejer',{exact:true}).selectOption(row.id);await page.getByLabel('Placering',{exact:true}).selectOption(row.id);
 await page.getByLabel('Mængdeændring').fill('1,00825');await page.getByLabel('Begrundelse',{exact:true}).fill('Counted stock');page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Bekræft lagerkorrektion'}).click();
 await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Mængdeændring')).toBeDisabled();await page.getByRole('button',{name:'Prøv samme registrering igen'}).click();await expect(page.getByRole('heading',{name:'Begrundet lagerkorrektion'})).toHaveCount(0);
 expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].lines[0].quantity).toBe('1.00825');
});
