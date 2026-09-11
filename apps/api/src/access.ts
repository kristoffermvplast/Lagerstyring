import { Body, Controller, Get, Inject, Patch, Post, Param, Req, BadRequestException, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { AuthRequired, Actor } from './auth';
import { DatabaseService } from './database';

const uuid = z.string().uuid();
const profileBody = z.object({ displayName: z.string().trim().min(1).max(120) }).strict();
const memberBody = z.object({ userId: uuid, roleId: uuid }).strict();
const changeMemberBody = z.object({ roleId: uuid, active: z.boolean(), version: z.number().int().positive() }).strict();
const roleBody = z.object({ name: z.string().trim().min(1).max(80), permissions: z.array(z.enum(['access.read','access.manage','masterdata.read','masterdata.manage'])).max(4) }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException();
  return result.data;
}
async function authorize(client: PoolClient, permission: string) {
  const result = await client.query('select app.allowed($1) as allowed', [permission]);
  if (result.rows[0]?.allowed !== true) throw new ForbiddenException();
}

@AuthRequired()
@Controller()
export class AccessController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get('me')
  async me(@Req() req: { actor: Actor }) {
    return this.database.asActor(req.actor, null, async client => {
      await client.query('insert into app.profiles(id) values($1) on conflict do nothing', [req.actor.userId]);
      const profile = await client.query('select id,display_name from app.profiles where id=$1', [req.actor.userId]);
      const memberships = await client.query(`select m.company_id,c.name,m.role_id from app.memberships m
        join app.companies c on c.id=m.company_id where m.user_id=$1 and m.active and c.active order by c.name`, [req.actor.userId]);
      return { user: { ...profile.rows[0], email: req.actor.email }, memberships: memberships.rows };
    });
  }
  @Patch('me')
  async profile(@Req() req: { actor: Actor }, @Body() body: unknown) {
    const input = parse(profileBody, body);
    return this.database.asActor(req.actor, null, async client => {
      await client.query('insert into app.profiles(id,display_name) values($1,$2) on conflict(id) do update set display_name=excluded.display_name', [req.actor.userId,input.displayName]);
      return { saved: true };
    });
  }
  @Post('auth/logout')
  async logout(@Req() req: { actor: Actor }) {
    return this.database.asActor(req.actor, null, async client => {
      await client.query('insert into app.profiles(id) values($1) on conflict do nothing', [req.actor.userId]);
      await client.query('insert into app.revoked_sessions(session_id,user_id) values($1,$2) on conflict do nothing',[req.actor.sessionId,req.actor.userId]);
      return { revoked: true };
    });
  }
  @Get('companies/:companyId/access')
  async access(@Req() req: { actor: Actor }, @Param('companyId') id: string) {
    const companyId = parse(uuid,id);
    return this.database.asActor(req.actor,companyId,async client => {
      const member = await client.query('select app.is_member($1) as member', [companyId]);
      if (!member.rows[0]?.member) throw new ForbiddenException();
      const permissions = await client.query('select code,description from app.permissions where app.allowed(code) order by code');
      return { permissions: permissions.rows };
    });
  }
  @Get('companies/:companyId/members')
  async members(@Req() req: { actor: Actor }, @Param('companyId') id: string) {
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.read');
      return (await client.query('select m.user_id,p.display_name,m.role_id,m.active,m.version from app.memberships m join app.profiles p on p.id=m.user_id where m.company_id=$1 order by m.user_id limit 500',[id])).rows;
    });
  }
  @Get('companies/:companyId/roles')
  async roles(@Req() req: { actor: Actor }, @Param('companyId') id: string) {
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.read');
      return (await client.query(`select r.id,r.name,r.is_admin,coalesce(array_agg(p.permission_code) filter(where p.permission_code is not null),'{}') as permissions
        from app.roles r left join app.role_permissions p on p.company_id=r.company_id and p.role_id=r.id where r.company_id=$1 group by r.id order by r.name`,[id])).rows;
    });
  }
  @Post('companies/:companyId/members')
  async addMember(@Req() req: { actor: Actor }, @Param('companyId') id: string, @Body() body: unknown) {
    const input = parse(memberBody,body);
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.manage');
      await client.query('insert into app.memberships(company_id,user_id,role_id) values($1,$2,$3)',[id,input.userId,input.roleId]);
      return { saved: true };
    });
  }
  @Patch('companies/:companyId/members/:userId')
  async changeMember(@Req() req: { actor: Actor }, @Param('companyId') id: string, @Param('userId') userId: string, @Body() body: unknown) {
    const input = parse(changeMemberBody,body); parse(uuid,userId);
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.manage');
      const result = await client.query('update app.memberships set role_id=$3,active=$4,version=version+1 where company_id=$1 and user_id=$2 and version=$5 returning user_id',[id,userId,input.roleId,input.active,input.version]);
      if (!result.rowCount) throw new ConflictException();
      return { saved: true };
    });
  }
  @Post('companies/:companyId/roles')
  async createRole(@Req() req: { actor: Actor }, @Param('companyId') id: string, @Body() body: unknown) {
    const input = parse(roleBody,body);
    if ((input.permissions.includes('access.manage') && !input.permissions.includes('access.read')) || (input.permissions.includes('masterdata.manage') && !input.permissions.includes('masterdata.read'))) throw new BadRequestException();
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.manage');
      const result = await client.query('insert into app.roles(company_id,name) values($1,$2) returning id',[id,input.name]);
      const roleId = result.rows[0].id;
      for (const permission of new Set(input.permissions)) await client.query('insert into app.role_permissions(company_id,role_id,permission_code) values($1,$2,$3)',[id,roleId,permission]);
      return { id: roleId };
    });
  }
  @Patch('companies/:companyId/roles/:roleId')
  async changeRole(@Req() req: { actor: Actor }, @Param('companyId') id: string, @Param('roleId') roleId: string, @Body() body: unknown) {
    const input = parse(roleBody,body); parse(uuid,roleId);
    if ((input.permissions.includes('access.manage') && !input.permissions.includes('access.read')) || (input.permissions.includes('masterdata.manage') && !input.permissions.includes('masterdata.read'))) throw new BadRequestException();
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.manage');
      const result = await client.query('update app.roles set name=$3 where company_id=$1 and id=$2 and not is_admin returning id',[id,roleId,input.name]);
      if (!result.rowCount) throw new NotFoundException();
      await client.query('delete from app.role_permissions where company_id=$1 and role_id=$2',[id,roleId]);
      for (const permission of new Set(input.permissions)) await client.query('insert into app.role_permissions(company_id,role_id,permission_code) values($1,$2,$3)',[id,roleId,permission]);
      return { saved: true };
    });
  }
  @Get('companies/:companyId/access-audit')
  async audit(@Req() req: { actor: Actor }, @Param('companyId') id: string) {
    return this.database.asActor(req.actor,parse(uuid,id),async client => {
      await authorize(client,'access.read');
      return (await client.query('select id,actor_id,action,target_id,before_value,after_value,occurred_at from app.access_audit where company_id=$1 order by occurred_at desc limit 100',[id])).rows;
    });
  }
}
