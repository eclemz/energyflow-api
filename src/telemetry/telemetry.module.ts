import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AlertsModule } from '../alerts/alerts.module';

import { SimulatorController } from './simulator.controller';
import { SimulatorService } from './simulator.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AlertsModule)],
  controllers: [TelemetryController, SimulatorController],
  providers: [TelemetryService, TelemetryGateway, SimulatorService],
  exports: [TelemetryGateway],
})
export class TelemetryModule {}
