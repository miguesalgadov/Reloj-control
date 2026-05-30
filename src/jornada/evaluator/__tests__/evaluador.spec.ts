import { fromZonedTime, formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable } from '../../types';
import { evaluarAtraso } from '../regla-atraso';
import { evaluarColacion } from '../regla-colacion';
import { evaluarHorasExtra } from '../regla-horas-extra';
import { evaluarHorasTrabajadas } from '../regla-horas-trabajadas';
import { evaluarInasistencia } from '../regla-inasistencia';
import { evaluarSalidaAnticipada } from '../regla-salida-anticipada';
import { evaluarJornadaDia } from '../evaluador';
import { evaluarSemana, DatosDia } from '../evaluador-semana';
import { diaSemanaIso, inicioSemanaIso, diasDeSemana } from '../utils';

const TZ = 'America/Santiago';
// Base date: Monday 2024-07-15 (Chilean winter = UTC-4)
const D = '2024-07-15';

function utc(dateStr: string, hh: number, mm = 0): Date {
  const hStr = String(hh).padStart(2, '0');
  const mStr = String(mm).padStart(2, '0');
  return fromZonedTime(`${dateStr}T${hStr}:${mStr}:00`, TZ);
}

function mkConfig(overrides: Partial<ConfiguracionJornada> = {}): ConfiguracionJornada {
  return {
    toleranciaAtrasoMinutos: 5,
    toleranciaSalidaAnticipadaMinutos: 5,
    duracionMinimaColacionMinutos: 25,
    duracionMaximaColacionMinutos: 60,
    colacionEsImputableJornada: false,
    umbralInasistenciaSinMarcacionHoras: 2,
    umbralJornadaExtendidaMinutos: 15,
    redondeoHorasExtraMinutos: 30,
    redondeoHorasExtraModo: 'abajo',
    diasLaborables: [1, 2, 3, 4, 5],
    ...overrides,
  };
}

function mkJornada(overrides: Partial<JornadaPactadaVigente> = {}): JornadaPactadaVigente {
  return {
    trabajadorId: 'w1',
    tenantId: 't1',
    contratoId: 'c1',
    horasSemanalesPactadas: 45,
    permiteHorasExtras: true,
    diaSemana: 1,
    horaInicio: '08:00:00',
    horaTermino: '18:00:00',
    colacionInicio: '13:00:00',
    colacionTermino: '14:00:00',
    toleranciaOverride: null,
    ...overrides,
  };
}

function m(tipo: MarcacionEvaluable['tipo'], dateStr: string, hh: number, mm = 0): MarcacionEvaluable {
  return { id: `${tipo}-${dateStr}-${hh}-${mm}`, tipo, timestampUtc: utc(dateStr, hh, mm), dentroGeocerca: true };
}

