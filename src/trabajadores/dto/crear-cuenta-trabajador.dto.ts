import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CrearCuentaTrabajadorDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password_temporal!: string;
}
