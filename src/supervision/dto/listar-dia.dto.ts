import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListarDiaDto {
  @IsOptional()
  @IsUUID('4')
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
