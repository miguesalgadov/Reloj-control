import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { UsuariosService } from './usuarios.service';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto';
import { CrearUsuarioDto } from './dto/crear-usuario.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import { SuspenderUsuarioDto } from './dto/suspender-usuario.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CambiarPasswordDto } from './dto/cambiar-password.dto';
import type { JwtPayload } from '../types/express';

@Controller('usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Get('me')
  async findMe(
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.findMe(user, db);
  }

  @Post('me/cambiar-password')
  @HttpCode(200)
  async cambiarPassword(
    @Body() dto: CambiarPasswordDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.cambiarPassword(dto, user, db);
  }

  @Get()
  @Roles('admin_empresa')
  async listar(
    @Query() dto: ListarUsuariosDto,
    @DbClient() db: PoolClient,
  ) {
    return this.service.listar(dto, db);
  }

  @Post()
  @Roles('admin_empresa')
  async crear(
    @Body() dto: CrearUsuarioDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.crear(dto, user, db);
  }

  @Get(':id')
  @Roles('admin_empresa')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @DbClient() db: PoolClient,
  ) {
    return this.service.findById(id, db);
  }

  @Patch(':id')
  @Roles('admin_empresa')
  async actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarUsuarioDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.actualizar(id, dto, user, db);
  }

  @Post(':id/suspender')
  @Roles('admin_empresa')
  @HttpCode(200)
  async suspender(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspenderUsuarioDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.suspender(id, dto, user, db);
  }

  @Post(':id/reactivar')
  @Roles('admin_empresa')
  @HttpCode(200)
  async reactivar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspenderUsuarioDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.reactivar(id, dto, user, db);
  }

  @Post(':id/reset-password')
  @Roles('admin_empresa')
  @HttpCode(200)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ) {
    return this.service.resetPassword(id, dto, user, db);
  }
}
