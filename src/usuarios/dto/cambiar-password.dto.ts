import { IsString, MaxLength, MinLength } from 'class-validator';

export class CambiarPasswordDto {
  @IsString()
  password_actual!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password_nueva!: string;
}
