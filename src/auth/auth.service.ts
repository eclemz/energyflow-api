import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}
  async getOrCreateDemoUser() {
    if (process.env.DEMO_LOGIN_ENABLED === 'false') {
      // you can remove this check if you don't care
      throw new Error('Demo login disabled');
    }

    const email = process.env.DEMO_USER_EMAIL ?? 'demo@energyflow.app';

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) return existing;

    // create demo user once
    const passwordHash = await bcrypt.hash('demo-not-used', 10);

    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: 'Demo User',
        role: Role.VIEWER,
      },
    });
  }
  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return user;
  }

  generateTokens(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwt.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}
