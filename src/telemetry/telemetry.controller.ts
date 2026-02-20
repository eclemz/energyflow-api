import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceAuthGuard } from './device-auth.guard';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';
import { TelemetryService } from './telemetry.service';

@Controller('telemetry')
export class TelemetryController {
  constructor(private telemetry: TelemetryService) {}

  @UseGuards(DeviceAuthGuard)
  @Post()
  ingest(@Req() req: Request, @Body() dto: IngestTelemetryDto) {
    // @ts-ignore
    const device = req.device;
    return this.telemetry.ingestForDevice(device.id, dto);
  }
}
