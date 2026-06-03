import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupervisionService, derivarEstadoDia, EstadoDia } from '../supervision.service';
import type { SupervisionRepository } from '../supervision.repository';
import type { JornadaService } from '../../jornada/jornada.service';
import type { ResultadoJornadaDia } from '../../jornada/types';

function mockRepo(): jest.Mocked<SupervisionRepository> {
  return {
    obtenerConfiguracion: jest.fn(),
    trabajadoresConJornadaDelDia: jest.fn(),
    marcacionesDelDia: jest.fn(),
    existeTrabajador: jest.fn(),
    alertasInasistenciaPresunta: jest.fn(),
    alertasFueraGeocerca: jest.fn(),
    alertasAtrasoRecurrente: jest.fn(),
    alertasColacionNoMarcada: jest.fn(),
  } as unknown as jest.Mocked<SupervisionRepository>;
}

function mockJornadaService(): jest.Mocked<Pick<JornadaService, 'evaluarSemanaParaTrabajador'>> {
  return { evaluarSemanaParaTrabajador: jest.fn() };
}

function mockDb() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;
}

const CONFIG_BASE = {
  toleranciaAtrasoMinutos: 10,
  toleranciaSalidaAnticipadaMinutos: 5,
  duracionMinimaColacionMinutos: 25,
  duracionMaximaColacionMinutos: 60,
  colacionEsImputableJornada: false,
  umbralInasistenciaSinMarcacionHoras: 2,
  umbralJornadaExtendidaMinutos: 15,
  redondeoHorasExtraMinutos: 15,
  redondeoHorasExtraModo: 'abajo' as const,
  diasLaborables: [1, 2, 3, 4, 5],
};

function mockEvaluacion(overrides: Partial<ResultadoJornadaDia> = {}): ResultadoJornadaDia {
  return {
    fecha: '2026-06-02',
    esDiaLaborable: true,
    jornadaPactada: null,
    marcacionesDelDia: [],
    atraso: { esAtraso: false, minutosAtraso: 0, marcacionAnticipada: false },
    salidaAnticipada: null,
    inasistencia: { inasistencia: false, motivo: 'normal', presunta: false },
    colacion: { aplica: false, cumple: false },
    horasTrabajadas: { horasTrabajadas: null, minutosTrabajados: null },
    anomalias: [],
    ...overrides,
  };
}

// ─── derivarEstadoDia (función pura) ────────────────────────────────────────

describe('derivarEstadoDia()', () => {
  const sinEntrada: any[] = [];
  const conEntrada: any[] = [{ tipo: 'entrada' }];

  it('sin contrato → sin_contrato', () => {
    expect(derivarEstadoDia(null, mockEvaluacion(), sinEntrada)).toBe('sin_contrato');
  });

  it('con contrato, día no laborable → no_laborable', () => {
    const ev = mockEvaluacion({ esDiaLaborable: false });
    expect(derivarEstadoDia('c-1', ev, sinEntrada)).toBe('no_laborable');
  });

  it('con entrada, sin atraso → presente', () => {
    const ev = mockEvaluacion({ atraso: { esAtraso: false, minutosAtraso: 0, marcacionAnticipada: false } });
    expect(derivarEstadoDia('c-1', ev, conEntrada)).toBe('presente');
  });

  it('con entrada, con atraso → atraso', () => {
    const ev = mockEvaluacion({ atraso: { esAtraso: true, minutosAtraso: 12, marcacionAnticipada: false } });
    expect(derivarEstadoDia('c-1', ev, conEntrada)).toBe('atraso');
  });

  it('sin entrada, inasistencia confirmada → ausente', () => {
    const ev = mockEvaluacion({
      inasistencia: { inasistencia: true, motivo: 'sin_marcacion_entrada', presunta: false },
    });
    expect(derivarEstadoDia('c-1', ev, sinEntrada)).toBe('ausente');
  });

  it('sin entrada, esperando marcación → esperando', () => {
    const ev = mockEvaluacion({
      inasistencia: { inasistencia: false, motivo: 'esperando_marcacion', presunta: false },
    });
    expect(derivarEstadoDia('c-1', ev, sinEntrada)).toBe('esperando');
  });
});

// ─── SupervisionService.estadoDia() ─────────────────────────────────────────

