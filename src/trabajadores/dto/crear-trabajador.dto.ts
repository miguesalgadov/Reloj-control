import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CuentaDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password_temporal!: string;
}

export class CrearTrabajadorDto {
  @Matches(/^\d{7,8}-[\dkK]$/, { message: 'RUT inválido. Formato esperado: 12345678-9' })
  rut!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nombres!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  apellido_paterno!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido_materno?: string;

  @IsOptional()
  @IsDateString()
  fecha_nacimiento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nacionalidad?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'centro_trabajo_id debe ser un UUID válido',
  })
  centro_trabajo_id?: string;

  @IsDateString()
  fecha_ingreso!: string;

  @IsOptional()
  @IsBoolean()
  crear_cuenta?: boolean;

  @ValidateIf((o: CrearTrabajadorDto) => o.crear_cuenta === true)
  @ValidateNested()
  @Type(() => CuentaDto)
  cuenta?: CuentaDto;
}
