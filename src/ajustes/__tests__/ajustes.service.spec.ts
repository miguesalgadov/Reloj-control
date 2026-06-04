import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AjustesService } from '../ajustes.service';
import type { AjustesRepository, MarcacionOriginalRow } from '../ajustes.repository';
import type { JwtPayload } from '../../types/express';

function mockRepo(): jest.Mocked<AjustesRepository> {
  return {
    findMarcacionOriginal: jest.fn(),
    existeTrabajador: jest.fn(),
    crearAjuste: jest.fn(),
    registrarAuditoria: jest.fn(),
    findAdminNombre: jest.fn(),
    listar: jest.fn(),
    findById: jest.fn(),
  } as unknown as jest.Mocked<AjustesRepository>;
}

function mockDb() { return {} as any; }

const USER: JwtPayload = {
  sub: 'a2222222-2222-2222-2222-222222222222',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  rol: 'admin_empresa',
  trabajadorId: null,
};

const TRAB_ID = 'a4444444-4444-4444-4444-444444444444';
const MARC_ID = 'b5555555-5555-5555-5555-555555555555';

function marcacionRow(overrides: Partial<MarcacionOriginalRow> = {}): MarcacionOriginalRow {
  return {
    id: MARC_ID,
    trabajador_id: TRAB_ID,
    tipo: 'entrada',
    timestamp_utc: new Date('2026-06-01T12:00:00Z'),
    dentro_geocerca: true,
    datos_ajuste: null,
    anulada: false,
    ...overrides,
  };
}

