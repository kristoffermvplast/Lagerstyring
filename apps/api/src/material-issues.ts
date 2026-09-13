import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Inject,NotFoundException,Param,Post,Query,Req} from '@nestjs/common';
import {PoolClient} from 'pg';
import {z} from 'zod';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
const uuid=z.string().uuid();
const input=z.object({idempotency_key:uuid,item_id:uuid,owner_id:uuid,from_location_id:uuid,to_location_id:uuid,quantity:z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/).refine(x=>!/^0(\.0+)?$/.test(x)),comment:z.string().trim().max(1000).default('')}).strict().refine(x=>x.from_location_id!==x.to_location_id);
function parse<T>(schema:z.ZodType<T>,v:unknown):T{const r=schema.safeParse(v);if(!r.success)throw new BadRequestException();return r.data;}
@AuthRequired()
@Controller('companies/:companyId/production-orders/:orderId/material-issues')
export class MaterialIssuesController{
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 private run<T>(actor:Actor,c:string,write:boolean,work:(db:PoolClient)=>Promise<T>){parse(uuid,c);return this.database.asActor(actor,c,async db=>{const p=(await db.query("select app.allowed('production.read') and app.allowed('inventory.read') as read,app.allowed('production.issue') and app.allowed('inventory.transfer') as issue")).rows[0];if(!p?.read||write&&!p.issue)throw new ForbiddenException();return work(db);});}
 private async order(db:PoolClient,c:string,id:string){parse(uuid,id);const r=(await db.query('select id,code,status,machine_id,snapshot,problem from app.production_orders where company_id=$1 and id=$2',[c,id])).rows[0];if(!r)throw new NotFoundException();return r;}
 private async entry(db:PoolClient,c:string,order:string,id:string){parse(uuid,id);const e=(await db.query('select * from app.inventory_entries where company_id=$1 and production_order_id=$2 and id=$3',[c,order,id])).rows[0];if(!e)throw new NotFoundException();return {...e,lines:(await db.query('select * from app.inventory_lines where company_id=$1 and entry_id=$2 order by quantity',[c,id])).rows};}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')id:string,@Query()raw:unknown){const q=parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1)}).strict(),raw);return this.run(r.actor,c,false,async db=>{await this.order(db,c,id);const where='company_id=$1 and production_order_id=$2';return {items:(await db.query('select * from app.inventory_entries where '+where+' order by posted_at desc,id desc limit 25 offset $3',[c,id,(q.page-1)*25])).rows,total:(await db.query('select count(*)::int total from app.inventory_entries where '+where,[c,id])).rows[0].total};});}
 @Get('options')
 options(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')id:string){return this.run(r.actor,c,false,async db=>{const o=await this.order(db,c,id);const components=[...(o.snapshot.bom?.lines??[]),...(o.snapshot.packing?.lines??[])].map((l:any)=>({id:l.component_id,...l.snapshot}));const m=o.machine_id?(await db.query('select location_id from app.machines where company_id=$1 and id=$2',[c,o.machine_id])).rows[0]:null;return {components,machine_location_id:m?.location_id??null};});}
 @Get(':id')
 detail(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')order:string,@Param('id')id:string){return this.run(r.actor,c,false,async db=>{await this.order(db,c,order);return this.entry(db,c,order,id);});}
 @Post()
 async issue(@Req()r:{actor:Actor},@Param('companyId')c:string,@Param('orderId')order:string,@Body()raw:unknown){parse(uuid,order);const b=parse(input,raw),reason=b.comment||'Materiale til produktion';if(reason.length<3)throw new BadRequestException();const lines=JSON.stringify([{item_id:b.item_id,owner_id:b.owner_id,location_id:b.from_location_id,quantity:'-'+b.quantity},{item_id:b.item_id,owner_id:b.owner_id,location_id:b.to_location_id,quantity:b.quantity}]);
  for(let attempt=0;;attempt++)try{return await this.run(r.actor,c,true,async db=>{await this.order(db,c,order);const old=(await db.query("select id,(kind='transfer' and production_order_id=$3 and reason=$4 and request=$5::jsonb) as same from app.inventory_entries where company_id=$1 and idempotency_key=$2",[c,b.idempotency_key,order,reason,lines])).rows[0];if(old){if(!old.same)throw new ConflictException();return this.entry(db,c,order,old.id);}const e=(await db.query("insert into app.inventory_entries(company_id,idempotency_key,kind,reason,request,production_order_id) values($1,$2,'transfer',$3,$4,$5) returning id",[c,b.idempotency_key,reason,lines,order])).rows[0];return this.entry(db,c,order,e.id);});}catch(e:any){if(attempt<2&&(['40001','40P01'].includes(e?.code)||e?.code==='23505'&&e?.constraint==='inventory_entries_company_id_idempotency_key_key'))continue;throw e;}
 }
}
