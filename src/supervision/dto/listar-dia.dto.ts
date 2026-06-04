import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UUID_RE } from '../../common/validators/uuid';

export class ListarDiaDto {
  @IsOptional()
  @Matches(UUID_RE)
  centro_trabajo_id?: string;

  @IsOptional()
  @IsEnum(['presente', 'atraso', 'ausente', 'esperando', 'no_laborable', 'sin_contrato'])
  estado?: string;

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
