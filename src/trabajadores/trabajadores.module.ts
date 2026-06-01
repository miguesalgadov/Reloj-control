import { Module } from '@nestjs/common';
import { TrabajadoresController } from './trabajadores.controller';
import { TrabajadoresService } from './trabajadores.service';
import { TrabajadoresRepository } from './trabajadores.repository';

@Module({
  controllers: [TrabajadoresController],
  providers: [TrabajadoresService, TrabajadoresRepository],
  exports: [TrabajadoresRepository],
})
export class TrabajadoresModule {}
