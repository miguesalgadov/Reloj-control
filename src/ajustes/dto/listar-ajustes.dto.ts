import { IsDateString, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UUID_RE } from '../../common/validators/uuid';

export class ListarAjustesDto {
  @IsOptional()
  @Matches(UUID_RE)
  trabajador_id?: string;

  @IsOptional()
  @IsEnum(['creacion', 'correccion', 'anulacion'])
  tipo_ajuste?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @Matches(UUID_RE)
  creado_por_id?: string;

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
