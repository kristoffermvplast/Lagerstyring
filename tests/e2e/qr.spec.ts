import {test,expect,Page} from '@playwright/test';
const company='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='20000000-0000-4000-8000-000000000001';
const code=(kind='machine',c=company)=>`lager:v1:${c}:${kind}:${id}`;
async function fixture(page:Page,allowed=true){
 const payload=Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url');
 const session={access_token:`e30.${payload}.fixture`,refresh_token:'fixture',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id,aud:'authenticated',email:'test@example.test',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()}};
 await page.route('http://127.0.0.1:54321/auth/v1/**',r=>r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*'},json:session}));
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id,display_name:'Fixture'},memberships:[{company_id:company,name:'Test A'},{company_id:other,name:'Test B'}]}}));
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:allowed?['masterdata.read','production.read','inventory.read'].map(code=>({code})):[]}}));
 const requests:string[]=[];
 await page.route(/\/api\/companies\/[^/]+\/(masterdata|locations|handling-units|production-orders)/,r=>{requests.push(r.request().method()+' '+new URL(r.request().url()).pathname);const path=new URL(r.request().url()).pathname;return r.fulfill({json:path.endsWith(id)?{id,company_id:company,code:'M-1',name:'Machine fixture',active:true,notes:'',version:1}:path.endsWith('/history')?[]:{items:[],total:0}});});
 await page.addInitScript(s=>sessionStorage.setItem('lager-auth-session',JSON.stringify(s)),session);
 await page.goto('/');await page.getByRole('button',{name:'Scan QR',exact:true}).click();return requests;
}
test('foreign/malformed codes cause no business lookup; own code opens existing machine details',async({page})=>{
 const requests=await fixture(page);
 await page.getByLabel('Scan QR',{exact:true}).fill(code('machine',other));await page.getByRole('button',{name:'Læs kode',exact:true}).click();await expect(page.getByRole('alert')).toContainText('anden virksomhed');expect(requests).toEqual([]);
 await page.getByLabel('Scan QR',{exact:true}).fill('https://evil.test');await page.getByRole('button',{name:'Læs kode',exact:true}).click();await expect(page.getByRole('alert')).toContainText('ikke en understøttet');expect(requests).toEqual([]);
 await page.getByLabel('Scan QR',{exact:true}).fill(code());await page.getByLabel('Scan QR',{exact:true}).press('Enter');await expect(page.getByRole('heading',{name:'Machine fixture'})).toBeVisible();
 await page.getByRole('button',{name:'Åbn registrering'}).click();await expect(page.getByRole('heading',{name:'Maskiner',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Machine fixture'})).toBeVisible();expect(requests.every(r=>r.startsWith('GET '))).toBe(true);
});
test('QR label generated locally and company switch clears scanned result',async({page})=>{
 await fixture(page);await page.getByLabel('Scan QR',{exact:true}).fill(code());await page.getByRole('button',{name:'Læs kode',exact:true}).click();await page.getByRole('button',{name:'Vis QR',exact:true}).click();
 const image=page.getByRole('img',{name:'QR-kode for Machine fixture'});await expect(image).toBeVisible();await expect(image).toHaveAttribute('src',/^data:image\/png;base64,/);await expect(page.getByLabel('QR-reference')).toHaveValue(code());
 const src=await image.getAttribute('src');
 const decoded=await page.evaluate(async({src,url})=>{const {default:Scanner}=await import(url);return (await Scanner.scanImage(src,{returnDetailedScanResult:true})).data;},{src,url:'/@fs/'+process.cwd()+'/node_modules/qr-scanner/qr-scanner.min.js'});
 expect(decoded).toBe(code());
 await page.getByLabel('Virksomhed',{exact:true}).selectOption(other);await page.getByRole('button',{name:'Scan QR',exact:true}).click();await expect(page.getByRole('button',{name:'Åbn registrering'})).toHaveCount(0);
});
test('read permissions are checked before lookup and camera denial retains keyboard alternative',async({page})=>{
 const requests=await fixture(page,false);await page.getByLabel('Scan QR',{exact:true}).fill(code());await page.getByRole('button',{name:'Læs kode',exact:true}).click();await expect(page.getByRole('alert')).toContainText('ikke adgang');expect(requests).toEqual([]);
 await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>Promise.reject(new DOMException('denied','NotAllowedError'))});});
 await page.getByRole('button',{name:'Start kamera',exact:true}).click();await expect(page.getByText('Kameraet kunne ikke åbnes.',{exact:false})).toBeVisible();await expect(page.getByLabel('Scan QR',{exact:true})).toBeEnabled();
});

test('camera starts only on request and releases tracks on navigation',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  const stream=canvas.captureStream(5);(window as any).qrTestStream=stream;(window as any).qrCameraCalls=0;
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{(window as any).qrCameraCalls++;return stream;}});
 });
 expect(await page.evaluate(()=>(window as any).qrCameraCalls)).toBe(0);
 await page.getByRole('button',{name:'Start kamera',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).qrCameraCalls)).toBe(1);
 await page.getByRole('button',{name:'Overblik',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).qrTestStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
});
test('scanner does not grant masterdata write controls',async({page})=>{
 const requests=await fixture(page);await page.getByRole('button',{name:'Maskiner',exact:true}).click();
 // Read-only user can label/inspect but cannot open an editing or movement form.
 await expect(page.getByRole('button',{name:'Opret ny',exact:true})).toHaveCount(0);expect(requests.every(r=>r.startsWith('GET '))).toBe(true);
});
test('location QR populates existing selector only after validation, with no write',async({page})=>{
 const requests=await fixture(page);
 await page.route('**/api/companies/*/access',r=>r.fulfill({json:{permissions:['masterdata.read','masterdata.manage'].map(code=>({code}))}}));
 // Re-enter workspace so the authoritative permission query uses the updated fixture.
 await page.reload();await page.getByRole('button',{name:'Maskiner',exact:true}).click();await page.getByRole('button',{name:'Opret ny',exact:true}).click();
 await page.getByText('Scan maskinplacering',{exact:true}).click();
 await page.evaluate(()=>{const canvas=document.createElement('canvas');const stream=canvas.captureStream(5);(window as any).qrTestStream=stream;(window as any).qrCameraCalls=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{(window as any).qrCameraCalls++;return stream;}});});
 await page.getByRole('button',{name:'Start kamera',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).qrCameraCalls)).toBe(1);
 await page.getByText('Scan maskinplacering',{exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).qrTestStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);
 await page.getByText('Scan maskinplacering',{exact:true}).click();
 await page.getByLabel('QR Maskinplacering',{exact:true}).fill(code('pallet'));await page.getByRole('button',{name:'Læs kode',exact:true}).click();await expect(page.getByRole('alert')).toContainText('forkert type');
 await page.getByLabel('QR Maskinplacering',{exact:true}).fill(code('location'));await page.getByRole('button',{name:'Læs kode',exact:true}).click();await expect(page.getByLabel('Maskinplacering',{exact:true})).toHaveValue(id);
 expect(requests.every(r=>r.startsWith('GET '))).toBe(true);
});
