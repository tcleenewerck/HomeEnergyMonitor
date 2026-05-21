import type { MonitorConfig } from "./config.js";
import { formatTimeSlotSchedule } from "./timeslots.js";

function enabledText(value: boolean): string {
  return value ? "enabled" : "disabled";
}

function optionalWatts(value: number | undefined): string {
  return value === undefined ? "not configured" : `${value} W`;
}

function optionalPercents(value: number[] | undefined): string {
  return value === undefined || value.length === 0 ? "not configured" : value.map((percent) => `${percent}%`).join(", ");
}

function optionalKWh(value: number | undefined): string {
  return value === undefined ? "not configured" : `${value} kWh`;
}

function durationFromSeconds(value: number): string {
  if (value % 60 === 0) {
    const minuteValue = value / 60;
    return minuteValue === 1 ? "1 minute" : `${minuteValue} minutes`;
  }

  return value === 1 ? "1 second" : `${value} seconds`;
}

function formatList(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

export function settingsOverview(config: MonitorConfig): string {
  const pollIntervalSeconds = config.pollIntervalMs / 1000;
  const monitorStaleRestartSeconds = config.monitorStaleRestartMs / 1000;
  const alertCooldownSeconds = config.alertCooldownMs / 1000;
  const heartbeat = config.heartbeat;

  return [
    "Home Energy Monitor settings",
    "",
    "SolarEdge",
    formatList([
      `Site ID: ${config.solarEdgeSiteId}`,
      `API key: configured`
    ]),
    "",
    "Monitoring",
    formatList([
      `Polling interval: every ${durationFromSeconds(pollIntervalSeconds)}`,
      `Stale monitor restart: after ${config.monitorStaleRestartAttempts} missed poll attempts (${durationFromSeconds(
        monitorStaleRestartSeconds
      )})`,
      `Alert cooldown: ${durationFromSeconds(alertCooldownSeconds)}`,
      `Request timeout: ${durationFromSeconds(config.requestTimeoutMs / 1000)}`,
      `Monitor failure alert: after ${config.maxConsecutiveMonitorFailures} consecutive failures`,
      `Battery alert timeslots: ${formatTimeSlotSchedule(config.monitoring.battery)}`,
      `SolarEdge alert timeslots: ${formatTimeSlotSchedule(config.monitoring.solarEdge)}`,
      "Deployment: Railway worker",
      "Logs: enabled through stdout/stderr"
    ]),
    "",
    "Alert conditions",
    formatList([
      `Max grid import: ${optionalWatts(config.thresholds.maxGridImportW)}`,
      `Max grid export: ${optionalWatts(config.thresholds.maxGridExportW)}`,
      `Battery capacity: ${optionalKWh(config.thresholds.batteryCapacityKWh)}`,
      `Battery full notice: ${durationFromSeconds((config.thresholds.batteryFullNoticeMinutes ?? 5) * 60)} before full`,
      `Battery full alert reset: below ${config.thresholds.batteryFullAlertResetBelowPercent ?? 95}%`,
      `Minimum battery charge rate: ${optionalWatts(config.thresholds.minBatteryChargeRateW)}`,
      `Minimum battery levels: ${optionalPercents(config.thresholds.minBatteryLevelPercents)}`
    ]),
    "",
    "Notifications",
    formatList([
      "Console/Railway logs: enabled",
      `Slack alerts: ${enabledText(config.slack !== undefined)}`,
      `SMS alerts: ${enabledText(config.twilio !== undefined)}`
    ]),
    "",
    "Daily heartbeat",
    formatList([
      `Status: ${enabledText(heartbeat !== undefined)}`,
      `Time: ${heartbeat ? `${String(heartbeat.hour).padStart(2, "0")}:00` : "not configured"}`,
      `Timezone: ${heartbeat?.timezone ?? "not configured"}`,
      `Slack webhook: ${heartbeat ? "configured" : "not configured"}`,
      `Startup overview: ${enabledText(heartbeat?.startupOverviewEnabled ?? false)}`
    ])
  ].join("\n");
}
