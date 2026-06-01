import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { TrabajadoresService } from './trabajadores.service';
import { ListarTrabajadoresDto } from './dto/listar-trabajadores.dto';
import { CrearTrabajadorDto } from './dto/crear-trabajador.dto';
import { ActualizarTrabajadorDto } from './dto/actualizar-trabajador.dto';
import { DesvincularTrabajadorDto } from './dto/desvincular-trabajador.dto';
import { CrearCuentaTrabajadorDto } from './dto/crear-cuenta-trabajador.dto';
import type { JwtPayload } from '../types/express';

@Controller('trabajadores')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class TrabajadoresController {
  constructor(private readonly service: TrabajadoresService) {}

  @Get()
  @Roles('admin_empresa', 'supervisor')
  async listar(
    @Query() dto: ListarTrabajadoresDto,
    @DbClient() db: PoolClient,
  ) {
    return this.service.listar(dto, db);
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
  @HttpCode(HttpStatus.CREATED)
  async crear(
    @Body() dto: CrearTrabajadorDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.crear(dto, user, db);
  }

  @Patch(':id')
  @Roles('admin_empresa')
  async actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarTrabajadorDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.actualizar(id, dto, user, db);
  }

  @Post(':id/desvincular')
  @Roles('admin_empresa')
  @HttpCode(200)
  async desvincular(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DesvincularTrabajadorDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.desvincular(id, dto, user, db);
  }

  @Post(':id/crear-cuenta')
  @Roles('admin_empresa')
  @HttpCode(HttpStatus.CREATED)
  async crearCuenta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CrearCuentaTrabajadorDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.crearCuenta(id, dto, user, db);
  }
}
