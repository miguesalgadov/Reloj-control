import { IsString, MinLength } from 'class-validator';

export class SuspenderUsuarioDto {
  @IsString()
  @MinLength(20)
  motivo!: string;
}
