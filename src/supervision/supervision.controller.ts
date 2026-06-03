import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { PostgresExceptionFilter } from '../database/postgres-exception.filter';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbClient } from '../database/db-client.decorator';
import { SupervisionService } from './supervision.service';
import { ListarDiaDto } from './dto/listar-dia.dto';
import { ListarAlertasDto } from './dto/listar-alertas.dto';
import type { JwtPayload } from '../types/express';

@Controller('supervision')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_empresa', 'supervisor')
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class SupervisionController {
  constructor(private readonly service: SupervisionService) {}

  @Get('dia/:fecha?')
  async estadoDia(
    @Param('fecha') fecha: string | undefined,
    @Query() dto: ListarDiaDto,
    @DbClient() db: PoolClient,
  ) {
    return this.service.estadoDia(fecha, dto, db);
  }

  @Get('alertas')
  async alertas(
    @Query() dto: ListarAlertasDto,
    @DbClient() db: PoolClient,
  ) {
    return this.service.alertas(dto, db);
  }

  @Get('trabajadores/:id/semana/:inicio')
  async semanaTrabajador(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inicio') inicio: string,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.semanaTrabajador(id, inicio, user.tenantId, db);
  }
}
