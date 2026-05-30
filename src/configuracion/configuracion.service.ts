import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ActualizarConfiguracionJornadaDto } from './dto/actualizar-configuracion-jornada.dto';

@Injectable()
export class ConfiguracionService {
  async actualizarJornada(
    tenantId: string,
    dto: ActualizarConfiguracionJornadaDto,
    db: PoolClient,
  ): Promise<Record<string, unknown>> {
    if (
      dto.duracionMinimaColacionMinutos !== undefined &&
      dto.duracionMaximaColacionMinutos !== undefined &&
      dto.duracionMinimaColacionMinutos > dto.duracionMaximaColacionMinutos
    ) {
      throw new BadRequestException(
        'duracionMinimaColacionMinutos no puede superar duracionMaximaColacionMinutos',
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [tenantId];
    let idx = 2;

    const fieldMap: Record<string, string> = {
      toleranciaAtrasoMinutos: 'tolerancia_atraso_minutos',
      toleranciaSalidaAnticipadaMinutos: 'tolerancia_salida_anticipada_minutos',
      duracionMinimaColacionMinutos: 'duracion_minima_colacion_minutos',
      duracionMaximaColacionMinutos: 'duracion_maxima_colacion_minutos',
      colacionEsImputableJornada: 'colacion_es_imputable_jornada',
      umbralInasistenciaSinMarcacionHoras: 'umbral_inasistencia_sin_marcacion_horas',
      umbralJornadaExtendidaMinutos: 'umbral_jornada_extendida_minutos',
      redondeoHorasExtraMinutos: 'redondeo_horas_extra_minutos',
      redondeoHorasExtraModo: 'redondeo_horas_extra_modo',
      diasLaborables: 'dias_laborables',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      const val = (dto as Record<string, unknown>)[key];
      if (val === undefined) continue;

      if (col === 'dias_laborables') {
        sets.push(`${col} = $${idx}::smallint[]`);
      } else {
        sets.push(`${col} = $${idx}`);
      }
      params.push(val);
      idx++;
    }

    if (sets.length === 0) {
      throw new BadRequestException('Se debe enviar al menos un campo para actualizar.');
    }

    const { rows } = await db.query(
      `UPDATE rc.configuracion_jornada
       SET ${sets.join(', ')}, updated_at = now()
       WHERE tenant_id = $1::uuid
       RETURNING *`,
      params,
    );

    return rows[0] as Record<string, unknown>;
  }
}
