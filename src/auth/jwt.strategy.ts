import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../types/express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Passport llama a validate() despues de verificar la firma. Lo que
   * retornamos aqui termina en req.user.
   *
   * No hacemos lookup adicional en DB para no agregar latencia a cada
   * request. Si el usuario fue suspendido despues de emitir el token,
   * el token sigue valido hasta su expiracion (8h por defecto). Si esa
   * ventana es muy larga, agregar revocacion via lista de tokens
   * invalidados (Redis) o reducir expiracion.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      rol: payload.rol,
      trabajadorId: payload.trabajadorId,
    };
  }
}
