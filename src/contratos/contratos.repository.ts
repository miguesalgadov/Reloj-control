import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import type { CrearContratoDto } from './dto/crear-contrato.dto';
import type { ActualizarContratoDto } from './dto/actualizar-contrato.dto';

export interface ContratoRow {
  id: string;
  trabajador_id: string;
  tipo_contrato: string;
  cargo: string;
  fecha_inicio: string;
  fecha_termino: string | null;
  horas_semanales: number;
  sueldo_base: number | null;
  tipo_jornada: string;
  permite_horas_extras: boolean;
  estado: string;
  created_at: Date;
  updated_at: Date;
}

export interface JornadaPactadaRow {
  id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_termino: string;
  colacion_inicio: string | null;
  colacion_termino: string | null;
  tolerancia_minutos: number;
}

const CONTRATO_COLS = `
  id, trabajador_id, tipo_contrato, cargo,
  fecha_inicio, fecha_termino, horas_semanales,
  sueldo_base, tipo_jornada, permite_horas_extras,
  estado, created_at, updated_at
`;

@Injectable()
export class ContratosRepository {
  async findAll(
    trabajadorId: string | undefined,
    estado: string | undefined,
    limit: number,
    offset: number,
    db: PoolClient,
  ): Promise<{ data: ContratoRow[]; total: number }> {
    const [countResult, rows] = await Promise.all([
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM rc.contratos
         WHERE ($1::uuid IS NULL OR trabajador_id = $1::uuid)
           AND ($2::text IS NULL OR estado = $2)`,
        [trabajadorId ?? null, estado ?? null],
      ),
      db.query<ContratoRow>(
        `SELECT ${CONTRATO_COLS}
         FROM rc.contratos
         WHERE ($1::uuid IS NULL OR trabajador_id = $1::uuid)
           AND ($2::text IS NULL OR estado = $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [trabajadorId ?? null, estado ?? null, limit, offset],
      ),
    ]);
    return { data: rows.rows, total: parseInt(countResult.rows[0].total, 10) };
  }

  async findById(id: string, db: PoolClient): Promise<(ContratoRow & { jornadas_pactadas: JornadaPactadaRow[] }) | null> {
    const [contratoResult, jornadasResult] = await Promise.all([
      db.query<ContratoRow>(
        `SELECT ${CONTRATO_COLS} FROM rc.contratos WHERE id = $1::uuid`,
        [id],
      ),
      db.query<JornadaPactadaRow>(
        `SELECT id, dia_semana, hora_inicio::text, hora_termino::text,
                colacion_inicio::text, colacion_termino::text, tolerancia_minutos
         FROM rc.jornadas_pactadas
         WHERE contrato_id = $1::uuid
         ORDER BY dia_semana ASC`,
        [id],
      ),
    ]);

    if (!contratoResult.rows[0]) return null;
    return { ...contratoResult.rows[0], jornadas_pactadas: jornadasResult.rows };
  }

