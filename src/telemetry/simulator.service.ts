import { Injectable } from '@nestjs/common';
import { AlertSeverity, AlertType } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryGateway } from './telemetry.gateway';

type SimConfig = {
  tickMs: number; // e.g. 2000
  baseLoadW: number; // e.g. 350
  loadNoiseW: number; // e.g. 80
  solarPeakW: number; // e.g. 1200
  batteryKwh: number; // e.g. 2.4  (battery capacity)
  chargeEff: number; // e.g. 0.92
  dischargeEff: number; // e.g. 0.92
  faultChancePerTick: number; // e.g. 0.01
  alertChancePerTick: number; // e.g. 0.02
  dayStartHour: number; // e.g. 6
  dayEndHour: number; // e.g. 18
};

type SimState = {
  timer?: NodeJS.Timeout;
  soc: number; // 0..100
  tempC: number;
  lastFaultAt?: number;
  running: boolean;
  // aging
  effectiveBatteryKwh: number; // starts at cfg.batteryKwh, slowly decreases
  throughputWh: number; // energy processed over time
  startedAtMs: number; // for calendar aging

  // anti-flap state tracking
  lowBatteryActive: boolean;
  highTempActive: boolean;

  // optional cooldowns (for random faults)
  lastAlertAtByType: Partial<Record<AlertType, number>>;
};

const defaultConfig: SimConfig = {
  tickMs: 2000,
  baseLoadW: 350,
  loadNoiseW: 80,
  solarPeakW: 1200,
  batteryKwh: 2.4,
  chargeEff: 0.92,
  dischargeEff: 0.92,
  faultChancePerTick: 0.01,
  alertChancePerTick: 0.02,
  dayStartHour: 6,
  dayEndHour: 18,
};

type SimAlert = {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
};

@Injectable()
export class SimulatorService {
  private sims = new Map<string, { cfg: SimConfig; st: SimState }>();
  private LOW_BATT_ON = 20;
  private LOW_BATT_OFF = 23; // hysteresis exit higher than enter

  private HIGH_TEMP_ON = 65;
  private HIGH_TEMP_OFF = 60; // exit lower than enter

  constructor(
    private prisma: PrismaService,
    private gateway: TelemetryGateway,
    private alertsService: AlertsService,
  ) {}

