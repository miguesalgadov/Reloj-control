import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class FiltrosReporteDto {
  @IsOptional()
  @IsUUID('4')
  trabajador_id?: string;

  @IsOptional()
  @IsUUID('4')
  centro_trabajo_id?: string;

  @IsOptional()
  @IsEnum(['json', 'xlsx'])
  formato?: 'json' | 'xlsx' = 'json';
}
