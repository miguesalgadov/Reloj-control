import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ListarTrabajadoresDto {
  @IsOptional()
  @IsIn(['activo', 'licencia', 'vacaciones', 'desvinculado'])
  estado?: string;

  @IsOptional()
  @Matches(UUID_RE, { message: 'centro_trabajo_id debe ser un UUID válido' })
  centro_trabajo_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
