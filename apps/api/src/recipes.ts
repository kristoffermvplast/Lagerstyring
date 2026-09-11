import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { AuthRequired, Actor } from './auth';
import { DatabaseService } from './database';
import { calculate, scaled, RecipeRevision } from './recipe-calculation';
const uuid=z.string().uuid(),kind=z.enum(['bom','packing']);
const quantity=z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/).refine(v=>{try{return scaled(v)>0n;}catch{return false;}});
const revisionInput=z.object({base_quantity:quantity.default('1'),pallet_type_id:uuid.nullable().default(null),notes:z.string().max(4000).default(''),lines:z.array(z.object({component_id:uuid,kind:z.enum(['component','container','accessory']),level:z.number().int().min(0).max(15).default(0),quantity}).strict()).min(1).max(100)}).strict();
const metadata=z.object({name:z.string().trim().min(1).max(160),active:z.boolean().default(true),is_default:z.boolean().default(false),notes:z.string().max(4000).default('')}).strict();
function parse<T>(schema:z.ZodType<T>,input:unknown):T {const r=schema.safeParse(input);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/recipes')
export class RecipesController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,company:string,write:boolean,work:(db:PoolClient)=>Promise<T>){return this.database.asActor(actor,parse(uuid,company),async db=>{const r=await db.query("select app.allowed('masterdata.read') as read,app.allowed('masterdata.manage') as manage");if(!r.rows[0]?.read||(write&&!r.rows[0]?.manage))throw new ForbiddenException();return work(db);});}
 private async find(db:PoolClient,company:string,id:string,lock=false){parse(uuid,id);const r=await db.query(`select * from app.recipes where company_id=$1 and id=$2${lock?' for update':''}`,[company,id]);if(!r.rows[0])throw new NotFoundException();return r.rows[0];}
 private async revision(db:PoolClient,company:string,id:string):Promise<RecipeRevision>{const r=await db.query('select * from app.recipe_revisions where company_id=$1 and id=$2 and sealed',[company,id]);if(!r.rows[0])throw new NotFoundException();return {...r.rows[0],lines:(await db.query('select * from app.recipe_lines where company_id=$1 and revision_id=$2 order by level,kind,id',[company,id])).rows};}
 @Get()
 list(@Req()req:{actor:Actor},@Param('companyId')company:string,@Query()query:unknown){const input=parse(z.object({product_id:uuid,kind:kind.optional()}).strict(),query);return this.run(req.actor,company,false,async db=>(await db.query('select * from app.recipes where company_id=$1 and product_id=$2 and ($3::text is null or kind=$3) order by kind,is_default desc,name,id',[company,input.product_id,input.kind??null])).rows);}
 @Get(':id')
 detail(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(req.actor,company,false,async db=>{const recipe=await this.find(db,company,id);return {...recipe,revisions:(await db.query('select id,revision,notes,created_at,created_by,snapshot from app.recipe_revisions where company_id=$1 and recipe_id=$2 and sealed order by revision desc',[company,id])).rows,current:recipe.current_revision_id?await this.revision(db,company,recipe.current_revision_id):null};});}
 @Get(':id/revisions/:revisionId')
 historical(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Param('revisionId')revisionId:string){parse(uuid,revisionId);return this.run(req.actor,company,false,async db=>{await this.find(db,company,id);const r=await this.revision(db,company,revisionId);if((r as RecipeRevision&{recipe_id:string}).recipe_id!==id)throw new NotFoundException();return r;});}
 @Get(':id/history')
 history(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string){return this.run(req.actor,company,false,async db=>{await this.find(db,company,id);return(await db.query("select * from app.masterdata_audit where company_id=$1 and entity_type='recipes' and entity_id=$2 order by occurred_at desc,id desc limit 100",[company,id])).rows;});}
 @Post()
 create(@Req()req:{actor:Actor},@Param('companyId')company:string,@Body()body:unknown){const input=parse(z.object({product_id:uuid,kind,name:z.string().trim().min(1).max(160)}).strict(),body);return this.run(req.actor,company,true,async db=>(await db.query('insert into app.recipes(company_id,product_id,kind,name) values($1,$2,$3,$4) returning *',[company,input.product_id,input.kind,input.name])).rows[0]);}
 @Patch(':id')
 update(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()body:unknown){const input=parse(z.object({version:z.number().int().positive(),data:metadata}).strict(),body);return this.run(req.actor,company,true,async db=>{const old=await this.find(db,company,id);await db.query('select id from app.items where company_id=$1 and id=$2 for update',[company,old.product_id]);const locked=await this.find(db,company,id,true);if(locked.version!==input.version)throw new ConflictException();if(input.data.is_default)await db.query('update app.recipes set is_default=false,version=version+1 where company_id=$1 and product_id=$2 and kind=$3 and is_default and id<>$4',[company,old.product_id,old.kind,id]);return(await db.query('update app.recipes set name=$3,active=$4,is_default=$5,notes=$6,version=version+1 where company_id=$1 and id=$2 returning *',[company,id,input.data.name,input.data.active,input.data.is_default,input.data.notes])).rows[0];});}
 @Post(':id/revisions')
 publish(@Req()req:{actor:Actor},@Param('companyId')company:string,@Param('id')id:string,@Body()body:unknown){const input=parse(z.object({version:z.number().int().positive(),data:revisionInput}).strict(),body);return this.run(req.actor,company,true,async db=>{
  const old=await this.find(db,company,id);await db.query('select id from app.items where company_id=$1 and id=$2 for update',[company,old.product_id]);const locked=await this.find(db,company,id,true);if(locked.version!==input.version)throw new ConflictException();
  const next=(await db.query('select coalesce(max(revision),0)+1 as n from app.recipe_revisions where company_id=$1 and recipe_id=$2',[company,id])).rows[0].n;
  const rev=(await db.query('insert into app.recipe_revisions(company_id,recipe_id,revision,base_quantity,pallet_type_id,notes) values($1,$2,$3,$4,$5,$6) returning *',[company,id,next,input.data.base_quantity,input.data.pallet_type_id,input.data.notes])).rows[0];
  for(const l of input.data.lines)await db.query('insert into app.recipe_lines(company_id,revision_id,component_id,kind,level,quantity) values($1,$2,$3,$4,$5,$6)',[company,rev.id,l.component_id,l.kind,l.level,l.quantity]);
  await db.query('update app.recipe_revisions set sealed=true where company_id=$1 and id=$2',[company,rev.id]);
  await db.query('update app.recipes set current_revision_id=$3,version=version+1 where company_id=$1 and id=$2',[company,id,rev.id]);return this.revision(db,company,rev.id);
 });}
 @Post('calculate')
 preview(@Req()req:{actor:Actor},@Param('companyId')company:string,@Body()body:unknown){const input=parse(z.object({quantity,bom_revision_id:uuid.optional(),packing_revision_id:uuid.optional()}).strict(),body);return this.run(req.actor,company,false,async db=>{const bom=input.bom_revision_id?await this.revision(db,company,input.bom_revision_id):undefined,packing=input.packing_revision_id?await this.revision(db,company,input.packing_revision_id):undefined;if(bom&&bom.snapshot.kind!=='bom'||packing&&packing.snapshot.kind!=='packing')throw new BadRequestException();try{return calculate(input.quantity,bom,packing);}catch{throw new BadRequestException('Check units and consumption ownership');}});}
}
