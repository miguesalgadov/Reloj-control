import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CrearContratoDto {
  @Matches(UUID_RE, { message: 'trabajador_id debe ser un UUID válido' })
  trabajador_id!: string;

  @IsIn(['indefinido', 'plazo_fijo', 'obra_faena', 'parcial', 'aprendizaje'])
  tipo_contrato!: string;

  @IsString()
  @IsNotEmpty()
  cargo!: string;

  @IsDateString()
  fecha_inicio!: string;

  @IsOptional()
  @IsDateString()
  fecha_termino?: string;

  @IsNumber()
  @Min(0.01)
  @Max(60)
  horas_semanales!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sueldo_base?: number;

  @IsOptional()
  @IsIn(['ordinaria', 'parcial', 'excepcional', 'sin_fiscalizacion'])
  tipo_jornada?: string;

  @IsOptional()
  @IsBoolean()
  permite_horas_extras?: boolean;
}
