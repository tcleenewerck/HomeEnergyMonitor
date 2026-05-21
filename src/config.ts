import { alwaysTimeSlotSchedule, parseTimeSlotSchedule, type TimeSlotSchedule } from "./timeslots.js";

export type MonitorConfig = {
  solarEdgeSiteId: string;
  solarEdgeApiKey: string;
  pollIntervalMs: number;
  monitorStaleRestartAttempts: number;
  monitorStaleRestartMs: number;
  alertCooldownMs: number;
  requestTimeoutMs: number;
  maxConsecutiveMonitorFailures: number;
  monitoring: {
    timezone: string;
    battery: TimeSlotSchedule;
    solarEdge: TimeSlotSchedule;
  };
  thresholds: {
    maxGridImportW?: number;
    maxGridExportW?: number;
    batteryCapacityKWh?: number;
    batteryFullNoticeMinutes?: number;
    batteryFullAlertResetBelowPercent?: number;
    minBatteryChargeRateW?: number;
    minBatteryLevelPercents?: number[];
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    fromNumber: string;
    toNumber: string;
  };
  slack?: {
    webhookUrl: string;
  };
  heartbeat?: {
    hour: number;
    timezone: string;
    slackWebhookUrl: string;
    startupOverviewEnabled: boolean;
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalNumberEnv(name: string): number | undefined {
  const value = process.env[name];

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return parsed;
}

function optionalPercentListEnv(name: string): number[] | undefined {
  const value = optionalEnv(name);

  if (!value) {
    return undefined;
  }

  const percents = value.split(",").map((part) => {
    const normalized = part.trim().replace(/\s*%$/, "").trim();

    if (normalized.length === 0) {
      throw new Error(`Environment variable ${name} must be a comma-separated list of percentages.`);
    }

    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Environment variable ${name} must be a comma-separated list of percentages.`);
    }

    if (parsed < 0 || parsed > 100) {
      throw new Error(`Environment variable ${name} percentages must be from 0 to 100.`);
    }

    return parsed;
  });

  if (percents.length === 0) {
    return undefined;
  }

  return [...new Set(percents)].sort((first, second) => second - first);
}

function numberEnv(name: string, fallback: number): number {
  return optionalNumberEnv(name) ?? fallback;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`Environment variable ${name} must be true or false.`);
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

function loadTwilioConfig(): MonitorConfig["twilio"] {
  if (!booleanEnv("SMS_ALERTS_ENABLED", false)) {
    return undefined;
  }

  const accountSid = optionalEnv("TWILIO_ACCOUNT_SID");
  const authToken = optionalEnv("TWILIO_AUTH_TOKEN");
  const fromNumber = optionalEnv("TWILIO_FROM_NUMBER");
  const toNumber = optionalEnv("ALERT_TO_PHONE_NUMBER");
  const values = [accountSid, authToken, fromNumber, toNumber];

  if (accountSid && authToken && fromNumber && toNumber) {
    return {
      accountSid,
      authToken,
      fromNumber,
      toNumber
    };
  }

  if (values.some(Boolean)) {
    throw new Error(
      "Twilio SMS alerts require TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and ALERT_TO_PHONE_NUMBER."
    );
  }

  return undefined;
}

function loadSlackConfig(): MonitorConfig["slack"] {
  if (!booleanEnv("SLACK_ALERTS_ENABLED", false)) {
    return undefined;
  }

  const webhookUrl = optionalEnv("SLACK_WEBHOOK_URL");

  if (!webhookUrl) {
    throw new Error("Slack alerts require SLACK_WEBHOOK_URL when SLACK_ALERTS_ENABLED=true.");
  }

  return { webhookUrl };
}

function loadHeartbeatConfig(): MonitorConfig["heartbeat"] {
  if (!booleanEnv("HEARTBEAT_ENABLED", false)) {
    return undefined;
  }

  const hour = numberEnv("HEARTBEAT_HOUR", 8);
  const timezone = optionalEnv("HEARTBEAT_TIMEZONE") ?? "Europe/Brussels";
  const slackWebhookUrl = optionalEnv("HEARTBEAT_SLACK_WEBHOOK_URL") ?? optionalEnv("SLACK_WEBHOOK_URL");
  const startupOverviewEnabled = booleanEnv("HEARTBEAT_STARTUP_OVERVIEW_ENABLED", false);

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("HEARTBEAT_HOUR must be an integer from 0 to 23.");
  }

  if (!slackWebhookUrl) {
    throw new Error("Heartbeat requires HEARTBEAT_SLACK_WEBHOOK_URL or SLACK_WEBHOOK_URL.");
  }

  return {
    hour,
    timezone,
    slackWebhookUrl,
    startupOverviewEnabled
  };
}

export function loadConfig(): MonitorConfig {
  const pollIntervalSeconds = numberEnv("POLL_INTERVAL_SECONDS", 60);
  const monitorStaleRestartAttempts = numberEnv("MONITOR_STALE_RESTART_ATTEMPTS", 5);
  const alertCooldownSeconds = numberEnv("ALERT_COOLDOWN_SECONDS", 900);
  const requestTimeoutSeconds = numberEnv("REQUEST_TIMEOUT_SECONDS", 15);
  const maxConsecutiveMonitorFailures = numberEnv("MAX_CONSECUTIVE_MONITOR_FAILURES", 3);
  const alertTimezone = optionalEnv("ALERT_TIMEZONE") ?? "Europe/Brussels";
  const batteryAlertTimeslots = optionalEnv("BATTERY_ALERT_TIMESLOTS") ?? "07:00-18:00";
  const solarEdgeAlertTimeslots = optionalEnv("SOLAREDGE_ALERT_TIMESLOTS");

  if (pollIntervalSeconds < 10) {
    throw new Error("POLL_INTERVAL_SECONDS must be at least 10.");
  }

  if (!Number.isInteger(monitorStaleRestartAttempts) || monitorStaleRestartAttempts < 2) {
    throw new Error("MONITOR_STALE_RESTART_ATTEMPTS must be an integer of at least 2.");
  }

  if (requestTimeoutSeconds < 1) {
    throw new Error("REQUEST_TIMEOUT_SECONDS must be at least 1.");
  }

  if (!Number.isInteger(maxConsecutiveMonitorFailures) || maxConsecutiveMonitorFailures < 1) {
    throw new Error("MAX_CONSECUTIVE_MONITOR_FAILURES must be an integer of at least 1.");
  }

  return {
    solarEdgeSiteId: requiredEnv("SOLAREDGE_SITE_ID"),
    solarEdgeApiKey: requiredEnv("SOLAREDGE_API_KEY"),
    pollIntervalMs: pollIntervalSeconds * 1000,
    monitorStaleRestartAttempts,
    monitorStaleRestartMs: monitorStaleRestartAttempts * pollIntervalSeconds * 1000,
    alertCooldownMs: alertCooldownSeconds * 1000,
    requestTimeoutMs: requestTimeoutSeconds * 1000,
    maxConsecutiveMonitorFailures,
    monitoring: {
      timezone: alertTimezone,
      battery: parseTimeSlotSchedule(batteryAlertTimeslots, alertTimezone, "BATTERY_ALERT_TIMESLOTS"),
      solarEdge: solarEdgeAlertTimeslots
        ? parseTimeSlotSchedule(solarEdgeAlertTimeslots, alertTimezone, "SOLAREDGE_ALERT_TIMESLOTS")
        : alwaysTimeSlotSchedule()
    },
    thresholds: {
      maxGridImportW: optionalNumberEnv("MAX_GRID_IMPORT_W"),
      maxGridExportW: optionalNumberEnv("MAX_GRID_EXPORT_W"),
      batteryCapacityKWh: optionalNumberEnv("BATTERY_CAPACITY_KWH"),
      batteryFullNoticeMinutes: optionalNumberEnv("BATTERY_FULL_NOTICE_MINUTES") ?? 5,
      batteryFullAlertResetBelowPercent: optionalNumberEnv("BATTERY_FULL_ALERT_RESET_BELOW_PERCENT") ?? 95,
      minBatteryChargeRateW: optionalNumberEnv("MIN_BATTERY_CHARGE_RATE_W") ?? 250,
      minBatteryLevelPercents: optionalPercentListEnv("MIN_BATTERY_LEVEL_PERCENT")
    },
    twilio: loadTwilioConfig(),
    slack: loadSlackConfig(),
    heartbeat: loadHeartbeatConfig()
  };
}
