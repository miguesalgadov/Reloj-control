import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { CentrosService } from './centros.service';
import { CrearCentroDto } from './dto/crear-centro.dto';
import { ActualizarCentroDto } from './dto/actualizar-centro.dto';
import { InactivarCentroDto } from './dto/inactivar-centro.dto';
import type { JwtPayload } from '../types/express';

@Controller('centros')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class CentrosController {
  constructor(private readonly service: CentrosService) {}

  @Get()
  @Roles('admin_empresa', 'supervisor')
  async listar(
    @Query('estado') estado?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @DbClient() db?: PoolClient,
  ) {
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200);
    const offset = Math.max(parseInt(offsetStr ?? '0', 10) || 0, 0);
    return this.service.listar(estado, limit, offset, db!);
  }

  @Get(':id')
  @Roles('admin_empresa', 'supervisor')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @DbClient() db: PoolClient,
  ) {
    return this.service.findById(id, db);
  }

  @Post()
  @Roles('admin_empresa')
  async crear(
    @Body() dto: CrearCentroDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.crear(dto, user, db);
  }

  @Patch(':id')
  @Roles('admin_empresa')
  async actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarCentroDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.actualizar(id, dto, user, db);
  }

  @Post(':id/inactivar')
  @Roles('admin_empresa')
  @HttpCode(200)
  async inactivar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InactivarCentroDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.inactivar(id, dto, user, db);
  }
}
