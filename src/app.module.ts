import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { MarcacionesModule } from './marcaciones/marcaciones.module';
import { HealthModule } from './health/health.module';
import { JornadaModule } from './jornada/jornada.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { CentrosModule } from './centros/centros.module';
import { TrabajadoresModule } from './trabajadores/trabajadores.module';
import { ContratosModule } from './contratos/contratos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      validationOptions: {
        abortEarly: false,        // reporta TODOS los errores de env de una
        allowUnknown: true,        // tolera vars extra (DB_HOST, DB_PORT, etc.)
      },
    }),
    DatabaseModule,
    AuthModule,
    MarcacionesModule,
    HealthModule,
    JornadaModule,
    ConfiguracionModule,
    UsuariosModule,
    CentrosModule,
    TrabajadoresModule,
    ContratosModule,
  ],
})
export class AppModule {}
