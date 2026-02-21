import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from './auth.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    const tokens = this.authService.generateTokens(user);

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 15,
    });

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    return { message: 'Logged in' };
  }

  @Post('demo')
  async demo(@Res({ passthrough: true }) res: Response) {
    const user = await this.authService.getOrCreateDemoUser();
    const tokens = this.authService.generateTokens(user);

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax', // ✅ important for Vercel -> Render cookies
      maxAge: 1000 * 60 * 15,
    });

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax', // ✅ important for Vercel -> Render cookies
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });

    return { message: 'Logged in (demo)' };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return { message: 'Logged out' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    // user payload: { sub, email, role }
    return {
      id: user.sub,
      email: user.email,
      role: user.role,
    };
  }
}
