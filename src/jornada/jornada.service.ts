import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { JornadaRepository } from './jornada.repository';
import { evaluarJornadaDia } from './evaluator/evaluador';
import { evaluarSemana, DatosDia } from './evaluator/evaluador-semana';
import { obtenerMarcacionesEfectivas } from './evaluator/marcaciones-efectivas';
import { ResultadoJornadaDia, ResultadoSemana } from './types';
import { fechaLocalChile, diaSemanaIso, toLocalChile, diasDeSemana, inicioSemanaIso } from './evaluator/utils';
import type { JwtPayload } from '../types/express';

@Injectable()
export class JornadaService {
  constructor(private readonly repo: JornadaRepository) {}

  async getHoy(user: JwtPayload, db: PoolClient): Promise<ResultadoJornadaDia> {
    const ahora = new Date();
    const fechaStr = fechaLocalChile(ahora);
    return this.getDia(user, fechaStr, ahora, db);
  }

  async getFecha(user: JwtPayload, fechaStr: string, db: PoolClient): Promise<ResultadoJornadaDia> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
      throw new NotFoundException(`Formato de fecha inválido: ${fechaStr}`);
    }
    const ahora = new Date();
    return this.getDia(user, fechaStr, ahora, db);
  }

  async getSemana(user: JwtPayload, lunesStr: string, db: PoolClient): Promise<ResultadoSemana> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lunesStr)) {
      throw new NotFoundException(`Formato de fecha inválido: ${lunesStr}`);
    }
    return this.evaluarSemanaParaTrabajador(user.tenantId, user.trabajadorId!, lunesStr, db);
  }

  async evaluarSemanaParaTrabajador(
    tenantId: string,
    trabajadorId: string,
    lunesStr: string,
    db: PoolClient,
  ): Promise<ResultadoSemana> {
    const ahora = new Date();
    const config = await this.repo.getConfig(tenantId, db);
    const fechas = diasDeSemana(lunesStr);
    const domingoStr = fechas[6];

    const marcacionesPorDia = await this.repo.getMarcacionesSemana(
      tenantId, trabajadorId, lunesStr, domingoStr, db,
    );

    const diasData: DatosDia[] = await Promise.all(
      fechas.map(async (fechaStr) => {
        const fecha = new Date(`${fechaStr}T12:00:00Z`);
        const local = toLocalChile(fecha);
        const diaSemana = diaSemanaIso(local);
        const jornada = await this.repo.getJornadaPactada(tenantId, trabajadorId, diaSemana, db);
        const marcacionesRaw = marcacionesPorDia.get(fechaStr) ?? [];
        const marcaciones = obtenerMarcacionesEfectivas(marcacionesRaw);
        return { fechaStr, jornada, marcaciones };
      }),
    );

    return evaluarSemana(diasData, config, ahora, lunesStr);
  }

  private async getDia(
    user: JwtPayload,
    fechaStr: string,
    ahora: Date,
    db: PoolClient,
  ): Promise<ResultadoJornadaDia> {
    if (!user.trabajadorId) {
      throw new NotFoundException('El usuario no está vinculado a un trabajador.');
    }

    const tenantId = user.tenantId;
    const trabajadorId = user.trabajadorId;

    const config = await this.repo.getConfig(tenantId, db);

    const fecha = new Date(`${fechaStr}T12:00:00Z`);
    const local = toLocalChile(fecha);
    const diaSemana = diaSemanaIso(local);

    const jornada = await this.repo.getJornadaPactada(tenantId, trabajadorId, diaSemana, db);
    const marcacionesRaw = await this.repo.getMarcacionesDia(tenantId, trabajadorId, fechaStr, db);
    const marcaciones = obtenerMarcacionesEfectivas(marcacionesRaw);

    return evaluarJornadaDia(marcaciones, jornada, config, fechaStr, ahora);
  }

  async getSemanaDeHoy(user: JwtPayload, db: PoolClient): Promise<ResultadoSemana> {
    const ahora = new Date();
    const lunesUtc = inicioSemanaIso(ahora);
    const lunesStr = fechaLocalChile(lunesUtc);
    return this.getSemana(user, lunesStr, db);
  }
}
