import { IsEnum, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';

export type TipoMarcacion =
  | 'entrada'
  | 'salida'
  | 'inicio_colacion'
  | 'fin_colacion';

export type FuenteMarcacion = 'web' | 'movil';

export class CrearMarcacionDto {
  @IsEnum(['entrada', 'salida', 'inicio_colacion', 'fin_colacion'])
  tipo!: TipoMarcacion;

  @IsEnum(['web', 'movil'])
  fuente!: FuenteMarcacion;

  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'centroTrabajoId must be a UUID',
  })
  centroTrabajoId!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  precisionMetros?: number;
}
