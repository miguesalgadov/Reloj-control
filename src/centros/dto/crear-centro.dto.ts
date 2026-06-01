import { IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CrearCentroDto {
  @IsString()
  @MinLength(1)
  nombre!: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsString()
  @MinLength(1)
  direccion!: string;

  @IsString()
  @MinLength(1)
  comuna!: string;

  @IsString()
  @MinLength(1)
  region!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud!: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  radio_metros?: number;
}
