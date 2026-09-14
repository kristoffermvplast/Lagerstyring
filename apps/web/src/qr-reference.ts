/** QR data is an untrusted reference, never an authorization or command. */
export type QrKind = 'pallet' | 'location' | 'order' | 'machine';
export type QrReference = {company:string;kind:QrKind;id:string};
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const pattern=new RegExp(`^lager:v1:(${uuid}):(pallet|location|order|machine):(${uuid})$`,'i');
export function parseQr(raw:string, company:string, expected?:QrKind):QrReference {
 if(raw.length>160)throw new Error('QR-koden er ikke en understøttet lagerkode.');
 const match=pattern.exec(raw.trim());
 if(!match)throw new Error('QR-koden er ikke en understøttet lagerkode.');
 const ref={company:match[1]!.toLowerCase(),kind:match[2]!.toLowerCase() as QrKind,id:match[3]!.toLowerCase()};
 if(ref.company!==company.toLowerCase())throw new Error('QR-koden tilhører en anden virksomhed. Skift virksomhed først.');
 if(expected&&ref.kind!==expected)throw new Error('QR-koden har forkert type til denne handling.');
 return ref;
}
export function encodeQr(ref:QrReference):string {
 const value=`lager:v1:${ref.company}:${ref.kind}:${ref.id}`;
 const valid=parseQr(value,ref.company,ref.kind);
 return `lager:v1:${valid.company}:${valid.kind}:${valid.id}`;
}
export function qrPath(ref:QrReference):string {
 const valid=parseQr(encodeQr(ref),ref.company);
 const paths:Record<QrKind,string>={pallet:'handling-units',location:'locations',order:'production-orders',machine:'masterdata/machines'};
 return `/companies/${valid.company}/${paths[valid.kind]}/${valid.id}`;
}
