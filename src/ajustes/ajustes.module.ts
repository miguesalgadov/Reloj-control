import { Module } from '@nestjs/common';
import { AjustesController } from './ajustes.controller';
import { AjustesService } from './ajustes.service';
import { AjustesRepository } from './ajustes.repository';

@Module({
  controllers: [AjustesController],
  providers: [AjustesService, AjustesRepository],
})
export class AjustesModule {}
