import { Controller, Get, Param, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DbClient } from '../database/db-client.decorator';
import { PostgresExceptionFilter } from '../database/postgres-exception.filter';
import { JornadaService } from './jornada.service';
import { ResultadoJornadaDia, ResultadoSemana } from './types';
import type { JwtPayload } from '../types/express';

@Controller('jornadas')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class JornadaController {
  constructor(private readonly service: JornadaService) {}

  // 'hoy' must be declared before ':fecha' to avoid route capture
  @Get('hoy')
  async getHoy(
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ): Promise<ResultadoJornadaDia> {
    return this.service.getHoy(user, db);
  }

  @Get('semana/actual')
  async getSemanaActual(
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ): Promise<ResultadoSemana> {
    return this.service.getSemanaDeHoy(user, db);
  }

  @Get('semana/:inicio')
  async getSemana(
    @Param('inicio') inicio: string,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ): Promise<ResultadoSemana> {
    return this.service.getSemana(user, inicio, db);
  }

  @Get(':fecha')
  async getFecha(
    @Param('fecha') fecha: string,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ): Promise<ResultadoJornadaDia> {
    return this.service.getFecha(user, fecha, db);
  }
}
