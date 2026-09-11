import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthRequired, Actor } from './auth';
import { DatabaseService } from './database';
import { PoolClient } from 'pg';

// Decimal quantities travel as strings, never binary floating-point numbers.
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/).nullable().default(null);
const reference = z.string().uuid().nullable().default(null);
const text = (max: number) => z.string().max(max).default('');
const kindSchema = z.enum(['product', 'material', 'packaging']);
const quantities = ['minimum_stock', 'desired_stock', 'maximum_stock', 'reorder_level', 'standard_order_quantity', 'quantity_per_pallet'] as const;
const inputSchema = z.object({
 code: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(160),
 active: z.boolean().default(true), description: text(4000), notes: text(4000),
 unit_id: reference, customer_id: reference, supplier_id: reference, product_group_id: reference,
 material_type_id: reference, standard_machine_id: reference,
 supplier_code: text(100), color: text(120), production_notes: text(4000),
 minimum_stock: decimal, desired_stock: decimal, maximum_stock: decimal,
 reorder_level: decimal, standard_order_quantity: decimal, quantity_per_pallet: decimal,
 lead_time_days: z.number().int().min(0).max(3650).nullable().default(null),
 cavities: z.number().int().min(1).max(100000).nullable().default(null), cycle_time_seconds: decimal,
}).strict();
const uuid = z.string().uuid();
const querySchema = z.object({
 q: z.string().trim().max(120).default(''), active: z.enum(['true', 'false', 'all']).default('all'),
 page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
 sort: z.enum(['code', 'name']).default('code'), direction: z.enum(['asc', 'desc']).default('asc'),
 customer_id: uuid.optional(), supplier_id: uuid.optional(), product_group_id: uuid.optional(), material_type_id: uuid.optional(),
}).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
 const result = schema.safeParse(value); if (!result.success) throw new BadRequestException(); return result.data;
}
function scaled(value: string): bigint { const [integer, fraction = ''] = value.split('.'); return BigInt(integer! + fraction.padEnd(8, '0')); }
function validate(input: z.infer<typeof inputSchema>, kind: string) {
 if (!input.unit_id && quantities.some(q => input[q] !== null)) throw new BadRequestException('Choose a unit first');
 if (input.cycle_time_seconds !== null && scaled(input.cycle_time_seconds) <= 0n) throw new BadRequestException();
 if (kind !== 'product' && (input.customer_id || input.standard_machine_id || input.cavities || input.cycle_time_seconds || input.production_notes)) throw new BadRequestException();
 if (kind === 'product' && (input.supplier_id || input.material_type_id || input.supplier_code || input.lead_time_days !== null)) throw new BadRequestException();
 for (const [lower, upper] of [['minimum_stock','desired_stock'],['minimum_stock','maximum_stock'],['desired_stock','maximum_stock']] as const) {
  if (input[lower] !== null && input[upper] !== null && scaled(input[lower]) > scaled(input[upper])) throw new BadRequestException();
 }
}
@AuthRequired()
@Controller('companies/:companyId/items/:kind')
export class ItemsController {
 constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
 private async run<T>(actor: Actor, company: string, write: boolean, work: (client: PoolClient) => Promise<T>) {
  return this.database.asActor(actor, parse(uuid, company), async client => {
   const { rows } = await client.query("select app.allowed('masterdata.read') as read, app.allowed('masterdata.manage') as manage");
   if (!rows[0]?.read || (write && !rows[0]?.manage)) throw new ForbiddenException();
   return work(client);
  });
 }
 @Get()
 async list(@Req() req: { actor: Actor }, @Param('companyId') company: string, @Param('kind') rawKind: string, @Query() query: unknown) {
  const kind = parse(kindSchema, rawKind), input = parse(querySchema, query);
  return this.run(req.actor, company, false, async client => {
   const params: unknown[] = [company, kind, '%'+input.q.replace(/[\\%_]/g,'\\$&')+'%', input.active === 'all' ? null : input.active === 'true'];
   let where = 'company_id=$1 AND kind=$2 AND (code ILIKE $3 OR name ILIKE $3) AND ($4::boolean IS NULL OR active=$4)';
   for (const field of ['customer_id','supplier_id','product_group_id','material_type_id'] as const) {
    if (input[field]) { params.push(input[field]); where += ` AND ${field}=$${params.length}`; }
   }
   const count = await client.query(`select count(*)::int as total from app.items where ${where}`, params);
   params.push(input.limit, (input.page-1)*input.limit);
   const result = await client.query(`select * from app.items where ${where} order by ${input.sort} ${input.direction},id limit $${params.length-1} offset $${params.length}`, params);
   return { items: result.rows, total: count.rows[0].total, page: input.page, limit: input.limit };
  });
 }
 @Get(':id')
 async detail(@Req() req: { actor: Actor }, @Param('companyId') company: string, @Param('kind') rawKind: string, @Param('id') id: string) {
  const kind = parse(kindSchema, rawKind); parse(uuid, id);
  return this.run(req.actor, company, false, client => this.find(client, company, kind, id));
 }
 @Get(':id/history')
 async history(@Req() req: { actor: Actor }, @Param('companyId') company: string, @Param('kind') rawKind: string, @Param('id') id: string) {
  const kind = parse(kindSchema, rawKind); parse(uuid, id);
  return this.run(req.actor, company, false, async client => {
   await this.find(client, company, kind, id);
   return (await client.query("select id,actor_id,action,before_value,after_value,occurred_at from app.masterdata_audit where company_id=$1 and entity_type='items' and entity_id=$2 order by occurred_at desc,id desc limit 100", [company,id])).rows;
  });
 }
 @Post()
 async create(@Req() req: { actor: Actor }, @Param('companyId') company: string, @Param('kind') rawKind: string, @Body() body: unknown) {
  const kind = parse(kindSchema, rawKind), input = parse(inputSchema, body); validate(input,kind);
  return this.run(req.actor, company, true, async client => {
   const columns = Object.keys(input);
   return (await client.query(`insert into app.items(company_id,kind,${columns.join(',')}) values($1,$2,${columns.map((_,i)=>'$'+(i+3)).join(',')}) returning *`, [company,kind,...Object.values(input)])).rows[0];
  });
 }
 @Patch(':id')
 async update(@Req() req: { actor: Actor }, @Param('companyId') company: string, @Param('kind') rawKind: string, @Param('id') id: string, @Body() body: unknown) {
  const kind = parse(kindSchema, rawKind); parse(uuid,id);
  const envelope = parse(z.object({version:z.number().int().positive(),data:inputSchema}).strict(),body);
  validate(envelope.data,kind);
  return this.run(req.actor, company, true, async client => {
   const old = await this.find(client,company,kind,id,true);
   if (old.version !== envelope.version) throw new ConflictException();
   const columns = Object.keys(envelope.data);
   return (await client.query(`update app.items set ${columns.map((c,i)=>`${c}=$${i+4}`).join(',')},version=version+1 where company_id=$1 and kind=$2 and id=$3 returning *`,[company,kind,id,...Object.values(envelope.data)])).rows[0];
  });
 }
 private async find(client: PoolClient, company: string, kind: string, id: string, lock=false) {
  const result = await client.query(`select * from app.items where company_id=$1 and kind=$2 and id=$3${lock?' for update':''}`,[company,kind,id]);
  if (!result.rowCount) throw new NotFoundException(); return result.rows[0];
 }
}
