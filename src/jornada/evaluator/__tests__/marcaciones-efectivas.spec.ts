import { obtenerMarcacionesEfectivas, MarcacionConDatos } from '../marcaciones-efectivas';

function marc(id: string, tipo: string, tsOffset = 0, ajuste?: { tipo_ajuste: 'creacion' | 'correccion' | 'anulacion'; originalId?: string }): MarcacionConDatos {
  return {
    id,
    tipo: tipo as MarcacionConDatos['tipo'],
    timestampUtc: new Date(Date.UTC(2026, 5, 1, 8, 0, 0) + tsOffset * 1000),
    dentroGeocerca: true,
    marcacionOriginalId: ajuste?.originalId ?? null,
    datosAjuste: ajuste ? { tipo_ajuste: ajuste.tipo_ajuste } : null,
  };
}

describe('obtenerMarcacionesEfectivas()', () => {
  it('sin ajustes → retorna las originales sin cambios', () => {
    const m = [marc('m1', 'entrada'), marc('m2', 'salida', 3600)];
    const result = obtenerMarcacionesEfectivas(m);
    expect(result.map(r => r.id)).toEqual(['m1', 'm2']);
  });

  it('corrección → la original es reemplazada por el ajuste', () => {
    const original = marc('m1', 'entrada');
    const correccion = marc('a1', 'ajuste', 100, { tipo_ajuste: 'correccion', originalId: 'm1' });
    const result = obtenerMarcacionesEfectivas([original, correccion]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('anulación → la original es eliminada del resultado', () => {
    const original = marc('m1', 'entrada');
    const anulacion = marc('a1', 'ajuste', 100, { tipo_ajuste: 'anulacion', originalId: 'm1' });
    const result = obtenerMarcacionesEfectivas([original, anulacion]);
    expect(result).toHaveLength(0);
  });

  it('creación → se incluye como marcación independiente', () => {
    const creacion = marc('a1', 'ajuste', 0, { tipo_ajuste: 'creacion' });
    const result = obtenerMarcacionesEfectivas([creacion]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('creación + original intacta → ambas en el resultado', () => {
    const original = marc('m1', 'entrada', 0);
    const creacion = marc('a1', 'ajuste', 3600, { tipo_ajuste: 'creacion' });
    const result = obtenerMarcacionesEfectivas([original, creacion]);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id).sort()).toEqual(['a1', 'm1'].sort());
  });

  it('múltiples correcciones sobre la misma original → toma la más reciente', () => {
    const original = marc('m1', 'entrada', 0);
    const corr1 = marc('a1', 'ajuste', 100, { tipo_ajuste: 'correccion', originalId: 'm1' });
    const corr2 = marc('a2', 'ajuste', 200, { tipo_ajuste: 'correccion', originalId: 'm1' });
    const result = obtenerMarcacionesEfectivas([original, corr1, corr2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('original sin ajustes + otra anulada → solo la intacta', () => {
    const m1 = marc('m1', 'entrada', 0);
    const m2 = marc('m2', 'salida', 3600);
    const anulacion = marc('a1', 'ajuste', 100, { tipo_ajuste: 'anulacion', originalId: 'm2' });
    const result = obtenerMarcacionesEfectivas([m1, m2, anulacion]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('resultado ordenado por timestamp_utc', () => {
    const m1 = marc('m1', 'entrada', 0);
    const creacion = marc('a1', 'ajuste', -3600, { tipo_ajuste: 'creacion' }); // anterior
    const result = obtenerMarcacionesEfectivas([m1, creacion]);
    expect(result[0].id).toBe('a1');
    expect(result[1].id).toBe('m1');
  });
});
