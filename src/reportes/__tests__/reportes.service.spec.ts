import { BadRequestException } from '@nestjs/common';
import { ReportesService } from '../reportes.service';
import type { ReportesRepository, TrabajadorPeriodoRow, JornadaPeriodoRow, MarcacionPeriodoRow } from '../reportes.repository';
import { generarExcelAsistencia, generarExcelLibroAsistencia } from '../reportes.excel';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function mockRepo(): jest.Mocked<ReportesRepository> {
  return {
    getTenantInfo: jest.fn().mockResolvedValue({ id: 'tenant-1', razon_social: 'Empresa Test' }),
    obtenerConfiguracion: jest.fn().mockResolvedValue({
      toleranciaAtrasoMinutos: 10,
      toleranciaSalidaAnticipadaMinutos: 5,
      duracionMinimaColacionMinutos: 25,
      duracionMaximaColacionMinutos: 60,
      colacionEsImputableJornada: false,
      umbralInasistenciaSinMarcacionHoras: 2,
      umbralJornadaExtendidaMinutos: 15,
      redondeoHorasExtraMinutos: 15,
      redondeoHorasExtraModo: 'abajo',
      diasLaborables: [1, 2, 3, 4, 5],
    }),
    trabajadoresDelPeriodo: jest.fn().mockResolvedValue([]),
    jornadasDelPeriodo: jest.fn().mockResolvedValue([]),
    marcacionesDelPeriodo: jest.fn().mockResolvedValue([]),
    centrosActivos: jest.fn().mockResolvedValue([]),
    countMarcacionesFueraGeocerca: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<ReportesRepository>;
}

function mockDb() { return {} as any; }

function makeTrabajador(overrides: Partial<TrabajadorPeriodoRow> = {}): TrabajadorPeriodoRow {
  return {
    id: 'trab-1', rut: '12345678-9', nombres: 'Juan', apellido_paterno: 'Perez', apellido_materno: null,
    fecha_ingreso: '2026-01-01', fecha_termino: null, estado: 'activo',
    centro_trabajo_id: 'centro-1', centro_trabajo_nombre: 'Obra A',
    contrato_id: 'cont-1', cargo: 'Operario', tipo_contrato: 'indefinido',
    horas_semanales: 44, permite_horas_extras: false,
    contrato_inicio: '2026-01-01', contrato_termino: null,
    ...overrides,
  };
}

function makeJornada(overrides: Partial<JornadaPeriodoRow> = {}): JornadaPeriodoRow {
  return {
    contrato_id: 'cont-1', dia_semana: 1,
    hora_inicio: '08:00:00', hora_termino: '18:00:00',
    colacion_inicio: '13:00:00', colacion_termino: '14:00:00',
    tolerancia_minutos: 10,
    ...overrides,
  };
}

// Jornada L-V (días 1-5)
function jornadasLV(): JornadaPeriodoRow[] {
  return [1, 2, 3, 4, 5].map(d => makeJornada({ dia_semana: d }));
}

// ─── Validaciones ─────────────────────────────────────────────────────────────

describe('ReportesService — validaciones', () => {
  let service: ReportesService;
  let repo: jest.Mocked<ReportesRepository>;

  beforeEach(() => {
    repo = mockRepo();
    service = new ReportesService(repo);
  });

  it('mes futuro → BadRequestException', async () => {
    const añoFuturo = new Date().getFullYear() + 1;
    await expect(service.asistencia({ anio: añoFuturo, mes: 1 }, {}, mockDb())).rejects.toThrow(BadRequestException);
  });

  it('mes actual del año siguiente → BadRequestException', async () => {
    const hoy = new Date();
    const añoSig = hoy.getFullYear() + 1;
    await expect(service.asistencia({ anio: añoSig, mes: hoy.getMonth() + 1 }, {}, mockDb())).rejects.toThrow(BadRequestException);
  });

  it('mes pasado válido no lanza excepción', async () => {
    repo.trabajadoresDelPeriodo.mockResolvedValue([]);
    repo.jornadasDelPeriodo.mockResolvedValue([]);
    repo.marcacionesDelPeriodo.mockResolvedValue([]);
    await expect(service.asistencia({ anio: 2025, mes: 1 }, {}, mockDb())).resolves.toBeDefined();
  });

  it('> 500 trabajadores → BadRequestException con mensaje de filtrado', async () => {
    const trab501 = Array.from({ length: 501 }, (_, i) => makeTrabajador({ id: `t-${i}`, rut: `1234567${i}-9` }));
    repo.trabajadoresDelPeriodo.mockResolvedValue(trab501);
    await expect(service.asistencia({ anio: 2026, mes: 1 }, {}, mockDb())).rejects.toThrow(BadRequestException);
  });
});

// ─── Lógica de días laborables ────────────────────────────────────────────────

describe('ReportesService — cálculo de días', () => {
  let service: ReportesService;
  let repo: jest.Mocked<ReportesRepository>;

  beforeEach(() => {
    repo = mockRepo();
    service = new ReportesService(repo);
    repo.trabajadoresDelPeriodo.mockResolvedValue([makeTrabajador()]);
    repo.jornadasDelPeriodo.mockResolvedValue(jornadasLV());
    repo.marcacionesDelPeriodo.mockResolvedValue([]);
  });

  it('trabajador L-V tiene 5 días laborables la primera semana de junio 2026', async () => {
    const result = await service.asistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const trab = result.trabajadores[0];
    // Primera semana de junio 2026: L1-V5
    const primerosDias = trab.dias.slice(0, 5);
    expect(primerosDias.every(d => d.es_laborable)).toBe(true);
    // Sábado 6 de junio no es laborable
    expect(trab.dias[5].es_laborable).toBe(false);
  });

  it('días anteriores a fecha_ingreso no están en período del trabajador', async () => {
    repo.trabajadoresDelPeriodo.mockResolvedValue([makeTrabajador({ fecha_ingreso: '2026-06-10' })]);
    const result = await service.asistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const trab = result.trabajadores[0];
    // Días 1-9 deben tener en_periodo_trabajador = false
    const diasAntes = trab.dias.filter(d => d.fecha < '2026-06-10');
    expect(diasAntes.every(d => !d.en_periodo_trabajador)).toBe(true);
    // Día 10 en adelante sí
    const diasDespues = trab.dias.filter(d => d.fecha >= '2026-06-10');
    expect(diasDespues.some(d => d.en_periodo_trabajador)).toBe(true);
  });

  it('días posteriores a fecha_termino no están en período', async () => {
    repo.trabajadoresDelPeriodo.mockResolvedValue([makeTrabajador({ fecha_termino: '2026-06-15' })]);
    const result = await service.asistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const trab = result.trabajadores[0];
    const diasDespues = trab.dias.filter(d => d.fecha > '2026-06-15');
    expect(diasDespues.every(d => !d.en_periodo_trabajador)).toBe(true);
  });

  it('totales_mes suma correctamente días trabajados y atrasos', async () => {
    // Simular 2 entradas: una puntual, una con atraso (8:25 Chile UTC-4 = 12:25 UTC)
    const marcaciones: MarcacionPeriodoRow[] = [
      { id: 'm1', trabajador_id: 'trab-1', tipo: 'entrada', timestamp_utc: new Date('2026-06-02T12:00:00Z'), dentro_geocerca: true },
      { id: 'm2', trabajador_id: 'trab-1', tipo: 'entrada', timestamp_utc: new Date('2026-06-03T12:25:00Z'), dentro_geocerca: true },
    ];
    repo.marcacionesDelPeriodo.mockResolvedValue(marcaciones);
    const result = await service.asistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const trab = result.trabajadores[0];
    expect(trab.totales_mes.dias_trabajados).toBeGreaterThanOrEqual(2);
    expect(trab.totales_mes.atrasos_total_minutos).toBeGreaterThan(0);
  });

  it('ajuste tipo correccion → reporte usa hora corregida', async () => {
    // Entrada original: 08:30 CLT (12:30 UTC) — 30 min tarde → atraso_minutos = 30
    // Corrección a:     07:55 CLT (11:55 UTC) — antes del inicio → atraso_minutos = 0
    const marcaciones: MarcacionPeriodoRow[] = [
      {
        id: 'm1', trabajador_id: 'trab-1', tipo: 'entrada',
        timestamp_utc: new Date('2026-06-01T12:30:00Z'),
        dentro_geocerca: true, marcacion_original_id: null, datos_ajuste: null,
      },
      {
        id: 'a1', trabajador_id: 'trab-1', tipo: 'ajuste',
        timestamp_utc: new Date('2026-06-01T11:55:00Z'),  // 07:55 CLT
        dentro_geocerca: true, marcacion_original_id: 'm1',
        datos_ajuste: { tipo_ajuste: 'correccion' },
      },
    ];
    repo.marcacionesDelPeriodo.mockResolvedValue(marcaciones);
    const result = await service.asistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const dia = result.trabajadores[0].dias.find(d => d.fecha === '2026-06-01');
    expect(dia?.evaluacion.atraso_minutos).toBe(0);      // corregida a antes de inicio
    expect(dia?.evaluacion.inasistencia).toBe(false);
    expect(dia?.marcaciones[0]?.hora_local).toBe('07:55'); // hora corregida reflejada
  });

  it('ajuste tipo anulacion → reporte marca inasistencia el día anulado', async () => {
    // Entrada en 08:00, luego anulada → sin marcación efectiva → inasistencia
    const marcaciones: MarcacionPeriodoRow[] = [
      {
        id: 'm1', trabajador_id: 'trab-1', tipo: 'entrada',
        timestamp_utc: new Date('2026-06-02T12:00:00Z'),
        dentro_geocerca: true, marcacion_original_id: null, datos_ajuste: null,
      },
      {
        id: 'a1', trabajador_id: 'trab-1', tipo: 'ajuste',
        timestamp_utc: new Date('2026-06-02T12:00:00Z'),
        dentro_geocerca: null, marcacion_original_id: 'm1',
        datos_ajuste: { tipo_ajuste: 'anulacion' },
      },
    ];
    repo.marcacionesDelPeriodo.mockResolvedValue(marcaciones);
    const result = await service.asistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const dia = result.trabajadores[0].dias.find(d => d.fecha === '2026-06-02');
    expect(dia?.evaluacion.inasistencia).toBe(true);
  });
});

// ─── libroAsistencia — letras P/A/T/— ────────────────────────────────────────

describe('ReportesService — libroAsistencia letras', () => {
  let service: ReportesService;
  let repo: jest.Mocked<ReportesRepository>;

  beforeEach(() => {
    repo = mockRepo();
    service = new ReportesService(repo);
    repo.trabajadoresDelPeriodo.mockResolvedValue([makeTrabajador()]);
    repo.jornadasDelPeriodo.mockResolvedValue(jornadasLV());
    repo.marcacionesDelPeriodo.mockResolvedValue([]);
  });

  it('día laborable sin marcación → A (inasistencia)', async () => {
    const result = await service.libroAsistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const fila = result.filas[0];
    // 2026-06-01 es lunes — día laborable sin marcación → ausente (mes pasado)
    expect(fila.dias['2026-06-01']).toBe('A');
  });

  it('día no laborable → —', async () => {
    const result = await service.libroAsistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const fila = result.filas[0];
    // 2026-06-07 es domingo — no laborable
    expect(fila.dias['2026-06-07']).toBe('—');
  });

  it('día con entrada sin atraso → P', async () => {
    const entradaPuntual: MarcacionPeriodoRow[] = [
      { id: 'm1', trabajador_id: 'trab-1', tipo: 'entrada', timestamp_utc: new Date('2026-06-01T12:00:00Z'), dentro_geocerca: true },
    ];
    repo.marcacionesDelPeriodo.mockResolvedValue(entradaPuntual);
    const result = await service.libroAsistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const fila = result.filas[0];
    expect(fila.dias['2026-06-01']).toBe('P');
  });

  it('día con entrada con atraso → T', async () => {
    // 12:25 UTC = 08:25 CLT — 25 min tarde (> 10 min tolerancia)
    const entradaAtrasada: MarcacionPeriodoRow[] = [
      { id: 'm1', trabajador_id: 'trab-1', tipo: 'entrada', timestamp_utc: new Date('2026-06-02T12:25:00Z'), dentro_geocerca: true },
    ];
    repo.marcacionesDelPeriodo.mockResolvedValue(entradaAtrasada);
    const result = await service.libroAsistencia({ anio: 2026, mes: 6 }, {}, mockDb());
    const fila = result.filas[0];
    expect(fila.dias['2026-06-02']).toBe('T');
  });
});

// ─── Excel magic bytes ────────────────────────────────────────────────────────

describe('generarExcelAsistencia()', () => {
  it('buffer no vacío y empieza con magic bytes XLSX (PK\\x03\\x04)', async () => {
    const datos = {
      periodo: { anio: 2026, mes: 6, nombre_mes: 'Junio 2026', fecha_inicio: '2026-06-01', fecha_termino: '2026-06-30' },
      tenant: { id: 't1', razon_social: 'Empresa Test' },
      filtros: { trabajador_id: null, centro_trabajo_id: null },
      trabajadores: [],
      totales_periodo: { trabajadores_evaluados: 0, total_horas_ordinarias: 0, total_horas_extra: 0, total_dias_trabajados: 0, total_atrasos_minutos: 0 },
      generado_en: new Date().toISOString(),
    };
    const buf = await generarExcelAsistencia(datos);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4B); // 'K'
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });
});

describe('generarExcelLibroAsistencia()', () => {
  it('buffer no vacío con magic bytes XLSX', async () => {
    const datos = {
      periodo: { anio: 2026, mes: 6, nombre_mes: 'Junio 2026', fecha_inicio: '2026-06-01', fecha_termino: '2026-06-30' },
      tenant: { id: 't1', razon_social: 'Empresa Test' },
      dias_mes: [{ fecha: '2026-06-01', dia: 1, dia_semana: 'Lun' }],
      filas: [],
      leyenda: {},
      generado_en: new Date().toISOString(),
    };
    const buf = await generarExcelLibroAsistencia(datos);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4B);
  });
});
