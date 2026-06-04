import type { MarcacionEvaluable } from '../types';

/**
 * Dado el set completo de marcaciones de un trabajador en un día
 * (originales + ajustes), devuelve solo las marcaciones efectivas
 * según las reglas del §6.4 del Paso E:
 *
 * 1. Correcciones (tipo='ajuste', datos_ajuste.tipo_ajuste='correccion'):
 *    reemplazan a la marcación original apuntada.
 * 2. Anulaciones: eliminan la marcación original.
 * 3. Creaciones: se incluyen como marcaciones independientes.
 *
 * La función es pura: no modifica el array de entrada.
 */
export interface MarcacionConDatos extends MarcacionEvaluable {
  marcacionOriginalId?: string | null;
  datosAjuste?: {
    tipo_ajuste?: 'creacion' | 'correccion' | 'anulacion';
  } | null;
}

export function obtenerMarcacionesEfectivas(
  marcaciones: MarcacionConDatos[],
): MarcacionEvaluable[] {
  const originales = marcaciones.filter(m => m.tipo !== 'ajuste');
  const ajustes = marcaciones.filter(m => m.tipo === 'ajuste');

  // Indexar ajustes por marcacion_original_id (para acceso O(1))
  const correcciones = new Map<string, MarcacionConDatos>();
  const anuladas = new Set<string>();

  for (const a of ajustes) {
    const tipoAjuste = a.datosAjuste?.tipo_ajuste;
    const originalId = a.marcacionOriginalId;

    if (!originalId) continue;

    if (tipoAjuste === 'anulacion') {
      anuladas.add(originalId);
    } else if (tipoAjuste === 'correccion') {
      // Mantener la corrección más reciente (marcaciones vienen ordenadas por timestamp)
      const existente = correcciones.get(originalId);
      if (!existente || a.timestampUtc > existente.timestampUtc) {
        correcciones.set(originalId, a);
      }
    }
  }

  const efectivas: MarcacionEvaluable[] = [];

  // Procesar originales
  for (const orig of originales) {
    if (anuladas.has(orig.id)) continue;          // anulada → ignorar
    const correccion = correcciones.get(orig.id);
    if (correccion) {
      // La corrección hereda el tipo de la original (que puede ser 'entrada', 'salida', etc.)
      // para que el evaluador la encuentre al filtrar por tipo.
      efectivas.push({ ...correccion, tipo: orig.tipo });
    } else {
      efectivas.push(orig);                        // sin ajuste → usar original
    }
  }

  // Agregar creaciones independientes
  for (const a of ajustes) {
    if (a.datosAjuste?.tipo_ajuste === 'creacion') {
      efectivas.push(a);
    }
  }

  return efectivas.sort((x, y) => x.timestampUtc.getTime() - y.timestampUtc.getTime());
}