  async countVigentes(trabajadorId: string, db: PoolClient): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rc.contratos
       WHERE trabajador_id = $1::uuid AND estado = 'vigente'`,
      [trabajadorId],
    );
    return parseInt(rows[0].count, 10);
  }

  async create(tenantId: string, dto: CrearContratoDto, db: PoolClient): Promise<ContratoRow> {
    const { rows } = await db.query<ContratoRow>(
      `INSERT INTO rc.contratos
         (tenant_id, trabajador_id, tipo_contrato, cargo, fecha_inicio, fecha_termino,
          horas_semanales, sueldo_base, tipo_jornada, permite_horas_extras)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::date, $6::date,
               $7::numeric, $8::numeric, $9, $10::boolean)
       RETURNING ${CONTRATO_COLS}`,
      [
        tenantId,
        dto.trabajador_id,
        dto.tipo_contrato,
        dto.cargo,
        dto.fecha_inicio,
        dto.fecha_termino ?? null,
        dto.horas_semanales,
        dto.sueldo_base ?? null,
        dto.tipo_jornada ?? 'ordinaria',
        dto.permite_horas_extras ?? false,
      ],
    );
    return rows[0];
  }

  async update(id: string, dto: ActualizarContratoDto, db: PoolClient): Promise<ContratoRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (dto.cargo !== undefined) {
      params.push(dto.cargo);
      sets.push(`cargo = $${params.length}`);
    }
    if (dto.sueldo_base !== undefined) {
      params.push(dto.sueldo_base);
      sets.push(`sueldo_base = $${params.length}::numeric`);
    }
    if (dto.permite_horas_extras !== undefined) {
      params.push(dto.permite_horas_extras);
      sets.push(`permite_horas_extras = $${params.length}::boolean`);
    }
    if (dto.fecha_termino !== undefined) {
      params.push(dto.fecha_termino);
      sets.push(`fecha_termino = $${params.length}::date`);
    }

    if (sets.length === 0) {
      const c = await db.query<ContratoRow>(`SELECT ${CONTRATO_COLS} FROM rc.contratos WHERE id = $1::uuid`, [id]);
      return c.rows[0] ?? null;
    }

    params.push(id);
    const { rows } = await db.query<ContratoRow>(
      `UPDATE rc.contratos SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}::uuid
       RETURNING ${CONTRATO_COLS}`,
      params,
    );
    return rows[0] ?? null;
  }

  async terminar(id: string, fechaTermino: string, db: PoolClient): Promise<ContratoRow | null> {
    const { rows } = await db.query<ContratoRow>(
      `UPDATE rc.contratos
       SET estado = 'terminado', fecha_termino = $2::date, updated_at = now()
       WHERE id = $1::uuid
       RETURNING ${CONTRATO_COLS}`,
      [id, fechaTermino],
    );
    return rows[0] ?? null;
  }

  async getJornadas(contratoId: string, db: PoolClient): Promise<JornadaPactadaRow[]> {
    const { rows } = await db.query<JornadaPactadaRow>(
      `SELECT id, dia_semana, hora_inicio::text, hora_termino::text,
              colacion_inicio::text, colacion_termino::text, tolerancia_minutos
       FROM rc.jornadas_pactadas
       WHERE contrato_id = $1::uuid
       ORDER BY dia_semana ASC`,
      [contratoId],
    );
    return rows;
  }

  async setJornadas(
    contratoId: string,
    tenantId: string,
    jornadas: Array<{
      dia_semana: number;
      hora_inicio: string;
      hora_termino: string;
      colacion_inicio?: string;
      colacion_termino?: string;
      tolerancia_minutos?: number;
    }>,
    db: PoolClient,
  ): Promise<JornadaPactadaRow[]> {
    await db.query(
      `DELETE FROM rc.jornadas_pactadas WHERE contrato_id = $1::uuid`,
      [contratoId],
    );

    if (jornadas.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (const j of jornadas) {
      const base = values.length;
      values.push(
        tenantId,
        contratoId,
        j.dia_semana,
        j.hora_inicio,
        j.hora_termino,
        j.colacion_inicio ?? null,
        j.colacion_termino ?? null,
        j.tolerancia_minutos ?? 5,
      );
      placeholders.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::smallint, $${base + 4}::time, $${base + 5}::time, $${base + 6}::time, $${base + 7}::time, $${base + 8}::smallint)`,
      );
    }

    const { rows } = await db.query<JornadaPactadaRow>(
      `INSERT INTO rc.jornadas_pactadas
         (tenant_id, contrato_id, dia_semana, hora_inicio, hora_termino,
          colacion_inicio, colacion_termino, tolerancia_minutos)
       VALUES ${placeholders.join(', ')}
       RETURNING id, dia_semana, hora_inicio::text, hora_termino::text,
                 colacion_inicio::text, colacion_termino::text, tolerancia_minutos`,
      values,
    );

    return rows.sort((a, b) => a.dia_semana - b.dia_semana);
  }
}
