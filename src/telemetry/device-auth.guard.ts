import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    const serial = req.header('x-device-serial');
    const apiKey = req.header('x-device-key');

    if (!serial || !apiKey) {
      throw new UnauthorizedException('Missing device credentials');
    }

    const device = await this.prisma.device.findUnique({ where: { serial } });
    if (!device || !device.apiKeyHash) {
      throw new UnauthorizedException('Invalid device');
    }

    const ok = await bcrypt.compare(apiKey, device.apiKeyHash);
    if (!ok) throw new UnauthorizedException('Invalid device key');

    // attach device to request for controller/service
    req.device = device;
    return true;
  }
}
