import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import type { ActualizarTrabajadorDto } from './dto/actualizar-trabajador.dto';

export interface TrabajadorRow {
  id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
  fecha_nacimiento: string | null;
  nacionalidad: string | null;
  email: string | null;
  telefono: string | null;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  fecha_ingreso: string;
  fecha_termino: string | null;
  estado: string;
  usuario_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TrabajadorDetalleRow extends TrabajadorRow {
  contrato_vigente: ContratoResumido | null;
}

interface ContratoResumido {
  id: string;
  tipo_contrato: string;
  cargo: string;
  fecha_inicio: string;
  fecha_termino: string | null;
  horas_semanales: number;
  tipo_jornada: string;
}

const TRAB_COLS = `
  t.id, t.rut, t.nombres, t.apellido_paterno, t.apellido_materno,
  t.fecha_nacimiento, t.nacionalidad, t.email, t.telefono,
  t.centro_trabajo_id, ct.nombre AS centro_trabajo_nombre,
  t.fecha_ingreso, t.fecha_termino, t.estado, t.usuario_id,
  t.created_at, t.updated_at
`;

@Injectable()
export class TrabajadoresRepository {
  async findAll(
    estado: string | undefined,
    centroId: string | undefined,
    limit: number,
    offset: number,
    db: PoolClient,
  ): Promise<{ data: TrabajadorRow[]; total: number }> {
    const [countResult, rows] = await Promise.all([
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM rc.trabajadores t
         WHERE ($1::text IS NULL OR t.estado = $1)
           AND ($2::uuid IS NULL OR t.centro_trabajo_id = $2::uuid)`,
        [estado ?? null, centroId ?? null],
      ),
      db.query<TrabajadorRow>(
        `SELECT ${TRAB_COLS}
         FROM rc.trabajadores t
         LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id
         WHERE ($1::text IS NULL OR t.estado = $1)
           AND ($2::uuid IS NULL OR t.centro_trabajo_id = $2::uuid)
         ORDER BY t.apellido_paterno ASC, t.nombres ASC
         LIMIT $3 OFFSET $4`,
        [estado ?? null, centroId ?? null, limit, offset],
      ),
    ]);
    return { data: rows.rows, total: parseInt(countResult.rows[0].total, 10) };
  }

  async findById(id: string, db: PoolClient): Promise<TrabajadorDetalleRow | null> {
    const { rows } = await db.query<TrabajadorDetalleRow & {
      c_id: string | null; c_tipo: string | null; c_cargo: string | null;
      c_inicio: string | null; c_termino: string | null;
      c_horas: number | null; c_jornada: string | null;
    }>(
      `SELECT ${TRAB_COLS},
              c.id AS c_id, c.tipo_contrato AS c_tipo, c.cargo AS c_cargo,
              c.fecha_inicio AS c_inicio, c.fecha_termino AS c_termino,
              c.horas_semanales AS c_horas, c.tipo_jornada AS c_jornada
       FROM rc.trabajadores t
       LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id
       LEFT JOIN rc.contratos c ON c.trabajador_id = t.id AND c.estado = 'vigente'
       WHERE t.id = $1::uuid`,
      [id],
    );

    if (!rows[0]) return null;

    const row = rows[0];
    const contrato_vigente: ContratoResumido | null = row.c_id
      ? {
          id: row.c_id,
          tipo_contrato: row.c_tipo!,
          cargo: row.c_cargo!,
          fecha_inicio: row.c_inicio!,
          fecha_termino: row.c_termino ?? null,
          horas_semanales: row.c_horas!,
          tipo_jornada: row.c_jornada!,
        }
      : null;

    const { c_id, c_tipo, c_cargo, c_inicio, c_termino, c_horas, c_jornada, ...base } = row;
    return { ...base, contrato_vigente };
  }

  async create(
    tenantId: string,
    dto: {
      rut: string;
      nombres: string;
      apellido_paterno: string;
      apellido_materno?: string;
      fecha_nacimiento?: string;
      nacionalidad?: string;
      email?: string;
      telefono?: string;
      centro_trabajo_id?: string;
      fecha_ingreso: string;
      usuario_id?: string;
    },
    db: PoolClient,
  ): Promise<TrabajadorRow> {
    const { rows } = await db.query<TrabajadorRow>(
      `INSERT INTO rc.trabajadores
         (tenant_id, rut, nombres, apellido_paterno, apellido_materno,
          fecha_nacimiento, nacionalidad, email, telefono,
          centro_trabajo_id, fecha_ingreso, usuario_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, $8, $9, $10::uuid, $11::date, $12::uuid)
       RETURNING
         id, rut, nombres, apellido_paterno, apellido_materno,
         fecha_nacimiento, nacionalidad, email, telefono,
         centro_trabajo_id, NULL AS centro_trabajo_nombre,
         fecha_ingreso, fecha_termino, estado, usuario_id, created_at, updated_at`,
      [
        tenantId,
        dto.rut,
        dto.nombres,
        dto.apellido_paterno,
        dto.apellido_materno ?? null,
        dto.fecha_nacimiento ?? null,
        dto.nacionalidad ?? 'Chilena',
        dto.email ?? null,
        dto.telefono ?? null,
        dto.centro_trabajo_id ?? null,
        dto.fecha_ingreso,
        dto.usuario_id ?? null,
      ],
    );
    return rows[0];
  }

  async update(id: string, dto: ActualizarTrabajadorDto, db: PoolClient): Promise<TrabajadorRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    const fields: Array<[keyof ActualizarTrabajadorDto, string]> = [
      ['nombres', 'nombres = $N'],
      ['apellido_paterno', 'apellido_paterno = $N'],
      ['apellido_materno', 'apellido_materno = $N'],
      ['fecha_nacimiento', 'fecha_nacimiento = $N::date'],
      ['nacionalidad', 'nacionalidad = $N'],
      ['email', 'email = $N'],
      ['telefono', 'telefono = $N'],
      ['centro_trabajo_id', 'centro_trabajo_id = $N::uuid'],
    ];

    for (const [key, tpl] of fields) {
      if (dto[key] !== undefined) {
        params.push(dto[key]);
        sets.push(tpl.replace('$N', `$${params.length}`));
      }
    }

    if (sets.length === 0) {
      return this.findById(id, db);
    }

    params.push(id);
    const { rows } = await db.query<TrabajadorRow>(
      `UPDATE rc.trabajadores SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}::uuid
       RETURNING
         id, rut, nombres, apellido_paterno, apellido_materno,
         fecha_nacimiento, nacionalidad, email, telefono,
         centro_trabajo_id, NULL AS centro_trabajo_nombre,
         fecha_ingreso, fecha_termino, estado, usuario_id, created_at, updated_at`,
      params,
    );
    return rows[0] ?? null;
  }

  async createUsuario(
    tenantId: string,
    email: string,
    passwordHash: string,
    nombres: string,
    apellidos: string,
    db: PoolClient,
  ): Promise<{ id: string }> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO rc.usuarios (tenant_id, email, password_hash, nombres, apellidos, rol)
       VALUES ($1::uuid, $2, $3, $4, $5, 'trabajador')
       RETURNING id`,
      [tenantId, email, passwordHash, nombres, apellidos],
    );
    return rows[0];
  }

