import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Req} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {AuthRequired,Actor} from './auth';
import {DatabaseService} from './database';
import {catalogs} from './masterdata';
import {inputSchema,validate} from './items';
import {parseImportCsv} from './import-csv';
export const importFields={
 customers:{required:['code','name'],optional:['address','contact_name','phone','email','notes']},
 suppliers:{required:['code','name'],optional:['address','contact_name','phone','email','notes','lead_time_days']},
 products:{required:['code','name'],optional:['unit_code','customer_code','description','notes','color']},
 materials:{required:['code','name'],optional:['unit_code','supplier_code','description','notes','color']},
 opening_stock:{required:['item_code','owner_code','location_code','quantity'],optional:[]},
} as const;
type Kind=keyof typeof importFields;
type Row=Record<string,string>;
type Issue={row:number;field:string;message:string};
const uuid=z.string().uuid(),kindSchema=z.enum(['customers','suppliers','products','materials','opening_stock']);
function parse<T>(schema:z.ZodType<T>,body:unknown):T{const r=schema.safeParse(body);if(!r.success)throw new BadRequestException();return r.data;}
const canonical=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=(kind:Kind,rows:Row[])=>createHash('sha256').update(canonical({kind,rows})).digest('hex');
@AuthRequired()
@Controller('companies/:companyId/imports')
export class ImportsController {
 constructor(@Inject(DatabaseService) private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,kind:Kind,work:(db:PoolClient)=>Promise<T>){
  return this.database.asActor(actor,parse(uuid,company),async db=>{
   const rights=kind==='opening_stock'?['masterdata.read','inventory.read','inventory.adjust']:['masterdata.read','masterdata.manage'];
   if(!(await db.query('select bool_and(app.allowed(p)) as ok from unnest($1::text[]) p',[rights])).rows[0]?.ok)throw new ForbiddenException();
   return work(db);
  });
 }
 @Get(':kind/template')
 template(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') raw:string){const kind=parse(kindSchema,raw);return this.run(req.actor,company,kind,async()=>({company_id:company,kind,...importFields[kind],csv:importFields[kind].required.join(';')+'\r\n',max_rows:100,max_bytes:32768}));}
 @Get(':kind/history')
 history(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') raw:string){const kind=parse(kindSchema,raw);return this.run(req.actor,company,kind,async db=>({company_id:company,kind,items:(await db.query('select id,job_id,actor_id,created_at,sha256,result from app.import_receipts where company_id=$1 and kind=$2 order by created_at desc,id desc limit 20',[company,kind])).rows}));}
 private async validateRows(db:PoolClient,company:string,kind:Kind,rows:Row[]){
  const errors:Issue[]=[],prepared:Record<string,unknown>[]=[],seen=new Set<string>();
  const fields=importFields[kind];
  const issue=(row:number,field:string,message:string)=>errors.push({row,field,message});
  // Tables are selected exclusively by this closed internal mapping.
  const reference=async(table:'units'|'customers'|'suppliers'|'stock_owners'|'locations'|'items',code:string)=>{
   const r=await db.query(`select * from app.${table} where company_id=$1 and lower(code)=lower($2) and active for share`,[company,code]);return r.rows[0];
  };
  for(let n=0;n<rows.length;n++){
   const r=rows[n]!,line=n+2,start=errors.length;
   for(const f of Object.keys(r))if(!([...fields.required,...fields.optional] as string[]).includes(f))issue(line,f,'Ukendt kolonne. Brug skabelonen.');
   for(const f of fields.required)if(!r[f])issue(line,f,'Skal udfyldes.');
   if(errors.length!==start)continue;
   const duplicate=kind==='opening_stock'?JSON.stringify([r.item_code,r.owner_code,r.location_code].map(x=>x!.toLowerCase())):r.code!.toLowerCase();
   if(seen.has(duplicate)){issue(line,'code','Dublet i filen.');continue;}seen.add(duplicate);
   if(kind==='opening_stock'){
    if(!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/.test(r.quantity!)||!/[1-9]/.test(r.quantity!)){issue(line,'quantity','Brug en positiv mængde med punktum og højst 8 decimaler.');continue;}
    const i=await reference('items',r.item_code!),o=await reference('stock_owners',r.owner_code!),l=await reference('locations',r.location_code!);
    if(!i)issue(line,'item_code','Aktiv vare/materiale findes ikke i virksomheden.');
    if(!o)issue(line,'owner_code','Aktiv lagerejer findes ikke i virksomheden.');
    if(!l?.is_storage)issue(line,'location_code','Aktiv lagerplacering findes ikke i virksomheden.');
    if(!i||!o||!l?.is_storage)continue;
    const u=(await db.query('select * from app.units where company_id=$1 and id=$2 and active for share',[company,i.unit_id])).rows[0];
    if(!u)issue(line,'item_code','Varen skal have en aktiv lagerenhed.');
    else if(['count','package'].includes(u.dimension)&&/[1-9]/.test(r.quantity!.split('.')[1]??''))issue(line,'quantity','Denne enhed kræver hele antal.');
    if((await db.query('select 1 from app.inventory_lines where company_id=$1 and item_id=$2 and owner_id=$3 and location_id=$4 limit 1',[company,i.id,o.id,l.id])).rows.length)issue(line,'item_code','Der findes allerede lagerhistorik for denne vare/ejer/placering. Brug lagerkorrektion.');
    prepared.push({item_id:i.id,owner_id:o.id,location_id:l.id,quantity:r.quantity});
   }else{
    const table=kind==='customers'||kind==='suppliers'?kind:'items';
    if((await db.query(`select 1 from app.${table} where company_id=$1 and lower(code)=lower($2)`,[company,r.code])).rows.length)issue(line,'code','Koden findes allerede. Eksisterende data overskrives ikke.');
    const data:Record<string,unknown>=Object.fromEntries(Object.entries(r).filter(([,v])=>v!==''));
    if(kind==='suppliers'&&data.lead_time_days!==undefined){if(!/^\d+$/.test(String(data.lead_time_days)))issue(line,'lead_time_days','Brug et helt antal dage.');else data.lead_time_days=Number(data.lead_time_days);}
    if(kind==='products'||kind==='materials'){
     for(const [field,table,column] of [['unit_code','units','unit_id'],[kind==='products'?'customer_code':'supplier_code',kind==='products'?'customers':'suppliers',kind==='products'?'customer_id':'supplier_id']] as const){
      if(r[field]){const ref=await reference(table,r[field]!);if(!ref)issue(line,field,'Aktiv reference findes ikke i virksomheden.');else data[column]=ref.id;}delete data[field];
     }
     const parsed=inputSchema.safeParse(data);
     if(!parsed.success)for(const e of parsed.error.issues)issue(line,e.path.join('.'),'Ugyldig værdi eller længde.');
     else {validate(parsed.data,kind==='products'?'product':'material');prepared.push({...parsed.data,kind:kind==='products'?'product':'material'});}
    }else{
     const parsed=catalogs[kind].safeParse(data);
     if(!parsed.success)for(const e of parsed.error.issues)issue(line,e.path.join('.'),'Ugyldig værdi eller længde.');else prepared.push(parsed.data);
    }
   }
  }
  return {errors,prepared};
 }
 @Post(':kind/preview')
 preview(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') raw:string,@Body() body:unknown){
  const kind=parse(kindSchema,raw),input=parse(z.object({filename:z.string().trim().min(1).max(120).regex(/\.csv$/i),csv:z.string().max(32768)}).strict(),body);
  return this.run(req.actor,company,kind,async db=>{
   let rows:Row[];try{rows=parseImportCsv(input.csv).rows;}catch(e){return {company_id:company,kind,rows:[],errors:[{row:0,field:'file',message:(e as Error).message}],job_id:null};}
   const sha256=digest(kind,rows),{errors,prepared}=await this.validateRows(db,company,kind,rows);
   if(errors.length)return {company_id:company,kind,rows,errors,job_id:null};
   const job=(await db.query('insert into app.import_jobs(company_id,kind,filename,sha256,rows,prepared) values($1,$2,$3,$4,$5::jsonb,$6::jsonb) returning id',[company,kind,input.filename,sha256,JSON.stringify(rows),JSON.stringify(prepared)])).rows[0];
   return {company_id:company,kind,rows,errors:[],job_id:job.id,sha256};
  });
 }
 @Post(':kind/:jobId/confirm')
 confirm(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') raw:string,@Param('jobId') jobId:string,@Body() body:unknown){
  const kind=parse(kindSchema,raw);parse(uuid,jobId);parse(z.object({confirm:z.literal(true)}).strict(),body);
  return this.run(req.actor,company,kind,async db=>{
   const job=(await db.query('select *,created_at > now()-interval \'24 hours\' as fresh from app.import_jobs where company_id=$1 and id=$2 and kind=$3 and actor_id=$4',[company,jobId,kind,req.actor.userId])).rows[0];
   if(!job)throw new NotFoundException();
   const existing=(await db.query('select * from app.import_receipts where company_id=$1 and kind=$2 and sha256=$3',[company,kind,job.sha256])).rows[0];
   if(existing)return {company_id:company,kind,receipt:existing,replayed:true,errors:[]};
   if(!job.fresh)throw new ConflictException('Preview expired');
   const {errors,prepared}=await this.validateRows(db,company,kind,job.rows);
   if(!errors.length && canonical(prepared)!==canonical(job.prepared))errors.push({row:0,field:'file',message:'Referencer er ændret siden forhåndsvisningen. Validér filen igen.'});
   if(errors.length)return {company_id:company,kind,receipt:null,errors};
   const result:{row:number;id:string}[]=[];
   if(kind==='opening_stock'){
    const entry=(await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,reference,request) values($1,$2,'correction','Import af startbeholdning',$3,$4::jsonb) returning id",[company,jobId,'Import '+jobId,JSON.stringify(prepared)])).rows[0];
    for(let i=0;i<prepared.length;i++)result.push({row:i+2,id:entry.id});
   }else{
    const table=kind==='customers'||kind==='suppliers'?kind:'items';
    for(let i=0;i<prepared.length;i++){
     const data=prepared[i]!,cols=Object.keys(data); // Closed Zod output only, never raw CSV identifiers.
     const created=(await db.query(`insert into app.${table}(company_id,${cols.join(',')}) values($1,${cols.map((_,j)=>'$'+(j+2)).join(',')}) returning id`,[company,...Object.values(data)])).rows[0];result.push({row:i+2,id:created.id});
    }
   }
   const receipt=(await db.query('insert into app.import_receipts(company_id,job_id,kind,sha256,result) values($1,$2,$3,$4,$5::jsonb) returning *',[company,jobId,kind,job.sha256,JSON.stringify(result)])).rows[0];
   return {company_id:company,kind,receipt,replayed:false,errors:[]};
  });
 }
}
