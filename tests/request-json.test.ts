import {afterEach,it,expect,vi} from 'vitest';
import {requestJson} from '../apps/web/src/request-json';
afterEach(()=>vi.unstubAllGlobals());
it('does not submit or queue a command while the browser reports offline',async()=>{
 vi.stubGlobal('navigator',{onLine:false});const request=vi.fn();await expect(requestJson('/api/test',{method:'POST',body:'same-key'},request)).rejects.toThrow('ikke sendt');expect(request).not.toHaveBeenCalled();
});
it('makes one attempt and preserves the exact command and signal after uncertain network failure',async()=>{
 const init={method:'POST',body:JSON.stringify({idempotency_key:'same',quantity:'8.00000001'}),signal:AbortSignal.timeout(1000)},request=vi.fn().mockRejectedValue(new TypeError('private URL and token'));
 await expect(requestJson('/api/test',init,request)).rejects.toThrow('Handlingen kan være gemt');expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][1]).toBe(init);
});
it('distinguishes failed reads from uncertain writes without exposing transport details',async()=>{
 const request=vi.fn().mockRejectedValue(new Error('secret'));await expect(requestJson('/api/test',{method:'GET'},request)).rejects.toThrow('Opslaget kunne ikke hentes');expect(request).toHaveBeenCalledTimes(1);
});
it('treats a truncated successful command response as uncertain, with no automatic resend',async()=>{
 const request=vi.fn().mockResolvedValue(new Response('{',{status:201}));await expect(requestJson('/api/test',{method:'POST'},request)).rejects.toThrow('Handlingen kan være gemt');expect(request).toHaveBeenCalledTimes(1);
});
it.each([401,403,409,413,500])('handles HTTP %s without exposing provider messages or retrying',async status=>{
 const request=vi.fn().mockResolvedValue(new Response('secret',{status}));const failure=await requestJson('/api/test',{method:'POST'},request).catch(e=>e);expect(failure).toBeInstanceOf(Error);expect(failure.message).not.toContain('secret');expect(request).toHaveBeenCalledTimes(1);if(status===500)expect(failure.message).toContain('kan være gemt');
});
it('returns exact string quantities unchanged on success',async()=>{
 const value={quantity:'100000000000.00000001'};const request=vi.fn().mockResolvedValue(Response.json(value));expect(await requestJson('/api/test',{},request)).toEqual(value);
});
