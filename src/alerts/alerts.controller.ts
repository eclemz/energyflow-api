import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AlertsService } from './alerts.service';

@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  // GET /alerts?deviceId=...&unacked=true
  @Get()
  list(
    @Query('deviceId') deviceId?: string,
    @Query('unacked') unacked?: string,
  ) {
    return this.alerts.list({ deviceId, unacked: unacked === 'true' });
  }

  // POST /alerts/:id/ack
  @Post(':id/ack')
  async ack(@Param('id') id: string) {
    const updated = await this.alerts.ack(id);
    return { ok: true, alertId: updated.id };
  }
}