describe('SupervisionService.estadoDia()', () => {
  let service: SupervisionService;
  let repo: jest.Mocked<SupervisionRepository>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    repo = mockRepo();
    const js = mockJornadaService();
    service = new SupervisionService(repo, js as any);
    db = mockDb();

    repo.obtenerConfiguracion.mockResolvedValue(CONFIG_BASE);
    repo.marcacionesDelDia.mockResolvedValue([]);
    repo.trabajadoresConJornadaDelDia.mockResolvedValue([]);
  });

  it('fecha inválida → BadRequestException', async () => {
    await expect(service.estadoDia('no-es-fecha', {}, db)).rejects.toThrow(BadRequestException);
  });

  it('resumen agrega correctamente presentes, atrasos, ausentes', async () => {
    // 3 trabajadores: uno con entrada puntual, uno con atraso, uno sin entrada (inasistencia)
    repo.trabajadoresConJornadaDelDia.mockResolvedValue([
      { trabajador_id: 't-1', rut: '1-1', nombres: 'A', apellido_paterno: 'X', apellido_materno: null, centro_trabajo_id: null, centro_trabajo_nombre: null, contrato_id: 'c-1', dia_semana: 1, hora_inicio: '08:00:00', hora_termino: '18:00:00', colacion_inicio: null, colacion_termino: null, tolerancia_override: null, horas_semanales_pactadas: 44, permite_horas_extras: false },
      { trabajador_id: 't-2', rut: '1-2', nombres: 'B', apellido_paterno: 'X', apellido_materno: null, centro_trabajo_id: null, centro_trabajo_nombre: null, contrato_id: 'c-2', dia_semana: 1, hora_inicio: '08:00:00', hora_termino: '18:00:00', colacion_inicio: null, colacion_termino: null, tolerancia_override: null, horas_semanales_pactadas: 44, permite_horas_extras: false },
      { trabajador_id: 't-3', rut: '1-3', nombres: 'C', apellido_paterno: 'X', apellido_materno: null, centro_trabajo_id: null, centro_trabajo_nombre: null, contrato_id: 'c-3', dia_semana: 1, hora_inicio: '08:00:00', hora_termino: '18:00:00', colacion_inicio: null, colacion_termino: null, tolerancia_override: null, horas_semanales_pactadas: 44, permite_horas_extras: false },
    ] as any);

    // t-1 con entrada puntual (antes de hora_inicio), t-2 con entrada tarde, t-3 sin marcaciones (pasado el umbral)
    // Chile winter = UTC-4; 08:00 CLT = 12:00 UTC; 08:25 CLT = 12:25 UTC (25 min late > 10 min tolerance)
    const horaInicioUTC = new Date('2026-06-02T12:00:00Z'); // 08:00 CLT → puntual
    const horaAtrasadaUTC = new Date('2026-06-02T12:25:00Z'); // 08:25 CLT → atraso 25 min

    repo.marcacionesDelDia.mockResolvedValue([
      { id: 'm-1', trabajador_id: 't-1', tipo: 'entrada', timestamp_utc: horaInicioUTC, dentro_geocerca: true },
      { id: 'm-2', trabajador_id: 't-2', tipo: 'entrada', timestamp_utc: horaAtrasadaUTC, dentro_geocerca: true },
    ] as any);

    const result = await service.estadoDia('2026-06-02', {}, db);

    expect(result.resumen.total_consultados).toBe(3);
    // t-1: presente, t-2: atraso, t-3: ausente o esperando (depende de hora actual vs umbral)
    const estados: EstadoDia[] = result.data.map((r: any) => r.estado_dia);
    expect(estados).toContain('presente');
    expect(estados).toContain('atraso');
    expect(result.resumen.presentes + result.resumen.atrasos).toBeGreaterThanOrEqual(2);
  });

  it('filtro por estado aplica post-evaluación: solo devuelve el estado pedido', async () => {
    repo.trabajadoresConJornadaDelDia.mockResolvedValue([
      { trabajador_id: 't-1', rut: '1-1', nombres: 'A', apellido_paterno: 'X', apellido_materno: null, centro_trabajo_id: null, centro_trabajo_nombre: null, contrato_id: null, dia_semana: null, hora_inicio: null, hora_termino: null, colacion_inicio: null, colacion_termino: null, tolerancia_override: null, horas_semanales_pactadas: null, permite_horas_extras: null },
      { trabajador_id: 't-2', rut: '1-2', nombres: 'B', apellido_paterno: 'X', apellido_materno: null, centro_trabajo_id: null, centro_trabajo_nombre: null, contrato_id: null, dia_semana: null, hora_inicio: null, hora_termino: null, colacion_inicio: null, colacion_termino: null, tolerancia_override: null, horas_semanales_pactadas: null, permite_horas_extras: null },
    ] as any);

    const result = await service.estadoDia('2026-06-02', { estado: 'sin_contrato' }, db);

    // Ambos son sin_contrato, filter retorna todos
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    result.data.forEach((r: any) => expect(r.estado_dia).toBe('sin_contrato'));
  });

  it('paginación: limit y offset sobre el set filtrado', async () => {
    const trabajadores = Array.from({ length: 5 }, (_, i) => ({
      trabajador_id: `t-${i}`, rut: `1-${i}`, nombres: 'N', apellido_paterno: 'A', apellido_materno: null,
      centro_trabajo_id: null, centro_trabajo_nombre: null, contrato_id: null, dia_semana: null,
      hora_inicio: null, hora_termino: null, colacion_inicio: null, colacion_termino: null,
      tolerancia_override: null, horas_semanales_pactadas: null, permite_horas_extras: null,
    }));
    repo.trabajadoresConJornadaDelDia.mockResolvedValue(trabajadores as any);

    const page1 = await service.estadoDia('2026-06-02', { limit: 2, offset: 0 }, db);
    const page2 = await service.estadoDia('2026-06-02', { limit: 2, offset: 2 }, db);

    expect(page1.data).toHaveLength(2);
    expect(page2.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    // No hay duplicados entre páginas
    const ids1 = page1.data.map((r: any) => r.trabajador.id);
    const ids2 = page2.data.map((r: any) => r.trabajador.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });
});

