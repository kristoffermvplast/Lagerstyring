import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { AuthRequired, Actor } from './auth';
import { DatabaseService } from './database';
const uuid=z.string().uuid();
const data=z.object({code:z.string().trim().min(1).max(60),name:z.string().trim().min(1).max(160),parent_id:uuid.nullable().default(null),location_type:z.string().trim().max(80).default(''),active:z.boolean().default(true),is_storage:z.boolean().default(true),notes:z.string().max(4000).default('')}).strict();
const query=z.object({q:z.string().trim().max(120).default(''),parent_id:z.union([uuid,z.literal('root'),z.literal('all')]).default('all'),active:z.enum(['true','false','all']).default('all'),storage:z.enum(['true','false','all']).default('all'),exclude_subtree:uuid.optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25),sort:z.enum(['code','name']).default('code'),direction:z.enum(['asc','desc']).default('asc')}).strict();
function parse<T>(schema:z.ZodType<T>,value:unknown):T {const r=schema.safeParse(value);if(!r.success)throw new BadRequestException();return r.data;}
// Paths are derived from stable IDs, never stored as mutable primary keys.
const pathSQL=`WITH RECURSIVE chain AS (SELECT id,parent_id,code,name,active,0 depth FROM app.locations WHERE company_id=$1 AND id=$2 UNION ALL SELECT l.id,l.parent_id,l.code,l.name,l.active,c.depth+1 FROM app.locations l JOIN chain c ON l.id=c.parent_id WHERE l.company_id=$1 AND c.depth<31) SELECT id,code,name,active FROM chain ORDER BY depth DESC`;
@AuthRequired()
@Controller('companies/:companyId/locations')
export class LocationsController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:boolean,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const r=await db.query("select app.allowed('masterdata.read') as read,app.allowed('masterdata.manage') as manage");if(!r.rows[0]?.read||(write&&!r.rows[0]?.manage))throw new ForbiddenException();return work(db);});}
 private async find(db:PoolClient,company:string,id:string,lock=false){parse(uuid,id);const r=await db.query(`select * from app.locations where company_id=$1 and id=$2${lock?' for update':''}`,[company,id]);if(!r.rows[0])throw new NotFoundException();return r.rows[0];}
 @Get()
 list(@Req()req:{actor:Actor},@Param('companyId')company:string,@Query()raw:unknown){const input=parse(query,raw);return this.run(req.actor,company,false,async db=>{
  if(!['root','all'].includes(input.parent_id))await this.find(db,company,input.parent_id);
  if(input.exclude_subtree)await this.find(db,company,input.exclude_subtree);
  const cte=`WITH RECURSIVE excluded AS (SELECT id,0 depth FROM app.locations WHERE company_id=$1 AND id=$6::uuid UNION ALL SELECT l.id,e.depth+1 FROM app.locations l JOIN excluded e ON l.parent_id=e.id WHERE l.company_id=$1 AND e.depth<31)`;
  const params:unknown[]=[company,'%'+input.q.replace(/[\\%_]/g,'\\$&')+'%',input.parent_id,input.active==='all'?null:input.active==='true',input.storage==='all'?null:input.storage==='true',input.exclude_subtree??null];
  const where=`l.company_id=$1 AND (l.code ILIKE $2 OR l.name ILIKE $2 OR l.location_type ILIKE $2) AND ($3='all' OR ($3='root' AND l.parent_id IS NULL) OR l.parent_id::text=$3) AND ($4::boolean IS NULL OR l.active=$4) AND ($5::boolean IS NULL OR l.is_storage=$5) AND NOT EXISTS(SELECT 1 FROM excluded WHERE id=l.id)`;
  const total=(await db.query(`${cte} SELECT count(*)::int AS total FROM app.locations l WHERE ${where}`,params)).rows[0].total;
  const result=await db.query(`${cte} SELECT l.*,(SELECT count(*)::int FROM app.locations c WHERE c.company_id=l.company_id AND c.parent_id=l.id) AS child_count FROM app.locations l WHERE ${where} ORDER BY l.${input.sort} ${input.direction},l.id LIMIT $7 OFFSET $8`,[...params,input.limit,(input.page-1)*input.limit]);
  return{items:result.rows,total,page:input.page,limit:input.limit};
 });}
 @Get(':id')
 detail(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(req.actor,company,false,async db=>({...await this.find(db,company,id),path:(await db.query(pathSQL,[company,id])).rows}));}
 @Get(':id/history')
 history(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(req.actor,company,false,async db=>{await this.find(db,company,id);return(await db.query("select id,actor_id,action,before_value,after_value,occurred_at from app.masterdata_audit where company_id=$1 and entity_type='locations' and entity_id=$2 order by occurred_at desc,id desc limit 100",[company,id])).rows;});}
 @Post()
 create(@Req()req:{actor:Actor},@Param('companyId')company:string,@Body()body:unknown){const input=parse(data,body);return this.run(req.actor,company,true,async db=>{const keys=Object.keys(input);return(await db.query(`insert into app.locations(company_id,${keys.join(',')}) values($1,${keys.map((_,i)=>'$'+(i+2)).join(',')}) returning *`,[company,...Object.values(input)])).rows[0];});}
 @Patch(':id')
 update(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()body:unknown){const input=parse(z.object({version:z.number().int().positive(),data}).strict(),body);return this.run(req.actor,company,true,async db=>{const old=await this.find(db,company,id,true);if(old.version!==input.version)throw new ConflictException();const keys=Object.keys(input.data);return(await db.query(`update app.locations set ${keys.map((key,i)=>`${key}=$${i+3}`).join(',')},version=version+1 where company_id=$1 and id=$2 returning *`,[company,id,...Object.values(input.data)])).rows[0];});}
}
