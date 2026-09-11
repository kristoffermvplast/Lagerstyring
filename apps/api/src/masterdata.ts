import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthRequired, Actor } from './auth';
import { DatabaseService } from './database';
import { PoolClient } from 'pg';
const base = { code:z.string().trim().min(1).max(60), name:z.string().trim().min(1).max(160), active:z.boolean().default(true), notes:z.string().max(4000).default('') };
const contact = { address:z.string().max(1000).default(''), contact_name:z.string().trim().max(120).default(''), phone:z.string().trim().max(60).default(''), email:z.union([z.literal(''),z.string().email().max(254)]).default('') };
// Identifiers in SQL come only from this closed catalog, never from request strings.
const catalogs = {
 customers:z.object({...base,...contact}).strict(),
 suppliers:z.object({...base,...contact,lead_time_days:z.number().int().min(0).max(3650).nullable().default(null)}).strict(),
 machines:z.object({...base,machine_type_id:z.string().uuid().nullable().default(null)}).strict(),
 product_groups:z.object(base).strict(), machine_types:z.object(base).strict(),
 material_types:z.object(base).strict(), pallet_types:z.object(base).strict(),
 units:z.object({...base,symbol:z.string().trim().min(1).max(20),dimension:z.enum(['count','mass','length','volume','package'])}).strict(),
};
type Kind=keyof typeof catalogs;
function parse<T>(schema:z.ZodType<T>,value:unknown):T {const r=schema.safeParse(value);if(!r.success)throw new BadRequestException();return r.data;}
function kind(value:string):Kind {if(!Object.hasOwn(catalogs,value))throw new NotFoundException();return value as Kind;}
const uuid=z.string().uuid();
const listQuery=z.object({q:z.string().trim().max(120).default(''),active:z.enum(['true','false','all']).default('all'),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25),sort:z.enum(['code','name']).default('code'),direction:z.enum(['asc','desc']).default('asc')}).strict();
@AuthRequired()
@Controller('companies/:companyId/masterdata')
export class MasterdataController {
 constructor(@Inject(DatabaseService) private readonly database:DatabaseService){}
 private async run<T>(actor:Actor,companyId:string,write:boolean,work:(client:PoolClient)=>Promise<T>) {
  return this.database.asActor(actor,parse(uuid,companyId),async client=>{
   const r=await client.query("select app.allowed('masterdata.read') as read,app.allowed('masterdata.manage') as manage");
   if(!r.rows[0]?.read || (write&&!r.rows[0]?.manage))throw new ForbiddenException();
   return work(client);
  });
 }
 @Get(':kind')
 async list(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') value:string,@Query() query:unknown){
  const table=kind(value),input=parse(listQuery,query);
  return this.run(req.actor,company,false,async client=>{
   const pattern='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%';
   const params=[company,pattern,input.active==='all'?null:input.active==='true'];
   const where="company_id=$1 AND (code ILIKE $2 OR name ILIKE $2) AND ($3::boolean IS NULL OR active=$3)";
   const count=await client.query(`select count(*)::int as total from app.${table} where ${where}`,params);
   const rows=await client.query(`select * from app.${table} where ${where} order by ${input.sort} ${input.direction},id limit $4 offset $5`,[...params,input.limit,(input.page-1)*input.limit]);
   return {items:rows.rows,total:count.rows[0].total,page:input.page,limit:input.limit};
  });
 }
 @Get(':kind/:id')
 async detail(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') value:string,@Param('id') id:string){
  const table=kind(value);parse(uuid,id);
  return this.run(req.actor,company,false,async client=>{
   const result=await client.query(`select * from app.${table} where company_id=$1 and id=$2`,[company,id]);
   if(!result.rowCount)throw new NotFoundException();return result.rows[0];
  });
 }
 @Get(':kind/:id/history')
 async history(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') value:string,@Param('id') id:string){
  const table=kind(value);parse(uuid,id);
  return this.run(req.actor,company,false,async client=>{
   if(!(await client.query(`select id from app.${table} where company_id=$1 and id=$2`,[company,id])).rowCount)throw new NotFoundException();
   return (await client.query('select id,actor_id,action,before_value,after_value,occurred_at from app.masterdata_audit where company_id=$1 and entity_type=$2 and entity_id=$3 order by occurred_at desc,id desc limit 100',[company,table,id])).rows;
  });
 }
 @Post(':kind')
 async create(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') value:string,@Body() body:unknown){
  const table=kind(value),input=parse(catalogs[table] as z.ZodType<Record<string,unknown>>,body);
  return this.run(req.actor,company,true,async client=>{
   await this.validateMachineType(client,table,input,company);
   const columns=Object.keys(input);const values=Object.values(input);
   return (await client.query(`insert into app.${table}(company_id,${columns.join(',')}) values($1,${columns.map((_,i)=>'$'+(i+2)).join(',')}) returning *`,[company,...values])).rows[0];
  });
 }
 @Patch(':kind/:id')
 async update(@Req() req:{actor:Actor},@Param('companyId') company:string,@Param('kind') value:string,@Param('id') id:string,@Body() body:unknown){
  const table=kind(value);parse(uuid,id);
  const envelope=parse(z.object({version:z.number().int().positive(),data:z.unknown()}).strict(),body);
  const input=parse(catalogs[table] as z.ZodType<Record<string,unknown>>,envelope.data);
  return this.run(req.actor,company,true,async client=>{
   const old=await client.query(`select * from app.${table} where company_id=$1 and id=$2 for update`,[company,id]);
   if(!old.rowCount)throw new NotFoundException();
   if(old.rows[0].version!==envelope.version)throw new ConflictException();
   if(table==='units'){if(input.dimension!==old.rows[0].dimension)throw new BadRequestException();delete input.dimension;}
   await this.validateMachineType(client,table,input,company,old.rows[0]);
   const columns=Object.keys(input);
   return (await client.query(`update app.${table} set ${columns.map((c,i)=>`${c}=$${i+3}`).join(',')},version=version+1 where company_id=$1 and id=$2 returning *`,[company,id,...Object.values(input)])).rows[0];
  });
 }
 private async validateMachineType(client:PoolClient,table:Kind,input:Record<string,unknown>,company:string,old?:Record<string,unknown>){
  if(table!=='machines'||!input.machine_type_id||input.machine_type_id===old?.machine_type_id)return;
  // Hold a shared lock until save: an assigned type must be active at assignment time.
  const r=await client.query('select id from app.machine_types where company_id=$1 and id=$2 and active for share',[company,input.machine_type_id]);
  if(!r.rowCount)throw new BadRequestException();
 }
}
