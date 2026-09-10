import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, SetMetadata, UnauthorizedException, ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { AppConfig } from './config';

export const APP_CONFIG = Symbol('app-config');
export const PUBLIC_ROUTE = 'public-route';
export const AUTH_REQUIRED = 'auth-required';
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE, true);
export const AuthRequired = () => SetMetadata(AUTH_REQUIRED, true);
export type Actor = { userId: string; sessionId: string; email: string };
const uuid = z.string().uuid();

@Injectable()
export class SupabaseIdentity {
  private windowStart = Date.now();
  private validations = 0;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async verify(token: string): Promise<Actor> {
    if (!this.config.SUPABASE_URL || !this.config.SUPABASE_PUBLISHABLE_KEY) throw new ServiceUnavailableException();
    if (token.length > 8192 || token.split('.').length !== 3) throw new UnauthorizedException();
    // Bounded per-process Auth traffic; no paid rate-limit service or token logging.
    if (Date.now() - this.windowStart >= 60000) { this.windowStart = Date.now(); this.validations = 0; }
    if (++this.validations > 300) throw new HttpException('Too many authentication requests', 429);
    let response: Response;
    try {
      // Online Auth validation handles both asymmetric and legacy signing keys.
      // Never trust decoded claims before the Auth server verifies this exact token.
      response = await fetch(`${this.config.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: this.config.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
    } catch { throw new ServiceUnavailableException(); }
    if (response.status === 401 || response.status === 403) throw new UnauthorizedException();
    if (!response.ok) throw new ServiceUnavailableException();
    try {
      const user = await response.json();
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
      const userId = uuid.parse(user.id);
      const sessionId = uuid.parse(claims.session_id);
      if (claims.sub !== userId || claims.role !== 'authenticated' || user.is_anonymous === true ||
          claims.iss !== `${this.config.SUPABASE_URL}/auth/v1` ||
          !(claims.aud === 'authenticated' || (Array.isArray(claims.aud) && claims.aud.includes('authenticated'))) ||
          typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000 ||
          (typeof claims.nbf === 'number' && claims.nbf > Date.now() / 1000)) throw new Error();
      return { userId, sessionId, email: typeof user.email === 'string' ? user.email : '' };
    } catch { throw new UnauthorizedException(); }
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SupabaseIdentity) private readonly identity: SupabaseIdentity) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.get<boolean>(PUBLIC_ROUTE, context.getHandler())) return true;
    // New controllers must opt into authenticated routing; no implicit authorization.
    if (!this.reflector.getAllAndOverride<boolean>(AUTH_REQUIRED, [context.getHandler(), context.getClass()])) throw new ForbiddenException();
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [^\s]+$/.test(header)) throw new UnauthorizedException();
    request.actor = await this.identity.verify(header.slice(7));
    return true;
  }
}
