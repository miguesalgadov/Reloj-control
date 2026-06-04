import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ParamsReporteDto {
  @Type(() => Number)
  @IsInt()
  @Min(2024)
  @Max(2099)
  año!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes!: number;
}
