import { it,expect,vi,afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {validatePhoto,ItemPhotoStorage}=require('../apps/api/dist/item-photos.js');
const {loadConfig}=require('../apps/api/dist/config.js');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=';
afterEach(()=>vi.unstubAllGlobals());
it('accepts a raster signature and rejects SVG, malformed encoding, huge dimensions and excess bytes',()=>{
 expect(validatePhoto(png,'image/png').length).toBeGreaterThan(33);
 for(const [data,mime] of [['<svg/>','image/png'],[png,'image/svg+xml'],['invalid','image/png'],['/9j/2Q==','image/jpeg']])expect(()=>validatePhoto(data,mime)).toThrow();
 const huge=Buffer.from(png,'base64');huge.writeUInt32BE(99999999,16);expect(()=>validatePhoto(huge.toString('base64'),'image/png')).toThrow();
 expect(()=>validatePhoto(Buffer.alloc(1024*1024+1).toString('base64'),'image/png')).toThrow();
});
it('is disabled by default and never calls storage without explicit configuration',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const storage=new ItemPhotoStorage(loadConfig({NODE_ENV:'test'}));expect(storage.enabled).toBe(false);
 await expect(storage.upload('key',Buffer.from(png,'base64'),'image/png')).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 expect(()=>loadConfig({NODE_ENV:'test',ITEM_PHOTOS_ENABLED:'true'})).toThrow();
});
it('uses only the fixed private storage endpoint, header-only server key and no redirects',async()=>{
 const fetch=vi.fn(async(url:string)=>url.includes('/bucket/')?Response.json({id:'item-photos',public:false}):new Response(Buffer.from(png,'base64'),{status:200}));vi.stubGlobal('fetch',fetch);
 const storage=new ItemPhotoStorage(loadConfig({NODE_ENV:'test',ITEM_PHOTOS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_STORAGE_SECRET_KEY:'sb_secret_local_fixture'}));
 await storage.upload('company/item/photo.png',Buffer.from(png,'base64'),'image/png');
 expect(fetch.mock.calls[1][0]).toBe('https://example.supabase.co/storage/v1/object/item-photos/company/item/photo.png');
 expect(fetch.mock.calls[1][1]).toMatchObject({method:'POST',redirect:'error',headers:{apikey:'sb_secret_local_fixture'}});
 expect((await storage.read('company/item/photo.png')).toString('base64')).toBe(png);
 expect(fetch.mock.calls[3][0]).toContain('/object/authenticated/item-photos/');
});
it('sanitizes upstream failures and bounds download size',async()=>{
 const config=loadConfig({NODE_ENV:'test',ITEM_PHOTOS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_STORAGE_SECRET_KEY:'sb_secret_local_fixture'});
 const storage=new ItemPhotoStorage(config);
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('private upstream details');}));
 await expect(storage.read('key')).rejects.toThrow('Service Unavailable');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/bucket/')?Response.json({id:'item-photos',public:false}):new Response(Buffer.alloc(1024*1024+1))));
 await expect(storage.read('key')).rejects.toThrow('Service Unavailable');
});

it('refuses upload when the configured bucket is public',async()=>{
 const fetch=vi.fn(async()=>Response.json({id:'item-photos',public:true}));vi.stubGlobal('fetch',fetch);
 const storage=new ItemPhotoStorage(loadConfig({NODE_ENV:'test',ITEM_PHOTOS_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_STORAGE_SECRET_KEY:'sb_secret_local_fixture'}));
 await expect(storage.upload('key',Buffer.from(png,'base64'),'image/png')).rejects.toThrow('Service Unavailable');expect(fetch).toHaveBeenCalledTimes(1);
});
