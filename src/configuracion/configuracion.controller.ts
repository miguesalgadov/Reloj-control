import { Body, Controller, Patch, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DbClient } from '../database/db-client.decorator';
import { PostgresExceptionFilter } from '../database/postgres-exception.filter';
import { ConfiguracionService } from './configuracion.service';
import { ActualizarConfiguracionJornadaDto } from './dto/actualizar-configuracion-jornada.dto';
import type { JwtPayload } from '../types/express';

@Controller('configuracion')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class ConfiguracionController {
  constructor(private readonly service: ConfiguracionService) {}

  @Patch('jornada')
  @Roles('admin_empresa')
  async actualizarJornada(
    @Body() dto: ActualizarConfiguracionJornadaDto,
    @CurrentUser() user: JwtPayload,
    @DbClient() db: PoolClient,
  ): Promise<Record<string, unknown>> {
    return this.service.actualizarJornada(user.tenantId, dto, db);
  }
}
