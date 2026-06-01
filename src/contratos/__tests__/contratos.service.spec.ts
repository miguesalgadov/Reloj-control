import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ContratosService } from '../contratos.service';
import type { ContratosRepository, ContratoRow, JornadaPactadaRow } from '../contratos.repository';
import type { JwtPayload } from '../../types/express';

function mockRepo(): jest.Mocked<ContratosRepository> {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    countVigentes: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    terminar: jest.fn(),
    getJornadas: jest.fn(),
    setJornadas: jest.fn(),
  } as unknown as jest.Mocked<ContratosRepository>;
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

const TRAB_ID = '11111111-1111-1111-1111-111111111111';
const CONTRATO_ID = '22222222-2222-2222-2222-222222222222';

function contratoRow(overrides: Partial<ContratoRow> = {}): ContratoRow & { jornadas_pactadas: JornadaPactadaRow[] } {
  return {
    id: CONTRATO_ID,
    trabajador_id: TRAB_ID,
    tipo_contrato: 'indefinido',
    cargo: 'Operario',
    fecha_inicio: '2026-01-01',
    fecha_termino: null,
    horas_semanales: 44,
    sueldo_base: null,
    tipo_jornada: 'ordinaria',
    permite_horas_extras: false,
    estado: 'vigente',
    created_at: new Date(),
    updated_at: new Date(),
    jornadas_pactadas: [],
    ...overrides,
  };
}

