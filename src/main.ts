import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Confiamos en X-Forwarded-* del reverse proxy (Nginx/ALB) en produccion.
    bodyParser: true,
  });

  // Para que req.ip funcione bien tras reverse proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,             // hace JSON -> instancia de DTO (con tipos)
      whitelist: true,             // ignora propiedades no declaradas en el DTO
      forbidNonWhitelisted: true,  // o falla si las hay (anti-trojan-fields)
    }),
  );

  app.enableCors({
    origin: config.get<string>('FRONTEND_URL', 'http://localhost:3001'),
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // Graceful shutdown: cierra el pool de DB cuando llega SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);
  Logger.log(`API escuchando en http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fallo al iniciar la app', err);
  process.exit(1);
});
