import {openWorkspace} from './ux-helpers';
import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='50000000-0000-4000-8000-000000000001';
async function fixture(page:Page,write=true,stale=false){
 const user='20000000-0000-4000-8000-000000000001',payload=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'local-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:user},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['counts.read','inventory.read',...(write?['counts.manage','counts.approve','inventory.adjust']:[])].map(code=>({code}))}}));
 const c={id,company_id:company,item_id:id,owner_id:id,location_id:id,status:'counted',version:2,baseline_quantity:'10',current_quantity:'10',counted_quantity:'8',difference:'-2',reserved_quantity:'9',stale,snapshot:{item:{code:'M',name:'Materiale'},owner:{name:'Ejer'},location:{name:'Lager'},unit:{symbol:'kg'}},events:[],reservations:[{id,reference:'Kundeordre',quantity:'9'}]};
 const bodies:any[]=[];
 await page.route(/\/api\/companies\/[^/]+\/stock-counts/,r=>{
  if(r.request().method()==='POST'){bodies.push(r.request().postDataJSON());return r.fulfill({status:bodies.length===1?503:201,json:bodies.length===1?{message:'Unavailable'}:c});}
  return r.fulfill({json:r.request().url().includes('/'+id)?c:{items:r.request().url().includes(other)?[]:[c],total:r.request().url().includes(other)?0:1}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await openWorkspace(page,'Optælling');return bodies;
}
test('reader sees counts and company switch clears the previous detail',async({page})=>{
 await fixture(page,false);await page.getByRole('button',{name:'Vis optælling'}).click();await expect(page.getByText('Udgangspunkt: 10')).toBeVisible();await expect(page.getByRole('button',{name:'Godkend optælling',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Ny optælling'})).toHaveCount(0);
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await openWorkspace(page,'Optælling');await expect(page.getByText('Ingen optællinger fundet.')).toBeVisible();await expect(page.getByText('Udgangspunkt: 10')).toHaveCount(0);
});
test('stale count explains recount and offers cancellation without approval',async({page})=>{
 await fixture(page,true,true);await page.getByRole('button',{name:'Vis optælling'}).click();await expect(page.getByRole('alert')).toContainText('tæl igen');await expect(page.getByRole('button',{name:'Godkend optælling',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Annullér optælling',exact:true})).toBeVisible();await expect(page.getByText('Kundeordre · 9')).toBeVisible();
});
test('approval confirms exact difference and retries identical payload after uncertain response',async({page})=>{
 const bodies=await fixture(page);await page.getByRole('button',{name:'Vis optælling'}).click();await page.getByLabel('Begrundelse · Godkend optælling',{exact:true}).fill('Reviewed discrepancy');let dialogs=0;
 page.on('dialog',d=>{expect(d.message()).toContain('difference -2 kg');expect(d.message()).toContain('frigives ikke automatisk');dialogs++;void d.accept();});
 await page.getByRole('button',{name:'Godkend optælling',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Begrundelse · Godkend optælling',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Prøv samme handling igen · Godkend optælling',exact:true}).click();await expect.poll(()=>bodies.length).toBe(2);expect(bodies[0]).toEqual(bodies[1]);expect(dialogs).toBe(1);
});

test('stage3 counted review keeps approval visible and recount under more information',async({page})=>{
 await fixture(page);await page.getByRole('button',{name:'Vis optælling'}).click();await expect(page.getByLabel('Optalt antal',{exact:true})).not.toBeVisible();await expect(page.getByLabel('Begrundelse · Godkend optælling',{exact:true})).toBeVisible();await page.getByText('Flere oplysninger',{exact:true}).click();await expect(page.getByLabel('Optalt antal',{exact:true})).toBeVisible();
});