describe('ContratosService', () => {
  let service: ContratosService;
  let repo: jest.Mocked<ContratosRepository>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    repo = mockRepo();
    db = mockDb();
    service = new ContratosService(repo);
  });

  // ─── crear() ──────────────────────────────────────────────────────────────

  describe('crear()', () => {
    const BASE_DTO = {
      trabajador_id: TRAB_ID,
      tipo_contrato: 'indefinido' as const,
      cargo: 'Operario',
      fecha_inicio: '2026-01-01',
      horas_semanales: 44,
    };

    it('happy path: sin contrato vigente previo, crea y retorna el contrato', async () => {
      repo.countVigentes.mockResolvedValue(0);
      repo.create.mockResolvedValue(contratoRow());

      const result = await service.crear(BASE_DTO as any, USER, db);

      expect(repo.countVigentes).toHaveBeenCalledWith(TRAB_ID, db);
      expect(repo.create).toHaveBeenCalledWith('tenant-1', BASE_DTO, db);
      expect(result.estado).toBe('vigente');
    });

    it('trabajador ya tiene contrato vigente → ConflictException', async () => {
      repo.countVigentes.mockResolvedValue(1);

      await expect(service.crear(BASE_DTO as any, USER, db)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('fecha_termino <= fecha_inicio → BadRequestException', async () => {
      await expect(
        service.crear({ ...BASE_DTO, fecha_termino: '2026-01-01' } as any, USER, db),
      ).rejects.toThrow(BadRequestException);
      expect(repo.countVigentes).not.toHaveBeenCalled();
    });

    it('fecha_termino anterior a fecha_inicio → BadRequestException', async () => {
      await expect(
        service.crear({ ...BASE_DTO, fecha_termino: '2025-12-31' } as any, USER, db),
      ).rejects.toThrow(BadRequestException);
    });

    it('tipo plazo_fijo sin fecha_termino → BadRequestException', async () => {
      await expect(
        service.crear({ ...BASE_DTO, tipo_contrato: 'plazo_fijo' } as any, USER, db),
      ).rejects.toThrow(BadRequestException);
      expect(repo.countVigentes).not.toHaveBeenCalled();
    });

    it('tipo obra_faena sin fecha_termino → BadRequestException', async () => {
      await expect(
        service.crear({ ...BASE_DTO, tipo_contrato: 'obra_faena' } as any, USER, db),
      ).rejects.toThrow(BadRequestException);
    });

    it('tipo indefinido sin fecha_termino → OK (no requiere fecha_termino)', async () => {
      repo.countVigentes.mockResolvedValue(0);
      repo.create.mockResolvedValue(contratoRow());

      await expect(service.crear(BASE_DTO as any, USER, db)).resolves.toBeDefined();
    });
  });

  // ─── terminar() ───────────────────────────────────────────────────────────

  describe('terminar()', () => {
    const DTO = { motivo: 'Fin de proyecto conforme acuerdo firmado', fecha_termino: '2026-06-01' };

    it('happy path: cambia estado a terminado con fecha indicada', async () => {
      repo.findById.mockResolvedValue(contratoRow({ estado: 'vigente' }));
      repo.terminar.mockResolvedValue(contratoRow({ estado: 'terminado', fecha_termino: '2026-06-01' }));

      const result = await service.terminar(CONTRATO_ID, DTO as any, USER, db);

      expect(repo.terminar).toHaveBeenCalledWith(CONTRATO_ID, '2026-06-01', db);
      expect(result.estado).toBe('terminado');
      expect(result.fecha_termino).toBe('2026-06-01');
    });

    it('contrato no encontrado → NotFoundException', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.terminar(CONTRATO_ID, DTO as any, USER, db)).rejects.toThrow(NotFoundException);
      expect(repo.terminar).not.toHaveBeenCalled();
    });

    it('contrato ya terminado → BadRequestException', async () => {
      repo.findById.mockResolvedValue(contratoRow({ estado: 'terminado' }));

      await expect(service.terminar(CONTRATO_ID, DTO as any, USER, db)).rejects.toThrow(BadRequestException);
      expect(repo.terminar).not.toHaveBeenCalled();
    });

    it('contrato anulado → BadRequestException', async () => {
      repo.findById.mockResolvedValue(contratoRow({ estado: 'anulado' }));

      await expect(service.terminar(CONTRATO_ID, DTO as any, USER, db)).rejects.toThrow(BadRequestException);
    });

    it('no cambia el estado del trabajador — eso es responsabilidad de desvincular()', async () => {
      repo.findById.mockResolvedValue(contratoRow());
      repo.terminar.mockResolvedValue(contratoRow({ estado: 'terminado' }));

      await service.terminar(CONTRATO_ID, DTO as any, USER, db);

      // El servicio de contratos no toca la tabla de trabajadores
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('registrar_evento'), expect.anything());
      const allQueries: string[] = db.query.mock.calls.map((c: any[]) => c[0] as string);
      expect(allQueries.every((q) => !q.toLowerCase().includes('rc.trabajadores'))).toBe(true);
    });

    it('sin fecha_termino en DTO: usa la fecha de hoy', async () => {
      repo.findById.mockResolvedValue(contratoRow());
      repo.terminar.mockResolvedValue(contratoRow({ estado: 'terminado' }));

      const hoy = new Date().toISOString().slice(0, 10);
      await service.terminar(CONTRATO_ID, { motivo: DTO.motivo } as any, USER, db);

      expect(repo.terminar).toHaveBeenCalledWith(CONTRATO_ID, hoy, db);
    });
  });

  // ─── setJornadas() ────────────────────────────────────────────────────────

  describe('setJornadas()', () => {
    const JORNADAS = [
      { dia_semana: 1, hora_inicio: '08:00', hora_termino: '18:00', tolerancia_minutos: 5 },
      { dia_semana: 2, hora_inicio: '08:00', hora_termino: '18:00', tolerancia_minutos: 5 },
    ];

    it('happy path: delega a repo.setJornadas con el array completo y retorna el resultado', async () => {
      repo.findById.mockResolvedValue(contratoRow());
      const jornadasCreadas: JornadaPactadaRow[] = JORNADAS.map((j, i) => ({
        id: `jornada-${i}`,
        dia_semana: j.dia_semana,
        hora_inicio: j.hora_inicio + ':00',
        hora_termino: j.hora_termino + ':00',
        colacion_inicio: null,
        colacion_termino: null,
        tolerancia_minutos: j.tolerancia_minutos,
      }));
      repo.setJornadas.mockResolvedValue(jornadasCreadas);

      const result = await service.setJornadas(CONTRATO_ID, { jornadas: JORNADAS } as any, USER, db);

      expect(repo.setJornadas).toHaveBeenCalledWith(CONTRATO_ID, 'tenant-1', JORNADAS, db);
      expect(result).toHaveLength(2);
    });

    it('contrato no encontrado → NotFoundException, repo.setJornadas no se llama', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.setJornadas(CONTRATO_ID, { jornadas: JORNADAS } as any, USER, db),
      ).rejects.toThrow(NotFoundException);
      expect(repo.setJornadas).not.toHaveBeenCalled();
    });

    it('array vacío: delega a repo.setJornadas con [] (contrato queda sin jornadas)', async () => {
      repo.findById.mockResolvedValue(contratoRow());
      repo.setJornadas.mockResolvedValue([]);

      const result = await service.setJornadas(CONTRATO_ID, { jornadas: [] } as any, USER, db);

      expect(repo.setJornadas).toHaveBeenCalledWith(CONTRATO_ID, 'tenant-1', [], db);
      expect(result).toHaveLength(0);
    });

    it('si repo.setJornadas lanza, el error se propaga — la transacción rollbackea por interceptor', async () => {
      repo.findById.mockResolvedValue(contratoRow());
      repo.setJornadas.mockRejectedValue(new Error('constraint violation'));

      await expect(
        service.setJornadas(CONTRATO_ID, { jornadas: JORNADAS } as any, USER, db),
      ).rejects.toThrow('constraint violation');
    });
  });
});
