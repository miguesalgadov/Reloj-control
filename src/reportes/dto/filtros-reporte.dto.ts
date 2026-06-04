import { IsEnum, IsOptional, Matches } from 'class-validator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FiltrosReporteDto {
  @IsOptional()
  @Matches(UUID_RE, { message: 'trabajador_id debe ser un UUID válido' })
  trabajador_id?: string;

  @IsOptional()
  @Matches(UUID_RE, { message: 'centro_trabajo_id debe ser un UUID válido' })
  centro_trabajo_id?: string;

  @IsOptional()
  @IsEnum(['json', 'xlsx'])
  formato?: 'json' | 'xlsx' = 'json';
}
