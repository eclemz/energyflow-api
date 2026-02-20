import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AlertSeverity, AlertType, Prisma } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import { AlertsService } from '../alerts/alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryGateway } from '../telemetry/telemetry.gateway';
import { ReadingsQueryDto } from './dto/readings-query.dto';

type TelemetryPoint = {
  ts: string;
  solarW?: number;
  loadW?: number;
  gridW?: number;
  soc?: number | null;
  tempC?: number | null;
};
type FleetDeviceRow = Prisma.DeviceGetPayload<{
  select: {
    id: true;
    name: true;
    serial: true;
    location: true;
    timezone: true;

    readings: {
      take: 1;
      orderBy: { ts: 'desc' };
      select: {
        ts: true;
        status: true;
        solarW: true;
        loadW: true;
        gridW: true;
        soc: true;
        tempC: true;
      };
    };

    alerts: {
      where: { acknowledgedAt: null };
      select: { id: true };
    };
  };
}>;

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private telemetryGateway: TelemetryGateway,
    private alertsService: AlertsService,
  ) {}

  private publishTelemetry(deviceId: string, data: any) {
    this.telemetryGateway.broadcastTelemetry(deviceId, data);
  }

  private streams = new Map<string, Subject<TelemetryPoint>>();

  private getStream(deviceId: string) {
    let s = this.streams.get(deviceId);
    if (!s) {
      s = new Subject<TelemetryPoint>();
      this.streams.set(deviceId, s);
    }
    return s;
  }
  private pushToStream(deviceId: string, data: TelemetryPoint) {
    this.getStream(deviceId).next(data);
  }

  streamTelemetry(deviceId: string): Observable<TelemetryPoint> {
    return this.getStream(deviceId).asObservable();
  }

  async getAll() {
    return this.prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        serial: true,
        location: true,
        timezone: true,
        createdAt: true,
      },
    });
  }

  async getFleet() {
    const devices: FleetDeviceRow[] = await this.prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        serial: true,
        location: true,
        timezone: true,

        readings: {
          take: 1,
          orderBy: { ts: 'desc' },
          select: {
            ts: true,
            status: true,
            solarW: true,
            loadW: true,
            gridW: true,
            soc: true,
            tempC: true,
          },
        },

        alerts: {
          where: { acknowledgedAt: null },
          select: { id: true },
        },
      },
    });

    return devices.map((d) => {
      const latest = d.readings[0] ?? null;

      return {
        id: d.id,
        name: d.name,
        serial: d.serial,
        location: d.location,
        timezone: d.timezone,

        lastSeen: latest ? latest.ts.toISOString() : null,
        status: latest ? latest.status : ('NO_DATA' as const),

        solarW: latest?.solarW ?? 0,
        loadW: latest?.loadW ?? 0,
        gridW: latest?.gridW ?? 0,
        soc: latest?.soc ?? null,
        tempC: latest?.tempC ?? null,

        unackedAlerts: d.alerts.length,
      };
    });
  }

  async getSummary(deviceId: string) {
    const latest = await this.prisma.telemetryReading.findFirst({
      where: { deviceId },
      orderBy: { ts: 'desc' },
    });

    const unackedAlerts = await this.prisma.alert.count({
      where: { deviceId, acknowledgedAt: null },
    });

    if (!latest) {
      return {
        deviceId,
        lastSeen: null,
        status: 'NO_DATA',
        solarW: 0,
        loadW: 0,
        gridW: 0,
        batterySoc: null,
        batteryV: null,
        tempC: null,
        unackedAlerts,
      };
    }

    return {
      deviceId,
      lastSeen: latest.ts,
      status: latest.status,
      solarW: latest.solarW,
      loadW: latest.loadW,
      gridW: latest.gridW,
      batterySoc: latest.soc,
      batteryV: latest.batteryV,
      tempC: latest.tempC,
      unackedAlerts,
    };
  }

  async getReadings(deviceId: string, q: ReadingsQueryDto) {
    const now = new Date();

    const to = q.to ? new Date(q.to as any) : now;
    const from = q.from
      ? new Date(q.from as any)
      : new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const limit = q.limit ?? 500;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (from > to) throw new BadRequestException('"from" must be <= "to"');

    const rows = await this.prisma.telemetryReading.findMany({
      where: {
        deviceId,
        ts: { gte: from, lte: to },
      },
      orderBy: { ts: 'asc' },
      take: limit,
      select: {
        ts: true,
        solarW: true,
        loadW: true,
        gridW: true,
        inverterW: true,
        batteryV: true,
        batteryA: true,
        soc: true,
        tempC: true,
        status: true,
      },
    });

    // Format for charts
    return rows.map((r) => ({
      ts: r.ts.toISOString(),
      solarW: r.solarW ?? 0,
      loadW: r.loadW ?? 0,
      gridW: r.gridW ?? 0,
      inverterW: r.inverterW ?? 0,
      soc: r.soc ?? null,
      tempC: r.tempC ?? null,
      batteryV: r.batteryV ?? null,
      batteryA: r.batteryA ?? null,
      status: r.status,
    }));
  }

  async simulateTelemetry(
    deviceId: string,
    minutes = 360,
    intervalSeconds = 60,
  ) {
    // safety limits so you don't generate millions of rows by mistake
    const safeMinutes = Math.min(Math.max(minutes, 10), 7 * 24 * 60); // 10 mins to 7 days
    const safeInterval = Math.min(Math.max(intervalSeconds, 10), 10 * 60); // 10s to 10min

    // ensure device exists
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });
    if (!device) throw new NotFoundException('Device not found');

    const points = Math.floor((safeMinutes * 60) / safeInterval);
    const now = Date.now();
    const start = now - safeMinutes * 60 * 1000;

    // base values
    let soc = 65; // start battery %
    const baseBatteryV = 50.8;

    const rows = Array.from({ length: points }, (_, i) => {
      const t = start + i * safeInterval * 1000;
      const ts = new Date(t);

      // simulate "time of day" effect for solar (rough, but realistic)
      const hour = ts.getHours() + ts.getMinutes() / 60; // 0..24
      const daylightFactor = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)); // peaks ~12pm

      const solarW = Math.round(
        300 + daylightFactor * 2500 + (Math.random() * 120 - 60),
      ); // 300..2800-ish
      const loadW = Math.round(600 + Math.random() * 1400); // 600..2000-ish

      // grid sometimes off
      const gridOff = Math.random() < 0.15; // 15% chance
      const gridW = gridOff ? 0 : Math.round(200 + Math.random() * 900);

      // inverter covers load if grid is off or low
      const inverterW = Math.max(0, loadW - gridW);

      // battery current: charge if solar > inverter load, else discharge
      const netW = solarW - inverterW;
      const batteryA = Number((netW / 50 + (Math.random() * 2 - 1)).toFixed(2)); // rough

      // update soc slowly
      soc += netW > 0 ? 0.02 : -0.03;
      soc = Math.max(5, Math.min(100, soc));
      const socInt = Math.round(soc);

      const tempC = Number(
        (30 + inverterW / 500 + Math.random() * 2).toFixed(1),
      ); // rises with inverter load
      const batteryV = Number(
        (
          baseBatteryV +
          (socInt - 50) * 0.03 +
          (Math.random() * 0.2 - 0.1)
        ).toFixed(2),
      );

      // status logic
      const status = socInt < 20 || tempC > 60 || loadW > 5000 ? 'WARN' : 'OK';

      return {
        deviceId,
        ts,
        solarW,
        loadW,
        gridW,
        inverterW,
        batteryV,
        batteryA,
        soc: socInt,
        tempC,
        status,
        createdAt: ts,
      };
    });

    // insert in chunks (safer)
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);

      await this.prisma.telemetryReading.createMany({
        data: chunk as any,
      });

      // Broadcast the newest point from this chunk (efficient, no spam)
      const last = chunk[chunk.length - 1];
      const payload = {
        ts: last.ts.toISOString(),
        solarW: last.solarW,
        loadW: last.loadW,
        gridW: last.gridW,
        soc: last.soc,
        tempC: last.tempC,
      };

      await this.alertsService.createIfNotSpam({
        deviceId,
        type:
          payload.soc !== null && payload.soc !== undefined && payload.soc < 20
            ? AlertType.LOW_BATTERY
            : payload.tempC !== null &&
                payload.tempC !== undefined &&
                payload.tempC > 60
              ? AlertType.HIGH_TEMP
              : AlertType.WARN_GENERIC,

        message:
          payload.soc !== null && payload.soc !== undefined && payload.soc < 20
            ? `Battery low (${payload.soc}%)`
            : payload.tempC !== null &&
                payload.tempC !== undefined &&
                payload.tempC > 60
              ? `Temperature high (${payload.tempC}°C)`
              : 'Warning condition detected',
        severity: AlertSeverity.WARN,
      });

      this.publishTelemetry(deviceId, payload);
      this.pushToStream(deviceId, payload); // also push to stream for real-time subscribers
    }

    return {
      deviceId,
      minutes: safeMinutes,
      intervalSeconds: safeInterval,
      pointsInserted: rows.length,
    };
  }

  async pushOnePoint(deviceId: string) {
    const latest = await this.prisma.telemetryReading.findFirst({
      where: { deviceId },
      orderBy: { ts: 'desc' },
    });

    if (!latest) {
      throw new NotFoundException('No telemetry yet for this device');
    }

    const payload = {
      ts: latest.ts.toISOString(),
      solarW: latest.solarW ?? 0,
      loadW: latest.loadW ?? 0,
      gridW: latest.gridW ?? 0,
      soc: latest.soc ?? null,
      tempC: latest.tempC ?? null,
    };

    // push to live subscribers
    this.pushToStream(deviceId, payload);
    // optional for socket.io
    this.publishTelemetry(deviceId, payload);

    return { ok: true, deviceId, pushed: payload };
  }

  async getAlerts(deviceId: string, status?: string) {
    const where: any = { deviceId };

    if (status === 'unacked') {
      where.acknowledgedAt = null;
    }

    return this.prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        deviceId: true,
        type: true,
        message: true,
        severity: true,
        createdAt: true,
        acknowledgedAt: true,
      },
    });
  }

  async ackAlert(alertId: string) {
    const updated = await this.prisma.alert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date() },
      select: {
        id: true,
        deviceId: true,
      },
    });

    // notify all dashboards instantly
    this.telemetryGateway.broadcastAlertAck(updated.deviceId, updated.id);

    return { ok: true, alertId: updated.id };
  }

  async getOverview() {
    const devices = await this.prisma.device.findMany({
      select: { id: true },
    });

    const totalDevices = devices.length;

    if (totalDevices === 0) {
      return {
        totalDevices: 0,
        onlineDevices: 0,
        warningDevices: 0,
        unackedAlerts: 0,
      };
    }

    // latest reading per device
    const latestPerDevice = await Promise.all(
      devices.map((d) =>
        this.prisma.telemetryReading.findFirst({
          where: { deviceId: d.id },
          orderBy: { ts: 'desc' },
        }),
      ),
    );

    const onlineDevices = latestPerDevice.filter(Boolean).length;

    const warningDevices = latestPerDevice.filter(
      (r) => r && r.status !== 'OK',
    ).length;

    const unackedAlerts = await this.prisma.alert.count({
      where: { acknowledgedAt: null },
    });

    return {
      totalDevices,
      onlineDevices,
      warningDevices,
      unackedAlerts,
    };
  }
}
