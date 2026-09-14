import {describe,it,expect} from 'vitest';
import {encodeQr,parseQr,qrPath,QrKind} from '../apps/web/src/qr-reference';
const company='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
describe('untrusted QR reference boundary',()=>{
 for(const [kind,path] of Object.entries({pallet:'handling-units',location:'locations',order:'production-orders',machine:'masterdata/machines'}))it(`round-trips ${kind} to only its allowlisted endpoint`,()=>{
  const ref={company,id,kind:kind as QrKind};expect(parseQr(encodeQr(ref),company)).toEqual(ref);expect(qrPath(ref)).toBe(`/companies/${company}/${path}/${id}`);
 });
 it('rejects a foreign company before any lookup',()=>expect(()=>parseQr(encodeQr({company,id,kind:'pallet'}),id)).toThrow('anden virksomhed'));
 it('rejects wrong kind for a location selector',()=>expect(()=>parseQr(encodeQr({company,id,kind:'pallet'}),company,'location')).toThrow('forkert type'));
 it('rejects URLs, script injection, new versions, traversal, queries and oversize input',()=>{
  for(const raw of ['https://evil.test','javascript:alert(1)',`lager:v2:${company}:pallet:${id}`,`lager:v1:${company}:../../:${id}`,`lager:v1:${company}:pallet:${id}?write=true`, 'x'.repeat(161),`lager:v1:${company}:pallet:${id}\nextra`])expect(()=>parseQr(raw,company)).toThrow();
 });
 it('normalizes scanner whitespace and UUID case without treating content as a command',()=>expect(parseQr(' '+encodeQr({company,id,kind:'order'}).toUpperCase()+'\r\n',company).kind).toBe('order'));
});
