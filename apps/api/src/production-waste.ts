import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
import {analyzeMaterials} from './material-analysis';
const uuid=z.string().uuid();
const comment=z.string().trim().min(3).max(2000);
function parse<T>(s:z.ZodType<T>,v:unknown):T{const r=s.safeParse(v);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/production-orders/:orderId/waste')
export class ProductionWasteController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private async run<T>(actor:Actor,c:string,permission:string|null,work:(db:PoolClient)=>Promise<T>):Promise<T>{parse(uuid,c);for(let attempt=0;;attempt++)try{return await this.database.asActor(actor,c,async db=>{const p=(await db.query("select app.allowed('production.read') and app.allowed('inventory.read') and app.allowed($1) as allowed",[permission??'production.read'])).rows[0];if(!p?.allowed)throw new ForbiddenException();return work(db);});}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='production_waste_company_id_idempotency_key_key'))continue;throw e;}}
 private async order(db:PoolClient,c:string,o:string){parse(uuid,o);const r=(await db.query('select * from app.production_orders where company_id=$1 and id=$2',[c,o])).rows[0];if(!r)throw new NotFoundException();return r;}
 @Get('analysis')
 analysis(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')o:string){return this.run(r.actor,c,null,async db=>{await this.order(db,c,o);return readAnalysis(db,c,o);});}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')o:string,@Query()raw:unknown){const q=parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict(),raw);return this.run(r.actor,c,null,async db=>{await this.order(db,c,o);return {items:(await db.query('select w.*,exists(select 1 from app.production_waste v where v.company_id=w.company_id and v.reverses_id=w.id) as reversed from app.production_waste w where company_id=$1 and order_id=$2 order by created_at desc,id desc limit 25 offset $3',[c,o,(q.page-1)*25])).rows,total:(await db.query('select count(*)::int total from app.production_waste where company_id=$1 and order_id=$2',[c,o])).rows[0].total};});}
 @Get(':id')
 detail(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')o:string,@Param('id')id:string){parse(uuid,id);return this.run(r.actor,c,null,async db=>{await this.order(db,c,o);const row=(await db.query('select * from app.production_waste where company_id=$1 and order_id=$2 and id=$3',[c,o,id])).rows[0];if(!row)throw new NotFoundException();return row;});}
 @Post()
 record(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')o:string,@Body()raw:unknown){const b=parse(z.object({idempotency_key:uuid,issue_id:uuid,quantity:z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/).refine(x=>!/^0(\.0+)?$/.test(x)),comment}).strict(),raw);return this.run(r.actor,c,'production.waste',async db=>{await this.order(db,c,o);const old=(await db.query('select *,quantity=$3::numeric as same from app.production_waste where company_id=$1 and idempotency_key=$2',[c,b.idempotency_key,b.quantity])).rows[0];if(old){if(old.order_id!==o||old.kind!=='record'||old.issue_id!==b.issue_id||!old.same||old.comment!==b.comment)throw new ConflictException();return old;}return(await db.query("insert into app.production_waste(company_id,order_id,idempotency_key,kind,issue_id,quantity,comment) values($1,$2,$3,'record',$4,$5,$6) returning *",[c,o,b.idempotency_key,b.issue_id,b.quantity,b.comment])).rows[0];});}
 @Post(':id/reverse')
 reverse(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')o:string,@Param('id')id:string,@Body()raw:unknown){parse(uuid,id);const b=parse(z.object({idempotency_key:uuid,comment}).strict(),raw);return this.run(r.actor,c,'production.waste.correct',async db=>{await this.order(db,c,o);const old=(await db.query('select * from app.production_waste where company_id=$1 and idempotency_key=$2',[c,b.idempotency_key])).rows[0];if(old){if(old.order_id!==o||old.kind!=='reversal'||old.reverses_id!==id||old.comment!==b.comment)throw new ConflictException();return old;}if(!(await db.query("select id from app.production_waste where company_id=$1 and order_id=$2 and id=$3 and kind='record'",[c,o,id])).rows[0])throw new NotFoundException();return(await db.query("insert into app.production_waste(company_id,order_id,idempotency_key,kind,quantity,comment,reverses_id) values($1,$2,$3,'reversal',1,$4,$5) returning *",[c,o,b.idempotency_key,b.comment,id])).rows[0];});}
}

export async function readAnalysis(db:PoolClient,c:string,o:string){const closure=(await db.query('select snapshot from app.production_closures where company_id=$1 and order_id=$2',[c,o])).rows[0];const review=closure?{...closure.snapshot,company_id:c,order_id:o,status:'completed'}:(await db.query('select app.production_close_review($1,$2) as review',[c,o])).rows[0].review;const rows=(await db.query("select w.* from app.production_waste w where company_id=$1 and order_id=$2 and kind='record' and not exists(select 1 from app.production_waste r where r.company_id=w.company_id and r.reverses_id=w.id)",[c,o])).rows;return analyzeMaterials(review,rows);}
