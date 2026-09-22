import {expect,it} from 'vitest';
import {amount,forecast,ForecastEvent,signed} from '../apps/api/src/forecast-calculation';
const event=(kind:ForecastEvent['kind'],quantity:string,date='2026-09-23',credit='0',id='source'):ForecastEvent=>({kind,quantity,date,reservation_credit:credit,source_id:id,reference:id});
it('counts a reserved shipment once, while an independent reservation remains held',()=>{
 const r=forecast('100','30','0',[event('shipment','20',undefined,'20')]);expect(r.projected_available).toBe('70');expect(r.remaining_demand).toBe('20');expect(r.reservation_credit).toBe('20');
});
it('nets explicit production reservation coverage without freeing unused reserved quantities',()=>{
 expect(forecast('100','30','0',[event('production','20',undefined,'20')]).projected_available).toBe('70');
 expect(forecast('100','30','0',[event('production','40',undefined,'30')]).projected_available).toBe('60');
});
it('excludes material already committed in production from the free pool',()=>{
 const r=forecast('100','0','40',[event('production','10')]);expect(r.planning_available).toBe('60');expect(r.projected_available).toBe('50');
});
it('shows an earlier shortage even if later supply restores the balance; demand precedes same-day supply',()=>{
 const r=forecast('5','0','0',[event('arrival','20'),event('production','10')]);expect(r.projected_available).toBe('15');expect(r.shortage).toBe('5');expect(r.timeline[0]?.kind).toBe('production');
});
it('keeps exact decimals, negative fractions and aggregates beyond a single database input',()=>{
 expect(signed(-1n)).toBe('-0.00000001');expect(forecast('0','0','0',[event('production','0.00000001')]).projected_available).toBe('-0.00000001');
 expect(forecast('99999999999999.99999999','0','0',[event('arrival','0.00000001')]).projected_available).toBe('100000000000000');
 for(const v of ['NaN','Infinity','1e3','-1','0.000000001'])expect(()=>amount(v)).toThrow();
});
it('refuses invalid reservation credits',()=>{
 expect(()=>forecast('10','0','0',[event('arrival','1',undefined,'1')])).toThrow();expect(()=>forecast('10','0','0',[event('shipment','1',undefined,'2')])).toThrow();
});
