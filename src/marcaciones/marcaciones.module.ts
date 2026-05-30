import { Module } from '@nestjs/common';
import { MarcacionesController } from './marcaciones.controller';
import { MarcacionesService } from './marcaciones.service';

@Module({
  controllers: [MarcacionesController],
  providers: [MarcacionesService],
})
export class MarcacionesModule {}
