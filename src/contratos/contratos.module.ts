import { Module } from '@nestjs/common';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { ContratosRepository } from './contratos.repository';

@Module({
  controllers: [ContratosController],
  providers: [ContratosService, ContratosRepository],
  exports: [ContratosRepository],
})
export class ContratosModule {}