  async linkUsuario(trabajadorId: string, usuarioId: string, db: PoolClient): Promise<void> {
    await db.query(
      `UPDATE rc.trabajadores SET usuario_id = $1::uuid, updated_at = now()
       WHERE id = $2::uuid`,
      [usuarioId, trabajadorId],
    );
    await db.query(
      `UPDATE rc.usuarios SET updated_at = now() WHERE id = $1::uuid`,
      [usuarioId],
    );
  }

  async desvincular(
    id: string,
    fechaTermino: string,
    db: PoolClient,
  ): Promise<TrabajadorRow | null> {
    const { rows } = await db.query<TrabajadorRow>(
      `UPDATE rc.trabajadores
       SET estado = 'desvinculado', fecha_termino = $2::date, updated_at = now()
       WHERE id = $1::uuid
       RETURNING
         id, rut, nombres, apellido_paterno, apellido_materno,
         fecha_nacimiento, nacionalidad, email, telefono,
         centro_trabajo_id, NULL AS centro_trabajo_nombre,
         fecha_ingreso, fecha_termino, estado, usuario_id, created_at, updated_at`,
      [id, fechaTermino],
    );
    return rows[0] ?? null;
  }

  async terminarContratoVigente(trabajadorId: string, fechaTermino: string, db: PoolClient): Promise<void> {
    await db.query(
      `UPDATE rc.contratos SET estado = 'terminado', fecha_termino = $2::date, updated_at = now()
       WHERE trabajador_id = $1::uuid AND estado = 'vigente'`,
      [trabajadorId, fechaTermino],
    );
  }

  async suspenderUsuario(usuarioId: string, db: PoolClient): Promise<void> {
    await db.query(
      `UPDATE rc.usuarios SET estado = 'suspendido', updated_at = now()
       WHERE id = $1::uuid`,
      [usuarioId],
    );
  }
}
