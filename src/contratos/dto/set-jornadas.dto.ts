import { ArrayUnique, IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class JornadaDiaDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dia_semana!: number;

  @IsString()
  hora_inicio!: string;

  @IsString()
  hora_termino!: string;

  @IsOptional()
  @IsString()
  colacion_inicio?: string;

  @IsOptional()
  @IsString()
  colacion_termino?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  tolerancia_minutos?: number;
}

export class SetJornadasDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JornadaDiaDto)
  @ArrayUnique((j: JornadaDiaDto) => j.dia_semana)
  jornadas!: JornadaDiaDto[];
}
