import { IsOptional, IsString } from 'class-validator';

export class InactivarCentroDto {
  @IsOptional()
  @IsString()
  motivo?: string;
}
