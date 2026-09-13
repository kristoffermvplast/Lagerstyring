import {BadRequestException,Controller,ForbiddenException,Get,Inject,Param,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {Actor,AuthRequired} from './auth';
import {DatabaseService} from './database';
import {readAnalysis} from './production-waste';
const filter=z.string().trim().max(100).default('');
@AuthRequired()
@Controller('companies/:companyId/production-analysis')
export class ProductionAnalysisController {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService){}
 @Get()
 list(@Req()r:{actor:Actor},@Param('companyId')c:string,@Query()raw:unknown){
  const parsed=z.object({from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional(),product:filter,material:filter,machine:filter,customer:filter,page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().safeParse(raw);
  if(!z.string().uuid().safeParse(c).success||!parsed.success)throw new BadRequestException();const q=parsed.data;
  if(q.from&&q.to&&Date.parse(q.from)>Date.parse(q.to))throw new BadRequestException();
  return this.database.asActor(r.actor,c,async db=>{
   if(!(await db.query("select app.allowed('production.read') and app.allowed('inventory.read') as ok")).rows[0]?.ok)throw new ForbiddenException();
   const where=`company_id=$1 and ($2::timestamptz is null or created_at >= $2) and ($3::timestamptz is null or created_at <= $3)
    and coalesce(snapshot->'order_snapshot'->'product'->>'name','') ilike $4
    and coalesce(snapshot->'order_snapshot'->'machine'->>'name','') ilike $5
    and coalesce(snapshot->'order_snapshot'->'customer'->>'name','') ilike $6
    and ($7='' or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'materials','[]')) m where m->'snapshot'->'item'->>'name' ilike '%'||$7||'%')
      or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'order_snapshot'->'bom'->'lines','[]')) m where m->'snapshot'->>'name' ilike '%'||$7||'%')
      or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'order_snapshot'->'packing'->'lines','[]')) m where m->'snapshot'->>'name' ilike '%'||$7||'%'))`;
   const p=[c,q.from??null,q.to??null,'%'+q.product+'%','%'+q.machine+'%','%'+q.customer+'%',q.material];
   const total=(await db.query('select count(*)::int total from app.production_closures where '+where,p)).rows[0].total;
   const rows=(await db.query('select order_id,created_at,snapshot from app.production_closures where '+where+' order by created_at desc,id desc limit 25 offset $8',[...p,(q.page-1)*25])).rows;
   const items=[];for(const row of rows){const a=await readAnalysis(db,c,row.order_id);items.push({...a,completed_at:row.created_at,product:row.snapshot.order_snapshot.product,machine:row.snapshot.order_snapshot.machine,customer:row.snapshot.order_snapshot.customer});}
   return {items,total,page:q.page,scope:'COMPLETED_ORDERS',percentages:'PER_MATERIAL_AND_ORDER_NO_CROSS_UNIT_TOTAL',waste_basis:'CURRENT_UNREVERSED_OBSERVATIONS'};
  });
 }
}
