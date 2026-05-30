import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DbClient } from '../database/db-client.decorator';
import { PostgresExceptionFilter } from '../database/postgres-exception.filter';
import { MarcacionesService, MarcacionRow } from './marcaciones.service';
import { CrearMarcacionDto } from './dto/crear-marcacion.dto';
import type { JwtPayload } from '../types/express';

/**
 * Toda esta familia de rutas requiere autenticacion (JwtAuthGuard) y se
 * ejecuta dentro de una transaccion con tenant seteado (TenantInterceptor).
 * Los errores Postgres se traducen a HTTP via PostgresExceptionFilter.
 *
 * ORDEN IMPORTA:
 *   Guards corren antes que Interceptors. Por eso req.user existe cuando
 *   TenantInterceptor lee tenantId.
 */
@Controller('marcaciones')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class MarcacionesController {
  constructor(private readonly service: MarcacionesService) {}

  @Post()
  async crear(
    @Body() dto: CrearMarcacionDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
    @Req() req: Request,
  ): Promise<MarcacionRow> {
    return this.service.crear(
      dto,
      user,
      req.ip ?? null,
      req.headers['user-agent'] ?? null,
      db,
    );
  }

  @Get('mias')
  async listarMias(
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
    @Query('limit') limit?: string,
  ): Promise<MarcacionRow[]> {
    const limNum = limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50;
    return this.service.listarMias(user, db, limNum);
  }
}
