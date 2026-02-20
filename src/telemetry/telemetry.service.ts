import { BadRequestException, Injectable } from '@nestjs/common';
import { AlertSeverity, AlertType, DeviceStatus } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';
import { TelemetryGateway } from './telemetry.gateway';

@Injectable()
export class TelemetryService {
  constructor(
    private prisma: PrismaService,
    private alertsService: AlertsService,
    private gateway: TelemetryGateway,
  ) {}

  // return MULTIPLE alerts (battery + temp, etc)
  private computeAlertsFromDto(dto: IngestTelemetryDto): Array<{
    type: AlertType;
    severity: AlertSeverity;
    message: string;
  }> {
    const alerts: Array<{
      type: AlertType;
      severity: AlertSeverity;
      message: string;
    }> = [];

    const soc = dto.soc ?? null;
    const tempC = dto.tempC ?? null;
    const loadW = dto.loadW ?? null;
    const gridW = dto.gridW ?? null;
    const status = dto.status ?? null;

    if (soc !== null && soc < 20) {
      alerts.push({
        type: AlertType.LOW_BATTERY,
        severity: AlertSeverity.WARN,
        message: `Battery low (${soc}%)`,
      });
    }

    if (tempC !== null && tempC > 60) {
      alerts.push({
        type: AlertType.HIGH_TEMP,
        severity: AlertSeverity.CRITICAL,
        message: `Temperature high (${tempC}°C)`,
      });
    }

    if (loadW !== null && loadW > 5000) {
      alerts.push({
        type: AlertType.OVERLOAD,
        severity: AlertSeverity.CRITICAL,
        message: `Load overload (${loadW}W)`,
      });
    }

    if (gridW !== null && gridW === 0 && status && status !== 'OK') {
      alerts.push({
        type: AlertType.GRID_LOSS,
        severity: AlertSeverity.WARN,
        message: `Grid loss detected (status: ${status})`,
      });
    }

    // Optional generic warn only if nothing else triggered
    if (alerts.length === 0 && status && status !== 'OK') {
      alerts.push({
        type: AlertType.WARN_GENERIC,
        severity: AlertSeverity.WARN,
        message: 'Warning condition detected',
      });
    }

    return alerts;
  }

  async ingestForDevice(deviceId: string, dto: IngestTelemetryDto) {
    const ts = dto.ts ? new Date(dto.ts) : new Date();
    if (Number.isNaN(ts.getTime())) {
      throw new BadRequestException('Invalid ts');
    }

    const reading = await this.prisma.telemetryReading.create({
      data: {
        deviceId,
        ts,
        solarW: dto.solarW ?? null,
        loadW: dto.loadW ?? null,
        gridW: dto.gridW ?? null,
        inverterW: dto.inverterW ?? null,
        batteryV: dto.batteryV ?? null,
        batteryA: dto.batteryA ?? null,
        soc: dto.soc ?? null,
        tempC: dto.tempC ?? null,
        status: (dto.status as DeviceStatus) ?? DeviceStatus.OK,
      },
    });

    // telemetry live update (SSE/WS)
    const livePayload = {
      ts: reading.ts.toISOString(),
      solarW: reading.solarW ?? 0,
      loadW: reading.loadW ?? 0,
      gridW: reading.gridW ?? 0,
      soc: reading.soc ?? null,
      tempC: reading.tempC ?? null,
      status: reading.status,
    };

    this.gateway.broadcastTelemetry(deviceId, livePayload);

    // create ALL alerts; AlertsService already broadcasts them
    const alerts = this.computeAlertsFromDto(dto);
    for (const a of alerts) {
      await this.alertsService.createIfNotSpam({
        deviceId,
        type: a.type,
        message: a.message,
        severity: a.severity,
      });
    }

    return reading;
  }
}
