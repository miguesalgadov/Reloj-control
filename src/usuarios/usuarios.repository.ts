import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import type { ListarUsuariosDto } from './dto/listar-usuarios.dto';

export interface UsuarioRow {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: string;
  estado: string;
  mfa_enabled: boolean;
  ultimo_login: Date | null;
  created_at: Date;
}

export interface UsuarioMeRow extends UsuarioRow {
  trabajador_id: string | null;
}

export interface UsuarioConHashRow extends UsuarioRow {
  password_hash: string;
}

@Injectable()
export class UsuariosRepository {
  async findAll(
    dto: ListarUsuariosDto,
    db: PoolClient,
  ): Promise<{ data: UsuarioRow[]; total: number }> {
    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;

    const [countResult, rows] = await Promise.all([
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM rc.usuarios
         WHERE ($1::text IS NULL OR estado::text = $1)
           AND ($2::text IS NULL OR rol::text = $2)`,
        [dto.estado ?? null, dto.rol ?? null],
      ),
      db.query<UsuarioRow>(
        `SELECT id, email, nombres, apellidos, rol, estado,
                mfa_enabled, ultimo_login, created_at
         FROM rc.usuarios
         WHERE ($1::text IS NULL OR estado::text = $1)
           AND ($2::text IS NULL OR rol::text = $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [dto.estado ?? null, dto.rol ?? null, limit, offset],
      ),
    ]);

    return { data: rows.rows, total: parseInt(countResult.rows[0].total, 10) };
  }

  async findById(id: string, db: PoolClient): Promise<UsuarioRow | null> {
    const { rows } = await db.query<UsuarioRow>(
      `SELECT id, email, nombres, apellidos, rol, estado,
              mfa_enabled, ultimo_login, created_at
       FROM rc.usuarios
       WHERE id = $1::uuid`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findMe(userId: string, db: PoolClient): Promise<UsuarioMeRow | null> {
    const { rows } = await db.query<UsuarioMeRow>(
      `SELECT u.id, u.email, u.nombres, u.apellidos, u.rol::text, u.estado::text,
              u.mfa_enabled, u.ultimo_login, u.created_at,
              t.id AS trabajador_id
       FROM rc.usuarios u
       LEFT JOIN rc.trabajadores t ON t.usuario_id = u.id
       WHERE u.id = $1::uuid`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async create(
    tenantId: string,
    email: string,
    passwordHash: string,
    nombres: string,
    apellidos: string,
    rol: string,
    db: PoolClient,
  ): Promise<UsuarioRow> {
    const { rows } = await db.query<UsuarioRow>(
      `INSERT INTO rc.usuarios (tenant_id, email, password_hash, nombres, apellidos, rol)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       RETURNING id, email, nombres, apellidos, rol, estado,
                 mfa_enabled, ultimo_login, created_at`,
      [tenantId, email, passwordHash, nombres, apellidos, rol],
    );
    return rows[0];
  }

  async update(
    id: string,
    fields: { email?: string; nombres?: string; apellidos?: string; rol?: string },
    db: PoolClient,
  ): Promise<UsuarioRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.email !== undefined) {
      params.push(fields.email);
      sets.push(`email = $${params.length}`);
    }
    if (fields.nombres !== undefined) {
      params.push(fields.nombres);
      sets.push(`nombres = $${params.length}`);
    }
    if (fields.apellidos !== undefined) {
      params.push(fields.apellidos);
      sets.push(`apellidos = $${params.length}`);
    }
    if (fields.rol !== undefined) {
      params.push(fields.rol);
      sets.push(`rol = $${params.length}`);
    }

    if (sets.length === 0) return this.findById(id, db);

    params.push(id);
    const { rows } = await db.query<UsuarioRow>(
      `UPDATE rc.usuarios SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}::uuid
       RETURNING id, email, nombres, apellidos, rol, estado,
                 mfa_enabled, ultimo_login, created_at`,
      params,
    );
    return rows[0] ?? null;
  }

  async changeEstado(
    id: string,
    estado: string,
    db: PoolClient,
  ): Promise<UsuarioRow | null> {
    const { rows } = await db.query<UsuarioRow>(
      `UPDATE rc.usuarios SET estado = $1, updated_at = now()
       WHERE id = $2::uuid
       RETURNING id, email, nombres, apellidos, rol, estado,
                 mfa_enabled, ultimo_login, created_at`,
      [estado, id],
    );
    return rows[0] ?? null;
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
    db: PoolClient,
  ): Promise<void> {
    await db.query(
      `UPDATE rc.usuarios SET password_hash = $1, updated_at = now()
       WHERE id = $2::uuid`,
      [passwordHash, id],
    );
  }

  async findByIdWithHash(
    id: string,
    db: PoolClient,
  ): Promise<UsuarioConHashRow | null> {
    const { rows } = await db.query<UsuarioConHashRow>(
      `SELECT id, email, nombres, apellidos, rol, estado,
              mfa_enabled, ultimo_login, created_at, password_hash
       FROM rc.usuarios
       WHERE id = $1::uuid`,
      [id],
    );
    return rows[0] ?? null;
  }
}
