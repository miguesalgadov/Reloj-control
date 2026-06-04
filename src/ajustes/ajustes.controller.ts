import {
  Body, Controller, Get, HttpCode, HttpStatus, Param,
  ParseUUIDPipe, Post, Query, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { PostgresExceptionFilter } from '../database/postgres-exception.filter';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbClient } from '../database/db-client.decorator';
import { AjustesService } from './ajustes.service';
import { CrearAjusteDto } from './dto/crear-ajuste.dto';
import { ListarAjustesDto } from './dto/listar-ajustes.dto';
import type { JwtPayload } from '../types/express';

@Controller('ajustes')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class AjustesController {
  constructor(private readonly service: AjustesService) {}

  @Post()
  @Roles('admin_empresa')
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body() dto: CrearAjusteDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.crear(dto, user, db);
  }

  @Get()
  @Roles('admin_empresa', 'supervisor')
  async listar(
    @Query() dto: ListarAjustesDto,
    @DbClient() db: PoolClient,
  ) {
    return this.service.listar(dto, db);
  }

  @Get(':id')
  @Roles('admin_empresa', 'supervisor')
  async detalle(
    @Param('id', ParseUUIDPipe) id: string,
    @DbClient() db: PoolClient,
  ) {
    return this.service.detalle(id, db);
  }
}