describe('AjustesService.crear()', () => {
  let service: AjustesService;
  let repo: jest.Mocked<AjustesRepository>;

  beforeEach(() => {
    repo = mockRepo();
    service = new AjustesService(repo);
    repo.existeTrabajador.mockResolvedValue(true);
    repo.crearAjuste.mockResolvedValue({ id: 'ajuste-1', created_at: new Date() });
    repo.registrarAuditoria.mockResolvedValue(undefined);
    repo.findAdminNombre.mockResolvedValue('Maria Gonzalez Soto');
  });

  it('creacion happy path → llama crearAjuste con tipo real (entrada)', async () => {
    const dto = {
      tipo_ajuste: 'creacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Trabajador olvidó marcar entrada debido a que el sistema estuvo offline.',
      tipo_marcacion: 'entrada',
      timestamp_local: '2026-06-01T08:07:00',
    };
    const result = await service.crear(dto as any, USER, mockDb());
    expect(repo.crearAjuste).toHaveBeenCalledWith(
      expect.objectContaining({ tipoMarcacion: 'entrada' }),
      expect.anything(),
    );
    expect(result.tipo_ajuste).toBe('creacion');
  });

  it('correccion happy path → busca marcación original y crea con tipo ajuste', async () => {
    repo.findMarcacionOriginal.mockResolvedValue(marcacionRow());
    const dto = {
      tipo_ajuste: 'correccion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'El trabajador marcó 30 minutos tarde por error del sistema de turnos.',
      marcacion_original_id: MARC_ID,
      timestamp_local_corregido: '2026-06-01T08:07:00',
    };
    const result = await service.crear(dto as any, USER, mockDb());
    expect(repo.findMarcacionOriginal).toHaveBeenCalledWith(MARC_ID, expect.anything());
    expect(repo.crearAjuste).toHaveBeenCalledWith(
      expect.objectContaining({ tipoMarcacion: 'ajuste' }),
      expect.anything(),
    );
    expect(result.tipo_ajuste).toBe('correccion');
  });

  it('anulacion happy path → crea ajuste con tipo ajuste', async () => {
    repo.findMarcacionOriginal.mockResolvedValue(marcacionRow());
    const dto = {
      tipo_ajuste: 'anulacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Marcación duplicada generada por doble click accidental del trabajador.',
      marcacion_original_id: MARC_ID,
    };
    const result = await service.crear(dto as any, USER, mockDb());
    expect(repo.crearAjuste).toHaveBeenCalledWith(
      expect.objectContaining({ tipoMarcacion: 'ajuste' }),
      expect.anything(),
    );
    expect(result.tipo_ajuste).toBe('anulacion');
  });

  it('creacion con marcacion_original_id → UnprocessableEntityException', async () => {
    const dto = {
      tipo_ajuste: 'creacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'x'.repeat(30),
      tipo_marcacion: 'entrada',
      timestamp_local: '2026-06-01T08:07:00',
      marcacion_original_id: MARC_ID,
    };
    await expect(service.crear(dto as any, USER, mockDb())).rejects.toThrow(UnprocessableEntityException);
    expect(repo.crearAjuste).not.toHaveBeenCalled();
  });

  it('timestamp > 60 días atrás → BadRequestException', async () => {
    const fechaAntigua = new Date();
    fechaAntigua.setDate(fechaAntigua.getDate() - 61);
    const tsLocal = fechaAntigua.toISOString().slice(0, 16);

    const dto = {
      tipo_ajuste: 'creacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Motivo de prueba suficientemente largo para cumplir el mínimo.',
      tipo_marcacion: 'entrada',
      timestamp_local: tsLocal,
    };
    await expect(service.crear(dto as any, USER, mockDb())).rejects.toThrow(BadRequestException);
  });

  it('mes anterior sin confirmacion_mes_cerrado → BadRequestException', async () => {
    const d = new Date();
    d.setDate(1);
    d.setDate(d.getDate() - 1); // último día del mes anterior
    const tsLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01T08:00:00`;

    const dto = {
      tipo_ajuste: 'creacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Motivo de prueba suficientemente largo para cumplir el mínimo requerido.',
      tipo_marcacion: 'entrada',
      timestamp_local: tsLocal,
      confirmacion_mes_cerrado: false,
    };
    await expect(service.crear(dto as any, USER, mockDb())).rejects.toThrow(BadRequestException);
  });

  it('marcación original ya anulada → NotFoundException', async () => {
    repo.findMarcacionOriginal.mockResolvedValue(marcacionRow({ anulada: true }));
    const dto = {
      tipo_ajuste: 'correccion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Intento de corrección sobre marcación ya anulada.',
      marcacion_original_id: MARC_ID,
      timestamp_local_corregido: '2026-06-01T08:07:00',
    };
    await expect(service.crear(dto as any, USER, mockDb())).rejects.toThrow(NotFoundException);
    expect(repo.crearAjuste).not.toHaveBeenCalled();
  });

  it('trabajador no encontrado → NotFoundException', async () => {
    repo.existeTrabajador.mockResolvedValue(false);
    const dto = {
      tipo_ajuste: 'creacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Motivo de prueba suficientemente largo para la validación mínima.',
      tipo_marcacion: 'entrada',
      timestamp_local: '2026-06-01T08:07:00',
    };
    await expect(service.crear(dto as any, USER, mockDb())).rejects.toThrow(NotFoundException);
  });

  it('si registrarAuditoria falla, la excepción se propaga (el interceptor hace rollback)', async () => {
    repo.registrarAuditoria.mockRejectedValue(new Error('DB error simulado'));

    const dto = {
      tipo_ajuste: 'creacion' as const,
      trabajador_id: TRAB_ID,
      motivo: 'Motivo suficientemente largo para pasar la validación mínima de treinta caracteres.',
      tipo_marcacion: 'entrada',
      timestamp_local: '2026-06-01T08:07:00',
    };

    await expect(service.crear(dto as any, USER, mockDb())).rejects.toThrow('DB error simulado');
    // crearAjuste fue llamado primero; registrarAuditoria lanzó; la excepción
    // se propaga al TenantInterceptor que hace ROLLBACK de toda la transacción.
    expect(repo.crearAjuste).toHaveBeenCalled();
  });
});
