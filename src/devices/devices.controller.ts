import { Controller, Get, Param, Post, Query, Sse } from '@nestjs/common';
import { interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { DevicesService } from './devices.service';
import { ReadingsQueryDto } from './dto/readings-query.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // GET /devices/overview
  @Get('overview')
  getOverview() {
    return this.devicesService.getOverview();
  }

  // GET /devices
  @Get()
  getAll() {
    return this.devicesService.getAll();
  }

  // GET /devices/fleet
  @Get('fleet')
  getFleet() {
    return this.devicesService.getFleet();
  }

  // SSE: GET /devices/:id/stream
  @Sse(':id/stream')
  stream(@Param('id') id: string) {
    const telemetry$ = this.devicesService.streamTelemetry(id);

    // heartbeat so browser doesn't drop the SSE connection
    const ping$ = interval(15_000).pipe(
      map(() => ({ type: 'ping', ts: new Date().toISOString() })),
    );

    return merge(telemetry$, ping$).pipe(
      map((data) => ({
        data, // Nest SSE wrapper
      })),
    );
  }

  // GET /devices/:id/summary
  @Get(':id/summary')
  getSummary(@Param('id') id: string) {
    return this.devicesService.getSummary(id);
  }

  // GET /devices/:id/readings
  @Get(':id/readings')
  getReadings(@Param('id') id: string, @Query() q: ReadingsQueryDto) {
    return this.devicesService.getReadings(id, q);
  }

  // GET /devices/:id/alerts?status=unacked
  @Get(':id/alerts')
  getAlerts(@Param('id') id: string, @Query('status') status?: string) {
    return this.devicesService.getAlerts(id, status);
  }

  // POST /alerts/:alertId/ack
  @Post('/alerts/:alertId/ack')
  ackAlert(@Param('alertId') alertId: string) {
    return this.devicesService.ackAlert(alertId);
  }

  // POST /devices/:id/simulate
  @Post(':id/simulate')
  simulate(@Param('id') id: string) {
    return this.devicesService.simulateTelemetry(id);
  }

  // POST /devices/:id/push (dev helper)
  @Post(':id/push')
  pushOne(@Param('id') id: string) {
    return this.devicesService.pushOnePoint(id);
  }
}
