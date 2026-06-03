import { IsArray, IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const TIPOS_ALERTA = [
  'inasistencia_presunta',
  'fuera_geocerca',
  'atraso_recurrente',
  'colacion_no_marcada',
] as const;

export type TipoAlerta = typeof TIPOS_ALERTA[number];

export class ListarAlertasDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @IsEnum(TIPOS_ALERTA, { each: true })
  tipo?: TipoAlerta[];

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
