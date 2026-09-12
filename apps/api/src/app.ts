import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ArgumentsHost, CanActivate, Catch, Controller, ExecutionContext, ExceptionFilter, Get, HttpException, Inject, Injectable, Module, ServiceUnavailableException, SetMetadata, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApiOperation, ApiResponse, ApiTags, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { AppConfig } from './config';
import { DatabaseService } from './database';
import { APP_CONFIG, AccessGuard, PUBLIC_ROUTE, SupabaseIdentity } from './auth';
import { AccessController } from './access';
import { MasterdataController } from './masterdata';
import { ReceivingController } from './receiving';
import { InventoryController } from './inventory';
import { LocationsController } from './locations';
import { RecipesController } from './recipes';
import { ItemsController } from './items';
import { ItemPhotosController, ItemPhotoStorage } from './item-photos';

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code = (exception as { code?: string })?.code;
    const status = exception instanceof HttpException ? exception.getStatus() : ['22003','23505','23503','23514','40001','40P01'].includes(code ?? '') ? 409 : code === '42501' ? 403 : 500;
    response.status(status).json({
      statusCode: status,
      message: status === 503 ? 'Service unavailable' : status === 401 ? 'Unauthorized' : status === 404 ? 'Not found' : status >= 500 ? 'Internal server error' : 'Request rejected',
      requestId: response.getHeader('X-Request-Id'),
    });
  }
}

@ApiTags('Health')
@Controller('health')
class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('live')
  @SetMetadata(PUBLIC_ROUTE, true)
  @ApiOperation({ summary: 'Process liveness; does not assert database availability' })
  @ApiResponse({ status: 200, description: 'API process is running' })
  live() { return { status: 'ok' }; }

  @Get('ready')
  @SetMetadata(PUBLIC_ROUTE, true)
  @ApiOperation({ summary: 'Database connectivity and restricted-role readiness' })
  @ApiResponse({ status: 200, description: 'Database role and schemas ready' })
  @ApiResponse({ status: 503, description: 'Database missing, unreachable or incorrectly privileged' })
  async ready() {
    if (!await this.database.ready()) throw new ServiceUnavailableException();
    return { status: 'ready' };
  }
}

@Module({})
class AppModule {}

export async function createApp(config: AppConfig, database = new DatabaseService(config)) {
  const app = await NestFactory.create<NestExpressApplication>({
    module: AppModule,
    controllers: [ReceivingController,InventoryController,HealthController, AccessController, MasterdataController, ItemsController, ItemPhotosController, RecipesController, LocationsController],
    providers: [{ provide: DatabaseService, useValue: database }, { provide: APP_CONFIG, useValue: config }, SupabaseIdentity, ItemPhotoStorage, { provide: APP_GUARD, useClass: AccessGuard }],
  }, { logger: config.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'], bodyParser: false });

  app.set('trust proxy', false);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', randomUUID());
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({ origin: config.origins, credentials: false, methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH'], allowedHeaders: ['Content-Type', 'Authorization'] });
  app.use(/^\/api\/companies\/[^/]+\/items\/(?:product|material|packaging)\/[^/]+\/photo$/, json({ limit: '1500kb' }));
  app.use(json({ limit: '64kb' }));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new SafeExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  if (config.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Lagerstyring · Access API').setVersion('0.1.0').build());
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}
