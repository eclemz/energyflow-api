import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AlertsModule } from '../alerts/alerts.module';
import { TelemetryController } from './telemetry.controller';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AlertsModule)],
  controllers: [TelemetryController],
  providers: [TelemetryGateway, TelemetryService],
  exports: [TelemetryGateway, TelemetryService],
})
export class TelemetryModule {}
