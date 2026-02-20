import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { AlertSeverity, AlertType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryGateway } from '../telemetry/telemetry.gateway';

@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TelemetryGateway))
    private telemetryGateway: TelemetryGateway,
  ) {}

  list(params: { deviceId?: string; unacked?: boolean }) {
    const where: any = {};
    if (params.deviceId) where.deviceId = params.deviceId;
    if (params.unacked) where.acknowledgedAt = null;

    return this.prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        deviceId: true,
        type: true,
        message: true,
        severity: true,
        ts: true,
        createdAt: true,
        acknowledgedAt: true,
      },
    });
  }

  async ack(alertId: string) {
    const updated = await this.prisma.alert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date() },
    });

    // BROADCAST ACK TO ALL DASHBOARDS
    this.telemetryGateway.server.emit(`device:${updated.deviceId}:alert:ack`, {
      id: updated.id,
      deviceId: updated.deviceId,
    });

    return { id: updated.id, acknowledgedAt: updated.acknowledgedAt };
  }

  async createIfNotSpam(input: {
    deviceId: string;
    type: AlertType;
    message: string;
    severity: AlertSeverity;
  }) {
    const since = new Date(Date.now() - 2 * 60 * 1000);

    const recent = await this.prisma.alert.findFirst({
      where: {
        deviceId: input.deviceId,
        type: input.type,
        message: input.message,
        createdAt: { gte: since },
        acknowledgedAt: null,
      },
    });

    if (recent) {
      // If you want UI to show duplicate alerts instantly too, uncomment:
      // this.telemetryGateway.broadcastAlert(input.deviceId, recent);
      return { ok: true, skipped: true, alertId: recent.id };
    }

    const created = await this.prisma.alert.create({
      data: {
        deviceId: input.deviceId,
        type: input.type,
        message: input.message,
        severity: input.severity,
        ts: new Date(),
      },
    });

    console.log('✅ alert created', created.id, created.type);
    this.telemetryGateway.broadcastAlert(input.deviceId, created);

    return { ok: true, skipped: false, alertId: created.id };
  }
}
