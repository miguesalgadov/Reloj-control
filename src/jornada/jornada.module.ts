import { Module } from '@nestjs/common';
import { JornadaController } from './jornada.controller';
import { JornadaService } from './jornada.service';
import { JornadaRepository } from './jornada.repository';

@Module({
  controllers: [JornadaController],
  providers: [JornadaService, JornadaRepository],
  exports: [JornadaService],
})
export class JornadaModule {}
