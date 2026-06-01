import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class DesvincularTrabajadorDto {
  @IsOptional()
  @IsDateString()
  fecha_termino?: string;

  @IsString()
  @MinLength(20)
  motivo!: string;
}
