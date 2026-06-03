import { Module } from '@nestjs/common';
import { SupervisionController } from './supervision.controller';
import { SupervisionService } from './supervision.service';
import { SupervisionRepository } from './supervision.repository';
import { JornadaModule } from '../jornada/jornada.module';

@Module({
  imports: [JornadaModule],
  controllers: [SupervisionController],
  providers: [SupervisionService, SupervisionRepository],
})
export class SupervisionModule {}
