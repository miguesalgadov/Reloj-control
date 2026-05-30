import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

export interface TestApp {
  app: INestApplication;
  httpServer: ReturnType<INestApplication['getHttpServer']>;
}

// Replica la configuracion de src/main.ts para que el comportamiento del test
// sea identico al de produccion (mismo pipe, mismo prefix).
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');

  await app.init();

  return { app, httpServer: app.getHttpServer() };
}