// ---------------------------------------------------------------------------
describe('evaluarAtraso', () => {
  const jornada = mkJornada({ horaInicio: '08:00:00' });
  const config = mkConfig({ toleranciaAtrasoMinutos: 5 });

  it('sin entrada retorna no atraso', () => {
    const r = evaluarAtraso([], jornada, config);
    expect(r.esAtraso).toBe(false);
    expect(r.minutosAtraso).toBe(0);
    expect(r.marcacionAnticipada).toBe(false);
  });

  it('entrada puntual no es atraso', () => {
    const r = evaluarAtraso([m('entrada', D, 8, 0)], jornada, config);
    expect(r.esAtraso).toBe(false);
    expect(r.minutosAtraso).toBe(0);
  });

  it('entrada dentro de tolerancia no es atraso', () => {
    const r = evaluarAtraso([m('entrada', D, 8, 4)], jornada, config);
    expect(r.esAtraso).toBe(false);
    expect(r.minutosAtraso).toBe(4);
  });

  it('entrada fuera de tolerancia es atraso', () => {
    const r = evaluarAtraso([m('entrada', D, 8, 7)], jornada, config);
    expect(r.esAtraso).toBe(true);
    expect(r.minutosAtraso).toBe(7);
    expect(r.marcacionAnticipada).toBe(false);
  });

  it('tolerancia override de jornada tiene precedencia', () => {
    const jornOv = mkJornada({ toleranciaOverride: 10 });
    const r = evaluarAtraso([m('entrada', D, 8, 7)], jornOv, config);
    expect(r.esAtraso).toBe(false);
  });

  it('entrada anticipada marca flag y minutosAtraso es 0', () => {
    const r = evaluarAtraso([m('entrada', D, 7, 55)], jornada, config);
    expect(r.esAtraso).toBe(false);
    expect(r.marcacionAnticipada).toBe(true);
    expect(r.minutosAtraso).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('evaluarSalidaAnticipada', () => {
  const jornada = mkJornada({ horaTermino: '18:00:00' });
  const config = mkConfig({ toleranciaSalidaAnticipadaMinutos: 5 });

  it('sin salida retorna no anticipada', () => {
    const r = evaluarSalidaAnticipada([], jornada, config);
    expect(r.esSalidaAnticipada).toBe(false);
    expect(r.minutosSalidaAnticipada).toBe(0);
  });

  it('salida puntual no es anticipada', () => {
    const r = evaluarSalidaAnticipada([m('salida', D, 18, 0)], jornada, config);
    expect(r.esSalidaAnticipada).toBe(false);
  });

  it('salida dentro de tolerancia no es anticipada', () => {
    const r = evaluarSalidaAnticipada([m('salida', D, 17, 57)], jornada, config);
    expect(r.esSalidaAnticipada).toBe(false);
    expect(r.minutosSalidaAnticipada).toBe(3);
  });

  it('salida fuera de tolerancia es anticipada', () => {
    const r = evaluarSalidaAnticipada([m('salida', D, 17, 50)], jornada, config);
    expect(r.esSalidaAnticipada).toBe(true);
    expect(r.minutosSalidaAnticipada).toBe(10);
  });

  it('usa la ultima salida del dia', () => {
    const marcaciones = [m('salida', D, 17, 30), m('salida', D, 18, 5)];
    const r = evaluarSalidaAnticipada(marcaciones, jornada, config);
    expect(r.esSalidaAnticipada).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('evaluarInasistencia', () => {
  const config = mkConfig({ umbralInasistenciaSinMarcacionHoras: 2 });
  const jornada = mkJornada({ horaInicio: '08:00:00' });

  it('jornada null retorna no_laborable', () => {
    const r = evaluarInasistencia([], null, config, D, new Date('2024-07-15T16:00:00Z'));
    expect(r.inasistencia).toBe(false);
    expect(r.motivo).toBe('no_laborable');
  });

  it('tiene entrada retorna normal', () => {
    const r = evaluarInasistencia([m('entrada', D, 8, 0)], jornada, config, D, new Date('2024-07-15T16:00:00Z'));
    expect(r.inasistencia).toBe(false);
    expect(r.motivo).toBe('normal');
  });

  it('fecha futura retorna futuro', () => {
    const r = evaluarInasistencia([], jornada, config, '2024-07-16', new Date('2024-07-15T16:00:00Z'));
    expect(r.inasistencia).toBe(false);
    expect(r.motivo).toBe('futuro');
  });

  it('fecha pasada sin entrada es inasistencia', () => {
    const r = evaluarInasistencia([], jornada, config, '2024-07-14', new Date('2024-07-15T16:00:00Z'));
    expect(r.inasistencia).toBe(true);
    expect(r.motivo).toBe('sin_marcacion_entrada');
    expect(r.presunta).toBe(false);
  });

  it('hoy con umbral superado es inasistencia_presunta', () => {
    // 11:00 Santiago (UTC-4) = 15:00 UTC; inicio 08:00, umbral 2h → 11:00 >= 10:00 → presunta
    const ahora = utc(D, 11, 0);
    const r = evaluarInasistencia([], jornada, config, D, ahora);
    expect(r.inasistencia).toBe(true);
    expect(r.motivo).toBe('inasistencia_presunta');
    expect(r.presunta).toBe(true);
  });

  it('hoy con umbral no superado espera marcacion', () => {
    // 09:00 Santiago = 13:00 UTC; minutosAhora=540, inicio=480, 540-480=60 < 120
    const ahora = utc(D, 9, 0);
    const r = evaluarInasistencia([], jornada, config, D, ahora);
    expect(r.inasistencia).toBe(false);
    expect(r.motivo).toBe('esperando_marcacion');
  });
});

// ---------------------------------------------------------------------------
describe('evaluarColacion', () => {
  const config = mkConfig({ duracionMinimaColacionMinutos: 25, duracionMaximaColacionMinutos: 60 });
  const jornada = mkJornada({ colacionInicio: '13:00:00', colacionTermino: '14:00:00' });
  const jornadaSinColacion = mkJornada({ colacionInicio: null, colacionTermino: null });

  it('sin colacion pactada retorna aplica false', () => {
    const r = evaluarColacion([], jornadaSinColacion, config);
    expect(r.aplica).toBe(false);
    expect(r.motivo).toBe('colacion_no_pactada');
  });

  it('colacion pactada sin marcacion retorna cumple false', () => {
    const r = evaluarColacion([], jornada, config);
    expect(r.aplica).toBe(true);
    expect(r.cumple).toBe(false);
    expect(r.motivo).toBe('colacion_no_marcada_completa');
  });

  it('solo inicio sin fin retorna cumple false', () => {
    const r = evaluarColacion([m('inicio_colacion', D, 13, 0)], jornada, config);
    expect(r.aplica).toBe(true);
    expect(r.cumple).toBe(false);
  });

  it('duracion valida cumple', () => {
    const mcs = [m('inicio_colacion', D, 13, 0), m('fin_colacion', D, 13, 30)];
    const r = evaluarColacion(mcs, jornada, config);
    expect(r.aplica).toBe(true);
    expect(r.cumple).toBe(true);
    expect(r.duracionRealMinutos).toBe(30);
  });

  it('duracion menor al minimo no cumple', () => {
    const mcs = [m('inicio_colacion', D, 13, 0), m('fin_colacion', D, 13, 20)];
    const r = evaluarColacion(mcs, jornada, config);
    expect(r.cumple).toBe(false);
    expect(r.duracionRealMinutos).toBe(20);
  });

  it('duracion mayor al maximo es colacion_excedida', () => {
    const mcs = [m('inicio_colacion', D, 13, 0), m('fin_colacion', D, 14, 5)];
    const r = evaluarColacion(mcs, jornada, config);
    expect(r.cumple).toBe(false);
    expect(r.motivo).toBe('colacion_excedida');
    expect(r.duracionRealMinutos).toBe(65);
  });

  it('fin antes de inicio es datos_inconsistentes', () => {
    const mcs = [m('inicio_colacion', D, 13, 30), m('fin_colacion', D, 13, 0)];
    const r = evaluarColacion(mcs, jornada, config);
    expect(r.cumple).toBe(false);
    expect(r.motivo).toBe('datos_inconsistentes');
  });
});

// ---------------------------------------------------------------------------
describe('evaluarHorasTrabajadas', () => {
  const config = mkConfig({ colacionEsImputableJornada: false });
  const jornada = mkJornada({ colacionInicio: '13:00:00', colacionTermino: '14:00:00' });
  const jornadaSinColacion = mkJornada({ colacionInicio: null, colacionTermino: null });

  it('sin entrada retorna marcaje_incompleto', () => {
    const r = evaluarHorasTrabajadas([], jornada, config);
    expect(r.horasTrabajadas).toBeNull();
    expect(r.motivo).toBe('marcaje_incompleto');
  });

  it('sin salida retorna marcaje_incompleto', () => {
    const r = evaluarHorasTrabajadas([m('entrada', D, 8, 0)], jornada, config);
    expect(r.horasTrabajadas).toBeNull();
    expect(r.motivo).toBe('marcaje_incompleto');
  });

  it('sin colacion pactada calcula duracion bruta', () => {
    const mcs = [m('entrada', D, 8, 0), m('salida', D, 16, 30)];
    const r = evaluarHorasTrabajadas(mcs, jornadaSinColacion, config);
    expect(r.minutosTrabajados).toBe(510);
    expect(r.horasTrabajadas).toBe(8.5);
  });

  it('con colacion marcada descuenta la duracion real', () => {
    const mcs = [
      m('entrada', D, 8, 0),
      m('inicio_colacion', D, 13, 0),
      m('fin_colacion', D, 13, 45),
      m('salida', D, 18, 0),
    ];
    const r = evaluarHorasTrabajadas(mcs, jornada, config);
    expect(r.minutosTrabajados).toBe(555); // 600 brutos - 45 real
    expect(r.horasTrabajadas).toBe(9.25);
  });

  it('colacion pactada no marcada descuenta la pactada', () => {
    const mcs = [m('entrada', D, 8, 0), m('salida', D, 18, 0)];
    const r = evaluarHorasTrabajadas(mcs, jornada, config);
    expect(r.minutosTrabajados).toBe(540); // 600 brutos - 60 pactada
    expect(r.horasTrabajadas).toBe(9);
  });

  it('colacion imputable no se descuenta del tiempo trabajado', () => {
    const configImputable = mkConfig({ colacionEsImputableJornada: true });
    const mcs = [
      m('entrada', D, 8, 0),
      m('inicio_colacion', D, 13, 0),
      m('fin_colacion', D, 13, 30),
      m('salida', D, 18, 0),
    ];
    const r = evaluarHorasTrabajadas(mcs, jornada, configImputable);
    expect(r.minutosTrabajados).toBe(600);
    expect(r.horasTrabajadas).toBe(10);
  });
});

// ---------------------------------------------------------------------------
describe('evaluarHorasExtra', () => {
  const config = mkConfig({ umbralJornadaExtendidaMinutos: 15, redondeoHorasExtraMinutos: 30 });
  const jornada = mkJornada({ horaTermino: '18:00:00' });

  it('sin salida produce 0 extra', () => {
    const r = evaluarHorasExtra([{ jornada, marcaciones: [] }], config, true);
    expect(r.minutosExtraBrutos).toBe(0);
  });

  it('salida dentro del umbral produce 0 extra', () => {
    // 18:10 → 10 min después, umbral 15 → excedente = max(0, 10-15) = 0
    const r = evaluarHorasExtra([{ jornada, marcaciones: [m('salida', D, 18, 10)] }], config, true);
    expect(r.minutosExtraBrutos).toBe(0);
  });

  it('salida tras umbral produce horas extra', () => {
    // 18:45 → 45 min después, umbral 15 → excedente = 30 min brutos; bloque 30, abajo → 30
    const r = evaluarHorasExtra([{ jornada, marcaciones: [m('salida', D, 18, 45)] }], config, true);
    expect(r.minutosExtraBrutos).toBe(30);
    expect(r.minutosExtraRedondeados).toBe(30);
    expect(r.horasExtra).toBe(0.5);
  });

  it('sin permiso de horas extras horasExtra es 0', () => {
    const r = evaluarHorasExtra([{ jornada, marcaciones: [m('salida', D, 18, 45)] }], config, false);
    expect(r.horasExtra).toBe(0);
    expect(r.minutosExtraRedondeados).toBe(0);
    expect(r.motivo).toBe('no_permitidas_por_contrato');
  });

  it('acumula extras de multiples dias', () => {
    const dias = [
      { jornada, marcaciones: [m('salida', D, 18, 45)] },
      { jornada, marcaciones: [m('salida', '2024-07-16', 18, 45)] },
    ];
    const r = evaluarHorasExtra(dias, config, true);
    expect(r.minutosExtraBrutos).toBe(60);
    expect(r.minutosExtraRedondeados).toBe(60);
    expect(r.horasExtra).toBe(1);
  });

  it('redondeo abajo descarta brutos por debajo del bloque', () => {
    // 18:25 → 25 min después, umbral 15 → 10 brutos; bloque 30, abajo → 0
    const r = evaluarHorasExtra([{ jornada, marcaciones: [m('salida', D, 18, 25)] }], config, true);
    expect(r.minutosExtraBrutos).toBe(10);
    expect(r.minutosExtraRedondeados).toBe(0);
    expect(r.horasExtra).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('evaluarJornadaDia', () => {
  const config = mkConfig();

  it('dia no laborable (jornada null) retorna esDiaLaborable false', () => {
    const ahora = utc(D, 12, 0);
    const r = evaluarJornadaDia([], null, config, D, ahora);
    expect(r.esDiaLaborable).toBe(false);
    expect(r.atraso).toBeNull();
    expect(r.salidaAnticipada).toBeNull();
    expect(r.inasistencia.motivo).toBe('no_laborable');
    expect(r.colacion.aplica).toBe(false);
    expect(r.horasTrabajadas.horasTrabajadas).toBeNull();
    expect(r.jornadaPactada).toBeNull();
  });

  it('dia completo evalua todas las reglas correctamente', () => {
    const jornada = mkJornada();
    const marcaciones = [
      m('entrada', D, 8, 7),
      m('inicio_colacion', D, 13, 0),
      m('fin_colacion', D, 13, 30),
      m('salida', D, 18, 0),
    ];
    const ahora = utc(D, 12, 0);
    const r = evaluarJornadaDia(marcaciones, jornada, config, D, ahora);
    expect(r.esDiaLaborable).toBe(true);
    expect(r.atraso!.esAtraso).toBe(true);
    expect(r.salidaAnticipada!.esSalidaAnticipada).toBe(false);
    expect(r.inasistencia.motivo).toBe('normal');
    expect(r.colacion.cumple).toBe(true);
    expect(r.anomalias).toHaveLength(0);
  });

  it('detecta marcaciones_duplicadas como anomalia', () => {
    const jornada = mkJornada();
    const marcaciones = [m('entrada', D, 8, 0), m('entrada', D, 8, 5), m('salida', D, 18, 0)];
    const ahora = utc(D, 12, 0);
    const r = evaluarJornadaDia(marcaciones, jornada, config, D, ahora);
    expect(r.anomalias).toContain('marcaciones_duplicadas');
  });

  it('dia laborable sin marcaciones post-umbral es inasistencia_presunta', () => {
    const jornada = mkJornada();
    const ahora = utc(D, 11, 0); // 11:00 Santiago, inicio 08:00, umbral 2h → presunta
    const r = evaluarJornadaDia([], jornada, config, D, ahora);
    expect(r.inasistencia.motivo).toBe('inasistencia_presunta');
  });
});

// ---------------------------------------------------------------------------
describe('evaluarSemana', () => {
  const LUNES = '2024-07-15';
  const config = mkConfig({ umbralJornadaExtendidaMinutos: 15, redondeoHorasExtraMinutos: 30 });
  // 9h/day: 08:00-17:00, sin colacion
  const jornada9h = mkJornada({
    horasSemanalesPactadas: 40,
    permiteHorasExtras: true,
    horaTermino: '17:00:00',
    colacionInicio: null,
    colacionTermino: null,
  });

  function dayData(dateStr: string, jornada: JornadaPactadaVigente | null, hasMarcaciones: boolean): DatosDia {
    return {
      fechaStr: dateStr,
      jornada,
      marcaciones: hasMarcaciones
        ? [m('entrada', dateStr, 8, 0), m('salida', dateStr, 17, 0)]
        : [],
    };
  }

  const SEMANA_5_DIAS: DatosDia[] = [
    dayData('2024-07-15', jornada9h, true),
    dayData('2024-07-16', jornada9h, true),
    dayData('2024-07-17', jornada9h, true),
    dayData('2024-07-18', jornada9h, true),
    dayData('2024-07-19', jornada9h, true),
    dayData('2024-07-20', null, false),
    dayData('2024-07-21', null, false),
  ];

  it('calcula horasAcumuladas y diferencia para semana completa', () => {
    const ahora = new Date('2024-07-22T00:00:00Z');
    const r = evaluarSemana(SEMANA_5_DIAS, config, ahora, LUNES);
    expect(r.horasAcumuladas).toBe(45);
    expect(r.horasPactadas).toBe(40);
    expect(r.diferencia).toBe(5);
    expect(r.cumpleJornadaPactada).toBe(true);
    expect(r.semanaInicio).toBe(LUNES);
    expect(r.semanaTermino).toBe('2024-07-21');
    expect(r.dias).toHaveLength(7);
  });

  it('diferencia negativa implica cumpleJornadaPactada false', () => {
    const ahora = new Date('2024-07-22T00:00:00Z');
    const semana: DatosDia[] = [
      dayData('2024-07-15', jornada9h, true),
      dayData('2024-07-16', jornada9h, false),
      dayData('2024-07-17', jornada9h, false),
      dayData('2024-07-18', jornada9h, false),
      dayData('2024-07-19', jornada9h, false),
      dayData('2024-07-20', null, false),
      dayData('2024-07-21', null, false),
    ];
    const r = evaluarSemana(semana, config, ahora, LUNES);
    expect(r.horasAcumuladas).toBe(9);
    expect(r.cumpleJornadaPactada).toBe(false);
  });

  it('dia con marcaje incompleto no suma horas', () => {
    const ahora = new Date('2024-07-22T00:00:00Z');
    const semana: DatosDia[] = [
      { fechaStr: '2024-07-15', jornada: jornada9h, marcaciones: [m('entrada', '2024-07-15', 8, 0)] },
      dayData('2024-07-16', jornada9h, true),
      dayData('2024-07-17', null, false),
      dayData('2024-07-18', null, false),
      dayData('2024-07-19', null, false),
      dayData('2024-07-20', null, false),
      dayData('2024-07-21', null, false),
    ];
    const r = evaluarSemana(semana, config, ahora, LUNES);
    expect(r.horasAcumuladas).toBe(9);
  });

  it('acumula horas extra de toda la semana', () => {
    // Salida 18:45 cada dia (termino 18:00, umbral 15 → 30 brutos/dia × 5 = 150)
    const jornada18 = mkJornada({
      horasSemanalesPactadas: 40,
      permiteHorasExtras: true,
      horaTermino: '18:00:00',
      colacionInicio: null,
      colacionTermino: null,
    });
    const semana: DatosDia[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        fechaStr: `2024-07-${15 + i}`,
        jornada: jornada18,
        marcaciones: [
          m('entrada', `2024-07-${15 + i}`, 8, 0),
          m('salida', `2024-07-${15 + i}`, 18, 45),
        ],
      })),
      dayData('2024-07-20', null, false),
      dayData('2024-07-21', null, false),
    ];
    const ahora = new Date('2024-07-22T00:00:00Z');
    const r = evaluarSemana(semana, config, ahora, LUNES);
    expect(r.minutosExtraBrutos).toBe(150);
    expect(r.minutosExtraRedondeados).toBe(150);
    expect(r.horasExtra).toBe(2.5);
  });

  it('semana sin jornadas pactadas da horasPactadas 0', () => {
    const ahora = new Date('2024-07-22T00:00:00Z');
    const semana: DatosDia[] = Array.from({ length: 7 }, (_, i) => ({
      fechaStr: `2024-07-${15 + i}`,
      jornada: null,
      marcaciones: [],
    }));
    const r = evaluarSemana(semana, config, ahora, LUNES);
    expect(r.horasPactadas).toBe(0);
    expect(r.horasAcumuladas).toBe(0);
    expect(r.cumpleJornadaPactada).toBe(true); // 0 >= 0
  });
});

// ---------------------------------------------------------------------------
describe('utils: diaSemanaIso, inicioSemanaIso, diasDeSemana', () => {
  it('diaSemanaIso retorna 1..6 para lunes..sabado', () => {
    // 2024-07-15 = Monday in Chile
    const local = toZonedTime(fromZonedTime('2024-07-15T12:00:00', TZ), TZ);
    expect(diaSemanaIso(local)).toBe(1);
  });

  it('diaSemanaIso retorna 7 para domingo (getDay()===0)', () => {
    // 2024-07-21 = Sunday in Chile
    const local = toZonedTime(fromZonedTime('2024-07-21T12:00:00', TZ), TZ);
    expect(diaSemanaIso(local)).toBe(7);
  });

  it('inicioSemanaIso retorna el lunes de la semana dada', () => {
    // Wednesday 2024-07-17 → Monday should be 2024-07-15
    const miercoles = fromZonedTime('2024-07-17T12:00:00', TZ);
    const lunes = inicioSemanaIso(miercoles);
    expect(formatInTimeZone(lunes, TZ, 'yyyy-MM-dd')).toBe('2024-07-15');
  });

  it('inicioSemanaIso para domingo retorna el lunes anterior', () => {
    const domingo = fromZonedTime('2024-07-21T12:00:00', TZ);
    const lunes = inicioSemanaIso(domingo);
    expect(formatInTimeZone(lunes, TZ, 'yyyy-MM-dd')).toBe('2024-07-15');
  });

  it('diasDeSemana genera 7 fechas consecutivas desde el lunes', () => {
    const fechas = diasDeSemana('2024-07-15');
    expect(fechas).toHaveLength(7);
    expect(fechas[0]).toBe('2024-07-15');
    expect(fechas[6]).toBe('2024-07-21');
  });
});

// ---------------------------------------------------------------------------
describe('sort callbacks: cobertura de comparadores', () => {
  const config = mkConfig();
  const jornada = mkJornada({ colacionInicio: '13:00:00', colacionTermino: '14:00:00' });

  it('evaluarHorasTrabajadas ordena multiples entradas y usa la primera', () => {
    // Two entradas: 08:10 first, 08:00 second (out of order) → should use 08:00
    const mcs = [
      m('entrada', D, 8, 10),
      m('entrada', D, 8, 0),   // earlier, becomes first after sort
      m('salida', D, 18, 0),
    ];
    const r = evaluarHorasTrabajadas(mcs, jornada, config);
    // entrada = 08:00, salida = 18:00, bruto = 600 min, - pactada 60 = 540
    expect(r.minutosTrabajados).toBe(540);
  });

  it('evaluarHorasExtra ordena multiples salidas y usa la ultima', () => {
    const configExtra = mkConfig({ umbralJornadaExtendidaMinutos: 15, redondeoHorasExtraMinutos: 30 });
    const dias = [{
      jornada: mkJornada({ horaTermino: '18:00:00' }),
      marcaciones: [
        m('salida', D, 18, 45),
        m('salida', D, 18, 30), // earlier: sort by timestamp asc → last = 18:45
      ],
    }];
    const r = evaluarHorasExtra(dias, configExtra, true);
    // last salida = 18:45, excedente = 45-15 = 30 brutos
    expect(r.minutosExtraBrutos).toBe(30);
  });

  it('evaluarColacion ordena multiples inicios y fines de colacion', () => {
    // Two inicio_colacion and fin_colacion: use first of each
    const mcs = [
      m('inicio_colacion', D, 13, 10),
      m('inicio_colacion', D, 13, 0),  // earlier → first after sort
      m('fin_colacion', D, 13, 40),
      m('fin_colacion', D, 13, 30),    // earlier → first after sort
    ];
    const r = evaluarColacion(mcs, jornada, config);
    // first inicio=13:00, first fin=13:30 → 30 min
    expect(r.duracionRealMinutos).toBe(30);
    expect(r.cumple).toBe(true);
  });
});
