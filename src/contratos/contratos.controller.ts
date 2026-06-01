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
  Put,
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
import { ContratosService } from './contratos.service';
import { ListarContratosDto } from './dto/listar-contratos.dto';
import { CrearContratoDto } from './dto/crear-contrato.dto';
import { ActualizarContratoDto } from './dto/actualizar-contrato.dto';
import { TerminarContratoDto } from './dto/terminar-contrato.dto';
import { SetJornadasDto } from './dto/set-jornadas.dto';
import type { JwtPayload } from '../types/express';

@Controller('contratos')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class ContratosController {
  constructor(private readonly service: ContratosService) {}

  @Get()
  @Roles('admin_empresa', 'supervisor')
  async listar(
    @Query() dto: ListarContratosDto,
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
    @Body() dto: CrearContratoDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.crear(dto, user, db);
  }

  @Patch(':id')
  @Roles('admin_empresa')
  async actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarContratoDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.actualizar(id, dto, user, db);
  }

  @Post(':id/terminar')
  @Roles('admin_empresa')
  @HttpCode(200)
  async terminar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminarContratoDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.terminar(id, dto, user, db);
  }

  @Get(':contratoId/jornadas')
  @Roles('admin_empresa', 'supervisor')
  async getJornadas(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @DbClient() db: PoolClient,
  ) {
    return this.service.getJornadas(contratoId, db);
  }

  @Put(':contratoId/jornadas')
  @Roles('admin_empresa')
  @HttpCode(200)
  async setJornadas(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @Body() dto: SetJornadasDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.setJornadas(contratoId, dto, user, db);
  }
}
