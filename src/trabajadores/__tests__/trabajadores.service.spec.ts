import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { TrabajadoresService } from '../trabajadores.service';
import type { TrabajadoresRepository, TrabajadorRow, TrabajadorDetalleRow } from '../trabajadores.repository';
import type { JwtPayload } from '../../types/express';

jest.mock('argon2');

function mockRepo(): jest.Mocked<TrabajadoresRepository> {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    createUsuario: jest.fn(),
    linkUsuario: jest.fn(),
    desvincular: jest.fn(),
    terminarContratoVigente: jest.fn(),
    suspenderUsuario: jest.fn(),
  } as unknown as jest.Mocked<TrabajadoresRepository>;
}

function mockDb() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;
}

const USER: JwtPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  rol: 'admin_empresa',
  trabajadorId: null,
};

function trabRow(overrides: Partial<TrabajadorDetalleRow> = {}): TrabajadorDetalleRow {
  return {
    id: 'trab-1',
    rut: '12345678-9',
    nombres: 'Juan',
    apellido_paterno: 'Perez',
    apellido_materno: null,
    fecha_nacimiento: null,
    nacionalidad: 'Chilena',
    email: null,
    telefono: null,
    centro_trabajo_id: null,
    centro_trabajo_nombre: null,
    fecha_ingreso: '2026-01-01',
    fecha_termino: null,
    estado: 'activo',
    usuario_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    contrato_vigente: null,
    ...overrides,
  };
}

function trabSimpleRow(overrides: Partial<TrabajadorRow> = {}): TrabajadorRow {
  const { contrato_vigente: _, ...base } = trabRow(overrides);
  return base;
}

