import {
  Controller, Get, HttpStatus, Param, Query,
  Res, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { PoolClient } from 'pg';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { PostgresExceptionFilter } from '../database/postgres-exception.filter';
import { DbClient } from '../database/db-client.decorator';
import { ReportesService } from './reportes.service';
import {
  generarExcelAsistencia,
  generarExcelResumenTrabajadores,
  generarExcelResumenCentros,
  generarExcelLibroAsistencia,
} from './reportes.excel';
import { ParamsReporteDto } from './dto/params-reporte.dto';
import { FiltrosReporteDto } from './dto/filtros-reporte.dto';

@Controller('reportes')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantInterceptor)
@UseFilters(PostgresExceptionFilter)
export class ReportesController {
  constructor(private readonly service: ReportesService) {}

  @Get('asistencia/:año/:mes')
  @Roles('admin_empresa', 'supervisor')
  async asistencia(
    @Param() params: ParamsReporteDto,
    @Query() filtros: FiltrosReporteDto,
    @DbClient() db: PoolClient,
    @Res() res: Response,
  ) {
    const datos = await this.service.asistencia(params, filtros, db);
    if (filtros.formato === 'xlsx') {
      const buf = await generarExcelAsistencia(datos);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="asistencia-${params.año}-${params.mes}.xlsx"`);
      return res.send(buf);
    }
    return res.status(HttpStatus.OK).json(datos);
  }

  @Get('resumen-trabajadores/:año/:mes')
  @Roles('admin_empresa')
  async resumenTrabajadores(
    @Param() params: ParamsReporteDto,
    @Query() filtros: FiltrosReporteDto,
    @DbClient() db: PoolClient,
    @Res() res: Response,
  ) {
    const datos = await this.service.resumenTrabajadores(params, filtros, db);
    if (filtros.formato === 'xlsx') {
      const buf = await generarExcelResumenTrabajadores(datos);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="resumen-trabajadores-${params.año}-${params.mes}.xlsx"`);
      return res.send(buf);
    }
    return res.status(HttpStatus.OK).json(datos);
  }

  @Get('resumen-centros/:año/:mes')
  @Roles('admin_empresa', 'supervisor')
  async resumenCentros(
    @Param() params: ParamsReporteDto,
    @Query() filtros: FiltrosReporteDto,
    @DbClient() db: PoolClient,
    @Res() res: Response,
  ) {
    const datos = await this.service.resumenCentros(params, filtros, db);
    if (filtros.formato === 'xlsx') {
      const buf = await generarExcelResumenCentros(datos);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="resumen-centros-${params.año}-${params.mes}.xlsx"`);
      return res.send(buf);
    }
    return res.status(HttpStatus.OK).json(datos);
  }

  @Get('libro-asistencia/:año/:mes')
  @Roles('admin_empresa', 'supervisor')
  async libroAsistencia(
    @Param() params: ParamsReporteDto,
    @Query() filtros: FiltrosReporteDto,
    @DbClient() db: PoolClient,
    @Res() res: Response,
  ) {
    const datos = await this.service.libroAsistencia(params, filtros, db);
    if (filtros.formato === 'xlsx') {
      const buf = await generarExcelLibroAsistencia(datos);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="libro-asistencia-${params.año}-${params.mes}.xlsx"`);
      return res.send(buf);
    }
    return res.status(HttpStatus.OK).json(datos);
  }
}
