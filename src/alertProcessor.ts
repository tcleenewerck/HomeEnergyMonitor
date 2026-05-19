import type { Alert } from "./alerts.js";
import type { AlertSender } from "./alertSender.js";
import type { MonitorConfig } from "./config.js";
import { isWithinTimeSlotSchedule } from "./timeslots.js";

export type AlertProcessorState = {
  lastAlertAt: Map<string, number>;
  activeOnceAlertKeys: Set<string>;
};

export function createAlertProcessorState(): AlertProcessorState {
  return {
    lastAlertAt: new Map<string, number>(),
    activeOnceAlertKeys: new Set<string>()
  };
}

type ProcessAlertsOptions = {
  clearMissingAlerts?: boolean;
};

export class AlertProcessor {
  constructor(
    private readonly config: MonitorConfig,
    private readonly sender: AlertSender,
    private readonly state = createAlertProcessorState()
  ) {}

  async process(alerts: Alert[], now = new Date(), options: ProcessAlertsOptions = {}): Promise<void> {
    if (options.clearMissingAlerts ?? true) {
      const currentAlertKeys = new Set(alerts.map((alert) => alert.key));

      for (const key of this.state.activeOnceAlertKeys) {
        if (!currentAlertKeys.has(key)) {
          this.state.activeOnceAlertKeys.delete(key);
        }
      }
    }

    for (const alert of alerts) {
      if (alert.resetOnceStateBeforeSending) {
        this.state.activeOnceAlertKeys.delete(alert.key);
      }

      if (alert.activeOnly) {
        if (alert.primeOnceState) {
          this.state.activeOnceAlertKeys.add(alert.key);
        }

        continue;
      }

      if (this.isAlertInMonitoringTimeslot(alert, now) && this.shouldSendAlert(alert, now)) {
        await this.sender.send(alert);
      }
    }
  }

  private shouldSendAlert(alert: Alert, now: Date): boolean {
    if (alert.sendOnceUntilCleared && this.state.activeOnceAlertKeys.has(alert.key)) {
      return false;
    }

    const lastSentAt = this.state.lastAlertAt.get(alert.key);
    const nowMs = now.getTime();

    if (lastSentAt && nowMs - lastSentAt < this.config.alertCooldownMs) {
      return false;
    }

    this.state.lastAlertAt.set(alert.key, nowMs);

    if (alert.sendOnceUntilCleared) {
      this.state.activeOnceAlertKeys.add(alert.key);
    }

    return true;
  }

  private isAlertInMonitoringTimeslot(alert: Alert, now: Date): boolean {
    const schedule = alert.device === "battery" ? this.config.monitoring.battery : this.config.monitoring.solarEdge;
    return isWithinTimeSlotSchedule(schedule, now);
  }
}
