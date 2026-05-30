import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService, LoginResult } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResult> {
    const ip = req.ip ?? null;
    const userAgent = req.headers['user-agent'] ?? null;
    return this.auth.login(dto.email, dto.password, ip, userAgent);
  }
}