  async start(deviceId: string, partial?: Partial<SimConfig>) {
    const existing = this.sims.get(deviceId);
    if (existing?.st.running) return { ok: true, message: 'Already running' };

    // ensure device exists
    await this.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });

    const cfg = { ...defaultConfig, ...(partial ?? {}) };
    const st: SimState = {
      soc: existing?.st.soc ?? 78,
      tempC: existing?.st.tempC ?? 34,
      running: true,
      effectiveBatteryKwh: existing?.st.effectiveBatteryKwh ?? cfg.batteryKwh,
      throughputWh: existing?.st.throughputWh ?? 0,
      startedAtMs: existing?.st.startedAtMs ?? Date.now(),
      lowBatteryActive: existing?.st.lowBatteryActive ?? false,
      highTempActive: existing?.st.highTempActive ?? false,
      lastAlertAtByType: existing?.st.lastAlertAtByType ?? {},
    };

    const tick = async () => {
      if (!st.running) return;
      await this.tick(deviceId);
    };

    st.timer = setInterval(() => tick().catch(() => {}), cfg.tickMs);
    this.sims.set(deviceId, { cfg, st });

    // do an immediate tick so UI updates instantly
    await this.tick(deviceId);

    return { ok: true, message: 'Simulation started' };
  }

  stop(deviceId: string) {
    const sim = this.sims.get(deviceId);
    if (!sim) return { ok: true, message: 'Not running' };
    sim.st.running = false;
    if (sim.st.timer) clearInterval(sim.st.timer);
    this.sims.delete(deviceId);
    return { ok: true, message: 'Simulation stopped' };
  }

  async once(deviceId: string, partial?: Partial<SimConfig>) {
    const sim = this.sims.get(deviceId);
    if (!sim) {
      // create a temporary state if not running
      this.sims.set(deviceId, {
        cfg: { ...defaultConfig, ...(partial ?? {}) },
        st: {
          soc: 78,
          tempC: 34,
          running: false,
          effectiveBatteryKwh: partial?.batteryKwh ?? defaultConfig.batteryKwh,
          throughputWh: 0,
          startedAtMs: Date.now(),
          lowBatteryActive: false,
          highTempActive: false,
          lastAlertAtByType: {},
        },
      });
    } else if (partial) {
      sim.cfg = { ...sim.cfg, ...partial };
    }

    await this.tick(deviceId);
    return { ok: true };
  }

  private nowInLocal(deviceTimezone?: string | null) {
    // keep it simple: use server time. If you later want timezone accuracy,
    // store tz and use Intl.DateTimeFormat with timeZone.
    return new Date();
  }

  // --- Seasonal solar helpers (simple + believable)
  private dayOfYear(d: Date) {
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d.getTime() - start.getTime();
    return Math.floor(diff / 86400000);
  }

  // returns ~[-1..+1], where +1 ~ summer, -1 ~ winter (northern hemisphere-ish)
  private seasonalFactor(d: Date) {
    // peak around June (day ~172), trough around Dec (day ~355)
    const doy = this.dayOfYear(d);
    return Math.sin(((2 * Math.PI) / 365) * (doy - 172));
  }

  // day length hours: winter ~10, summer ~14 (tweakable)
  private seasonalDayLengthHours(d: Date, base = 12, swing = 2) {
    const s = this.seasonalFactor(d); // -1..+1
    return base + swing * s;
  }

  private seasonalSolarPeak(cfg: SimConfig, d: Date, swingPct = 0.25) {
    // winter reduces peak, summer increases peak
    const s = this.seasonalFactor(d); // -1..+1
    const mul = 1 + swingPct * s; // e.g. ±25%
    return Math.max(0, Math.round(cfg.solarPeakW * mul));
  }

  private solarCurveW(cfg: SimConfig, now: Date) {
    const h = now.getHours() + now.getMinutes() / 60;

    // Season-adjusted day window centered around noon
    const dayLen = this.seasonalDayLengthHours(now, 12, 2); // base=12h, swing=±2h
    const half = dayLen / 2;

    const noon = 12; // simple; can later use timezone/lat
    const start = noon - half;
    const end = noon + half;

    if (h < start || h > end) return 0;

    // Map [start..end] -> [0..PI]
    const x = ((h - start) / (end - start)) * Math.PI;

    // Sin curve: sunrise=0, noon=1, sunset=0
    const base = Math.sin(x);

    // Season-adjusted peak
    const peakW = this.seasonalSolarPeak(cfg, now, 0.25);

    // clouds: small randomness
    const clouds = 0.85 + Math.random() * 0.25;

    return Math.max(0, Math.round(peakW * base * clouds));
  }

  private applyBatteryAging(cfg: SimConfig, st: SimState, battW: number) {
    // 1) throughput aging: accumulate absolute battery power
    const dtHours = cfg.tickMs / 1000 / 60 / 60;
    const deltaWh = Math.abs(battW) * dtHours;
    st.throughputWh += deltaWh;

    // assume 1 “full cycle” ~ 2x capacity throughput (charge+discharge)
    const capWh = cfg.batteryKwh * 1000;
    const equivalentCycles = st.throughputWh / (2 * capWh);

    // 2) calendar aging: tiny fade over time even if idle
    const ageDays = (Date.now() - st.startedAtMs) / 86400000;

    // tweak these coefficients to taste:
    const cycleFadePerCycle = 0.0015; // 0.15% per cycle (demo-friendly)
    const calendarFadePerDay = 0.00002; // 0.002% per day

    const fade =
      equivalentCycles * cycleFadePerCycle + ageDays * calendarFadePerDay;

    // clamp total fade to max 30% (don’t kill it completely)
    const maxFade = 0.3;
    const fadeClamped = Math.min(maxFade, Math.max(0, fade));

    const nextEffective = cfg.batteryKwh * (1 - fadeClamped);

    // never drop below 60% of original in demo (optional)
    st.effectiveBatteryKwh = Math.max(cfg.batteryKwh * 0.6, nextEffective);
  }

  private clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  private randAround(base: number, noise: number) {
    return Math.round(base + (Math.random() * 2 - 1) * noise);
  }
  private cooldownOk(st: SimState, type: AlertType, cooldownMs: number) {
    const now = Date.now();
    const last = st.lastAlertAtByType[type] ?? 0;
    if (now - last < cooldownMs) return false;
    st.lastAlertAtByType[type] = now;
    return true;
  }

  private async raiseAlertOnce(
    deviceId: string,
    st: SimState,
    input: {
      type: AlertType;
      severity: AlertSeverity;
      message: string;
      cooldownMs?: number;
    },
  ) {
    const cd = input.cooldownMs ?? 15_000;
    if (!this.cooldownOk(st, input.type, cd)) return;

    // IMPORTANT: keep message stable to avoid duplicates (don’t include % that changes)
    await this.alertsService.createIfNotSpam({
      deviceId,
      type: input.type,
      severity: input.severity,
      message: input.message,
    });
  }

  private async recoveryAlertOnce(
    deviceId: string,
    st: SimState,
    input: {
      type: AlertType;
      message: string;
      cooldownMs?: number;
    },
  ) {
    const cd = input.cooldownMs ?? 15_000;
    if (!this.cooldownOk(st, input.type, cd)) return;

    await this.alertsService.createIfNotSpam({
      deviceId,
      type: input.type,
      severity: AlertSeverity.INFO,
      message: input.message,
    });
  }

  private async tick(deviceId: string) {
    const sim = this.sims.get(deviceId);
    if (!sim) return;

    const { cfg, st } = sim;

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, timezone: true, name: true },
    });

    const now = this.nowInLocal(device?.timezone);
    const ts = now.toISOString();

    // --- Solar + Load
    const solarW = this.solarCurveW(cfg, now);
    const loadW = this.clamp(
      this.randAround(cfg.baseLoadW, cfg.loadNoiseW),
      80,
      2000,
    );

    // --- Grid logic (simple)
    // if solar < load, assume grid helps a bit (or battery covers it)
    const deficit = loadW - solarW;
    const gridW = deficit > 0 ? Math.round(deficit * 0.25) : 0;

    // --- Battery drain/charge simulation
    // Net battery power = load - solar - grid
    const battW = loadW - solarW - gridW; // positive means discharging
    const dtHours = cfg.tickMs / 1000 / 60 / 60;

    this.applyBatteryAging(cfg, st, battW);
    const battWh = st.effectiveBatteryKwh * 1000;
    const socWh = (st.soc / 100) * battWh;

    let nextSocWh = socWh;

    if (battW > 0) {
      // discharging
      const usedWh = (battW * dtHours) / cfg.dischargeEff;
      nextSocWh = socWh - usedWh;
    } else {
      // charging
      const gainedWh = -battW * dtHours * cfg.chargeEff;
      nextSocWh = socWh + gainedWh;
    }

    nextSocWh = this.clamp(nextSocWh, 0, battWh);
    st.soc = Math.round((nextSocWh / battWh) * 100);

    // --- Temperature (simple)
    // rises slightly with load, cools slightly otherwise
    const tempDelta = (loadW / 2000) * 0.6 - 0.12 + (Math.random() * 0.2 - 0.1);
    st.tempC = this.clamp(st.tempC + tempDelta, 20, 85);

    // --- Random fault injection
    const faults: SimAlert[] = [];

    if (Math.random() < cfg.faultChancePerTick) {
      const r = Math.random();
      if (r < 0.33) {
        faults.push({
          type: AlertType.OVERLOAD,
          severity: AlertSeverity.CRITICAL,
          message: 'Inverter fault detected.',
        });
      } else if (r < 0.66) {
        faults.push({
          type: AlertType.OVERLOAD,
          severity: AlertSeverity.CRITICAL,
          message: 'Grid fluctuation detected.',
        });
      } else {
        faults.push({
          type: AlertType.WARN_GENERIC,
          severity: AlertSeverity.INFO,
          message: 'Temporary sensor noise.',
        });
      }
      st.lastFaultAt = Date.now();
    }

    // threshold-based faults with simple hysteresis to avoid spamming when SOC is around the threshold. Hysteresis + Recovery (NO SPAM)
    if (!st.lowBatteryActive && st.soc <= this.LOW_BATT_ON) {
      st.lowBatteryActive = true;
      await this.raiseAlertOnce(deviceId, st, {
        type: AlertType.LOW_BATTERY,
        severity: AlertSeverity.WARN,
        message: 'Battery low.',
        cooldownMs: 30_000,
      });
    }

    if (st.lowBatteryActive && st.soc >= this.LOW_BATT_OFF) {
      st.lowBatteryActive = false;
      await this.recoveryAlertOnce(deviceId, st, {
        type: AlertType.LOW_BATTERY,
        message: 'Battery recovered.',
        cooldownMs: 30_000,
      });
    }

    if (!st.highTempActive && st.tempC >= this.HIGH_TEMP_ON) {
      st.highTempActive = true;
      await this.raiseAlertOnce(deviceId, st, {
        type: AlertType.HIGH_TEMP,
        severity: AlertSeverity.CRITICAL,
        message: 'Device temperature is high.',
        cooldownMs: 30_000,
      });
    }

    if (st.highTempActive && st.tempC <= this.HIGH_TEMP_OFF) {
      st.highTempActive = false;
      await this.recoveryAlertOnce(deviceId, st, {
        type: AlertType.HIGH_TEMP,
        message: 'Temperature recovered.',
        cooldownMs: 30_000,
      });
    }

    // --- Persist telemetry
    // adjust field names to match your prisma model (TelemetryReading)
    const reading = await this.prisma.telemetryReading.create({
      data: {
        device: { connect: { id: deviceId } },
        ts,
        solarW,
        loadW,
        gridW,
        soc: st.soc,
        tempC: Math.round(st.tempC * 10) / 10,
        status: faults.some((f) => f.severity === AlertSeverity.CRITICAL)
          ? 'FAULT'
          : 'OK',
      },
    });

    // --- Emit live telemetry to fleet + device
    this.gateway.emitTelemetry(deviceId, {
      ts,
      solarW,
      loadW,
      gridW,
      soc: st.soc,
      tempC: reading.tempC,
      status: reading.status,
    });

    // --- Fake alert generator
    // Create alerts for faults OR randomly (demo sparkle)
    // --- Alerts (deduped + broadcasted by AlertsService)
    if (faults.length) {
      for (const f of faults) {
        await this.alertsService.createIfNotSpam({
          deviceId,
          type: f.type,
          severity: f.severity,
          message: f.message,
        });
      }
    } else if (Math.random() < cfg.alertChancePerTick) {
      await this.raiseAlertOnce(deviceId, st, {
        type: AlertType.WARN_GENERIC,
        severity: AlertSeverity.INFO,
        message: 'Background health check completed.',
        cooldownMs: 45_000,
      });
    }
  }
}
