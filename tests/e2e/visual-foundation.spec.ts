import {test,expect,type Page} from '@playwright/test';
import {openWorkspace} from './ux-helpers';
async function fixture(page:Page,full=true){
 const id='20000000-0000-4000-8000-000000000001',company='10000000-0000-4000-8000-000000000001';
 const session={access_token:`e30.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.fixture`,refresh_token:'local',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id,aud:'authenticated',email:'test@example.test',user_metadata:{},app_metadata:{},created_at:'2026-01-01'}};
 const permissions=full?['dashboard.read','inventory.read','masterdata.read','masterdata.manage','production.read','shipments.read']:['dashboard.read'];
 const writes:string[]=[];
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({json:session}));
 await page.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;if(r.request().method()!=='GET')writes.push(path);
 if(path==='/api/me')return r.fulfill({json:{user:{id,display_name:'Kristoffer'},memberships:[{company_id:company,name:'Pilotvirksomhed'}]}});
 if(path.endsWith('/access'))return r.fulfill({json:{permissions:permissions.map(code=>({code}))}});
 if(path.endsWith('/dashboard'))return r.fulfill({json:{company_id:company,as_of:'2026-09-25T10:00:00Z',day:'2026-09-25',limited:[],permissions,alerts:[],orders:full?[{id:'order',code:'PO-1023',status:'in_production',product:'Plastemne',quantity:'1000'}]:[],shipments:[],receipts:[]}});
 return r.fulfill({json:{items:[],total:0}});
 });
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);await page.goto('/');await expect(page.getByText('Dagens overblik',{exact:true})).toBeVisible();return{writes};
}
test('mockup shell has real shortcuts, responsive navigation and no page overflow',async({page},info)=>{
 const {writes}=await fixture(page);await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Gå til indhold'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#content')).toBeFocused();await expect(page.getByRole('navigation',{name:'Dagens opgaver'}).getByRole('button')).toHaveCount(4);
 await expect(page.locator('#workspace-menu').getByRole('button',{name:'Overblik',exact:true,includeHidden:true})).toHaveCount(1);
 const mobile=(page.viewportSize()?.width??0)<=800;
 await expect(page.getByRole('navigation',{name:'Hurtig navigation'})).toBeVisible({visible:mobile});
 await expect(page.locator('#workspace-menu')).toBeVisible({visible:!mobile});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/visual-dashboard-${info.project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:/^Modtag varer/}).click();await expect(page.getByRole('heading',{name:'Modtagelse',exact:true})).toBeVisible();expect(writes).toEqual([]);
 if(mobile){await expect(page.getByRole('navigation',{name:'Hurtig navigation'}).getByRole('button')).toHaveCount(4);await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.locator('#workspace-menu')).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeFocused();await expect(page.locator('#workspace-menu')).toBeHidden();}
});
test('permissions remove unavailable shortcuts and scanning never writes',async({page})=>{
 const {writes}=await fixture(page,false);await expect(page.getByRole('navigation',{name:'Dagens opgaver'}).getByRole('button')).toHaveCount(0);
 await openWorkspace(page,'Scan QR');await expect(page.getByRole('button',{name:'Start kamera'})).toBeVisible();expect(writes).toEqual([]);
});
test('shared form retains visible boundaries, folded fields and primary hierarchy',async({page},info)=>{
 await fixture(page);await openWorkspace(page,'Kunder');await page.getByRole('button',{name:'Opret ny'}).click();await expect(page.getByRole('button',{name:'Opret ny'})).toBeHidden();await expect(page.locator('.workspace-results')).toBeHidden();
 const code=page.getByLabel('Nummer / kode',{exact:true});await code.fill('K-101');await page.getByLabel('Navn',{exact:true}).fill('Pilotkunde');
 await expect(page.getByText('Flere oplysninger',{exact:true})).toBeVisible();await page.getByText('Flere oplysninger',{exact:true}).click();await page.getByText('Flere oplysninger',{exact:true}).click();await expect(code).toHaveValue('K-101');
 expect(await code.evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0);
 const primary=page.locator('#content button.primary').last();await expect(primary).toHaveCSS('background-color','rgb(8, 102, 255)');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.locator('form>.master-actions button').first()).toHaveText('Annullér');await page.getByRole('button',{name:'Annullér',exact:true}).click();await expect(page.getByRole('button',{name:'Opret ny'})).toBeVisible();
});