describe('TrabajadoresService', () => {
  let service: TrabajadoresService;
  let repo: jest.Mocked<TrabajadoresRepository>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    repo = mockRepo();
    db = mockDb();
    service = new TrabajadoresService(repo);
    (argon2.hash as jest.Mock).mockResolvedValue('hash-seguro');
  });

  // ─── crear() ──────────────────────────────────────────────────────────────

  describe('crear()', () => {
    it('sin crear_cuenta: no llama createUsuario, pasa usuario_id=undefined a create', async () => {
      repo.create.mockResolvedValue(trabSimpleRow());

      await service.crear(
        { rut: '12345678-9', nombres: 'Juan', apellido_paterno: 'Perez', fecha_ingreso: '2026-01-01' } as any,
        USER,
        db,
      );

      expect(repo.createUsuario).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ usuario_id: undefined }),
        db,
      );
    });

    it('con crear_cuenta=true: hashea password, crea usuario primero, luego trabajador con usuarioId vinculado', async () => {
      repo.createUsuario.mockResolvedValue({ id: 'usuario-1' });
      repo.create.mockResolvedValue(trabSimpleRow({ usuario_id: 'usuario-1' }));

      await service.crear(
        {
          rut: '12345678-9',
          nombres: 'Juan',
          apellido_paterno: 'Perez',
          fecha_ingreso: '2026-01-01',
          crear_cuenta: true,
          cuenta: { email: 'juan@test.cl', password_temporal: 'ClaveSegura2024!' },
        } as any,
        USER,
        db,
      );

      expect(argon2.hash).toHaveBeenCalledWith('ClaveSegura2024!');
      expect(repo.createUsuario).toHaveBeenCalledWith(
        'tenant-1', 'juan@test.cl', 'hash-seguro', 'Juan', 'Perez', db,
      );
      expect(repo.create).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ usuario_id: 'usuario-1' }),
        db,
      );
    });

    it('con crear_cuenta=true sin objeto cuenta → BadRequestException antes de tocar la DB', async () => {
      await expect(
        service.crear(
          { rut: '12345678-9', nombres: 'Juan', apellido_paterno: 'Perez', fecha_ingreso: '2026-01-01', crear_cuenta: true } as any,
          USER,
          db,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repo.createUsuario).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('si createUsuario lanza (email duplicado), create no se llama — la transacción rollbackea por interceptor', async () => {
      repo.createUsuario.mockRejectedValue(new Error('email duplicado'));

      await expect(
        service.crear(
          {
            rut: '12345678-9',
            nombres: 'Juan',
            apellido_paterno: 'Perez',
            fecha_ingreso: '2026-01-01',
            crear_cuenta: true,
            cuenta: { email: 'duplicado@test.cl', password_temporal: 'ClaveSegura2024!' },
          } as any,
          USER,
          db,
        ),
      ).rejects.toThrow('email duplicado');

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ─── desvincular() ────────────────────────────────────────────────────────

  describe('desvincular()', () => {
    const DTO = { motivo: 'Fin de proyecto, se cierra la obra en cuestión', fecha_termino: '2026-06-01' };

    it('cascada completa: termina contrato → suspende usuario → desvincula (en ese orden)', async () => {
      const callOrder: string[] = [];
      repo.findById.mockResolvedValue(trabRow({ usuario_id: 'usuario-1' }));
      repo.terminarContratoVigente.mockImplementation(async () => { callOrder.push('terminar'); });
      repo.suspenderUsuario.mockImplementation(async () => { callOrder.push('suspender'); });
      repo.desvincular.mockImplementation(async () => { callOrder.push('desvincular'); return trabSimpleRow({ estado: 'desvinculado' }); });

      const result = await service.desvincular('trab-1', DTO as any, USER, db);

      expect(callOrder).toEqual(['terminar', 'suspender', 'desvincular']);
      expect(repo.terminarContratoVigente).toHaveBeenCalledWith('trab-1', '2026-06-01', db);
      expect(repo.suspenderUsuario).toHaveBeenCalledWith('usuario-1', db);
      expect(repo.desvincular).toHaveBeenCalledWith('trab-1', '2026-06-01', db);
      expect(result.estado).toBe('desvinculado');
    });

    it('sin usuario_id: no llama suspenderUsuario', async () => {
      repo.findById.mockResolvedValue(trabRow({ usuario_id: null }));
      repo.terminarContratoVigente.mockResolvedValue(undefined);
      repo.desvincular.mockResolvedValue(trabSimpleRow({ estado: 'desvinculado' }));

      await service.desvincular('trab-1', DTO as any, USER, db);

      expect(repo.suspenderUsuario).not.toHaveBeenCalled();
    });

    it('sin fecha_termino en DTO: usa la fecha de hoy', async () => {
      repo.findById.mockResolvedValue(trabRow({ usuario_id: null }));
      repo.terminarContratoVigente.mockResolvedValue(undefined);
      repo.desvincular.mockResolvedValue(trabSimpleRow({ estado: 'desvinculado' }));

      const hoy = new Date().toISOString().slice(0, 10);
      await service.desvincular('trab-1', { motivo: DTO.motivo } as any, USER, db);

      expect(repo.terminarContratoVigente).toHaveBeenCalledWith('trab-1', hoy, db);
      expect(repo.desvincular).toHaveBeenCalledWith('trab-1', hoy, db);
    });

    it('trabajador no encontrado → NotFoundException', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.desvincular('no-existe', DTO as any, USER, db)).rejects.toThrow(NotFoundException);
      expect(repo.terminarContratoVigente).not.toHaveBeenCalled();
    });

    it('trabajador ya desvinculado → BadRequestException, no toca contrato ni usuario', async () => {
      repo.findById.mockResolvedValue(trabRow({ estado: 'desvinculado' }));

      await expect(service.desvincular('trab-1', DTO as any, USER, db)).rejects.toThrow(BadRequestException);
      expect(repo.terminarContratoVigente).not.toHaveBeenCalled();
      expect(repo.suspenderUsuario).not.toHaveBeenCalled();
    });

    it('si terminarContratoVigente lanza, desvincular no se llama — la transacción rollbackea por interceptor', async () => {
      repo.findById.mockResolvedValue(trabRow({ usuario_id: null }));
      repo.terminarContratoVigente.mockRejectedValue(new Error('db error'));

      await expect(service.desvincular('trab-1', DTO as any, USER, db)).rejects.toThrow('db error');
      expect(repo.desvincular).not.toHaveBeenCalled();
    });
  });
});
