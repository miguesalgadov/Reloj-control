import { Module } from '@nestjs/common';
import { CentrosController } from './centros.controller';
import { CentrosService } from './centros.service';
import { CentrosRepository } from './centros.repository';

@Module({
  controllers: [CentrosController],
  providers: [CentrosService, CentrosRepository],
  exports: [CentrosRepository],
})
export class CentrosModule {}