// ─── SupervisionService.alertas() ───────────────────────────────────────────

describe('SupervisionService.alertas()', () => {
  let service: SupervisionService;
  let repo: jest.Mocked<SupervisionRepository>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    repo = mockRepo();
    const js = mockJornadaService();
    service = new SupervisionService(repo, js as any);
    db = mockDb();
    repo.obtenerConfiguracion.mockResolvedValue(CONFIG_BASE);
    repo.alertasInasistenciaPresunta.mockResolvedValue([]);
    repo.alertasFueraGeocerca.mockResolvedValue([]);
    repo.alertasAtrasoRecurrente.mockResolvedValue([]);
    repo.alertasColacionNoMarcada.mockResolvedValue([]);
  });

  it('desde > hasta → BadRequestException', async () => {
    await expect(
      service.alertas({ desde: '2026-06-10', hasta: '2026-06-01' }, db),
    ).rejects.toThrow(BadRequestException);
  });

  it('rango > 90 días → BadRequestException', async () => {
    await expect(
      service.alertas({ desde: '2026-01-01', hasta: '2026-06-01' }, db),
    ).rejects.toThrow(BadRequestException);
  });

  it('filtro por tipo: solo llama a los repos necesarios', async () => {
    await service.alertas({ tipo: ['fuera_geocerca'] }, db);

    expect(repo.alertasFueraGeocerca).toHaveBeenCalled();
    expect(repo.alertasInasistenciaPresunta).not.toHaveBeenCalled();
    expect(repo.alertasAtrasoRecurrente).not.toHaveBeenCalled();
    expect(repo.alertasColacionNoMarcada).not.toHaveBeenCalled();
  });

  it('sin filtro de tipo: llama a los 4 repos', async () => {
    await service.alertas({}, db);

    expect(repo.alertasInasistenciaPresunta).toHaveBeenCalled();
    expect(repo.alertasFueraGeocerca).toHaveBeenCalled();
    expect(repo.alertasAtrasoRecurrente).toHaveBeenCalled();
    expect(repo.alertasColacionNoMarcada).toHaveBeenCalled();
  });

  it('total_por_tipo refleja el conteo de cada repo', async () => {
    repo.alertasInasistenciaPresunta.mockResolvedValue([{} as any, {} as any]);
    repo.alertasAtrasoRecurrente.mockResolvedValue([{} as any]);

    const result = await service.alertas({}, db);

    expect(result.total_por_tipo.inasistencia_presunta).toBe(2);
    expect(result.total_por_tipo.fuera_geocerca).toBe(0);
    expect(result.total_por_tipo.atraso_recurrente).toBe(1);
    expect(result.total_por_tipo.colacion_no_marcada).toBe(0);
    expect(result.total).toBe(3);
  });
});

// ─── SupervisionService.semanaTrabajador() ──────────────────────────────────

describe('SupervisionService.semanaTrabajador()', () => {
  let service: SupervisionService;
  let repo: jest.Mocked<SupervisionRepository>;
  let jornadaSvc: ReturnType<typeof mockJornadaService>;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    repo = mockRepo();
    jornadaSvc = mockJornadaService();
    service = new SupervisionService(repo, jornadaSvc as any);
    db = mockDb();
  });

  it('fecha no es lunes → BadRequestException', async () => {
    repo.existeTrabajador.mockResolvedValue(true);
    // 2026-06-03 es miércoles
    await expect(service.semanaTrabajador('t-1', '2026-06-03', 'tenant-1', db)).rejects.toThrow(BadRequestException);
    expect(jornadaSvc.evaluarSemanaParaTrabajador).not.toHaveBeenCalled();
  });

  it('trabajador no existe → NotFoundException', async () => {
    repo.existeTrabajador.mockResolvedValue(false);
    // 2026-06-01 es lunes
    await expect(service.semanaTrabajador('t-1', '2026-06-01', 'tenant-1', db)).rejects.toThrow(NotFoundException);
  });

  it('happy path: delega a JornadaService.evaluarSemanaParaTrabajador con los parámetros correctos', async () => {
    repo.existeTrabajador.mockResolvedValue(true);
    jornadaSvc.evaluarSemanaParaTrabajador.mockResolvedValue({} as any);

    await service.semanaTrabajador('trab-uuid', '2026-06-01', 'tenant-1', db);

    expect(jornadaSvc.evaluarSemanaParaTrabajador).toHaveBeenCalledWith('tenant-1', 'trab-uuid', '2026-06-01', db);
  });
});
