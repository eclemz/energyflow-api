import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [TelemetryModule, AlertsModule],
  controllers: [DevicesController],
  providers: [DevicesService, PrismaService],
})
export class DevicesModule {}
