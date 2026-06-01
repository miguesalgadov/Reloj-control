import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ActualizarContratoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cargo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sueldo_base?: number;

  @IsOptional()
  @IsBoolean()
  permite_horas_extras?: boolean;

  @IsOptional()
  @IsDateString()
  fecha_termino?: string;
}
