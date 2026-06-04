import {
  IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { UUID_RE } from '../../common/validators/uuid';

export class CrearAjusteDto {
  @IsEnum(['creacion', 'correccion', 'anulacion'])
  tipo_ajuste!: 'creacion' | 'correccion' | 'anulacion';

  @Matches(UUID_RE)
  trabajador_id!: string;

  @IsString()
  @MinLength(30, { message: 'El motivo debe tener al menos 30 caracteres descriptivos.' })
  @MaxLength(500)
  motivo!: string;

  @IsOptional()
  @IsBoolean()
  confirmacion_mes_cerrado?: boolean = false;

  // Solo para creacion
  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsEnum(['entrada', 'salida', 'inicio_colacion', 'fin_colacion'])
  tipo_marcacion?: string;

  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsDateString({}, { message: 'timestamp_local debe ser una fecha ISO válida (ej: 2026-06-01T08:07:00).' })
  timestamp_local?: string;

  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @ValidateIf(o => o.tipo_ajuste === 'creacion')
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  // Solo para correccion y anulacion
  @ValidateIf(o => o.tipo_ajuste === 'correccion' || o.tipo_ajuste === 'anulacion')
  @Matches(UUID_RE)
  marcacion_original_id?: string;

  // Solo para correccion
  @ValidateIf(o => o.tipo_ajuste === 'correccion')
  @IsDateString()
  timestamp_local_corregido?: string;
}
