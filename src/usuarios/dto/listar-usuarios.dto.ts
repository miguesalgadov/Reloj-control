import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListarUsuariosDto {
  @IsOptional()
  @IsIn(['activo', 'suspendido', 'bloqueado'])
  estado?: string;

  @IsOptional()
  @IsIn(['admin_empresa', 'supervisor', 'trabajador'])
  rol?: string;

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
