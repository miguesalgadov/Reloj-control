import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsArray,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';

export class ActualizarConfiguracionJornadaDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  toleranciaAtrasoMinutos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  toleranciaSalidaAnticipadaMinutos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  duracionMinimaColacionMinutos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  duracionMaximaColacionMinutos?: number;

  @IsOptional()
  @IsBoolean()
  colacionEsImputableJornada?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  umbralInasistenciaSinMarcacionHoras?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  umbralJornadaExtendidaMinutos?: number;

  @IsOptional()
  @IsIn([1, 5, 10, 15, 30, 60])
  redondeoHorasExtraMinutos?: number;

  @IsOptional()
  @IsIn(['abajo', 'arriba', 'cercano'])
  redondeoHorasExtraModo?: 'abajo' | 'arriba' | 'cercano';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  diasLaborables?: number[];
}
