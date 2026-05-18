export type MonitorConfig = {
  solarEdgeSiteId: string;
  solarEdgeApiKey: string;
  pollIntervalMs: number;
  alertCooldownMs: number;
  thresholds: {
    maxGridImportW?: number;
    maxGridExportW?: number;
    minPvProductionW?: number;
    batteryCapacityKWh?: number;
    batteryFullNoticeMinutes?: number;
    minBatteryChargeRateW?: number;
    minBatteryLevelPercent?: number;
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

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("HEARTBEAT_HOUR must be an integer from 0 to 23.");
  }

  if (!slackWebhookUrl) {
    throw new Error("Heartbeat requires HEARTBEAT_SLACK_WEBHOOK_URL or SLACK_WEBHOOK_URL.");
  }

  return {
    hour,
    timezone,
    slackWebhookUrl
  };
}

export function loadConfig(): MonitorConfig {
  const pollIntervalSeconds = numberEnv("POLL_INTERVAL_SECONDS", 60);
  const alertCooldownSeconds = numberEnv("ALERT_COOLDOWN_SECONDS", 900);

  if (pollIntervalSeconds < 10) {
    throw new Error("POLL_INTERVAL_SECONDS must be at least 10.");
  }

  return {
    solarEdgeSiteId: requiredEnv("SOLAREDGE_SITE_ID"),
    solarEdgeApiKey: requiredEnv("SOLAREDGE_API_KEY"),
    pollIntervalMs: pollIntervalSeconds * 1000,
    alertCooldownMs: alertCooldownSeconds * 1000,
    thresholds: {
      maxGridImportW: optionalNumberEnv("MAX_GRID_IMPORT_W"),
      maxGridExportW: optionalNumberEnv("MAX_GRID_EXPORT_W"),
      minPvProductionW: optionalNumberEnv("MIN_PV_PRODUCTION_W"),
      batteryCapacityKWh: optionalNumberEnv("BATTERY_CAPACITY_KWH"),
      batteryFullNoticeMinutes: optionalNumberEnv("BATTERY_FULL_NOTICE_MINUTES") ?? 5,
      minBatteryChargeRateW: optionalNumberEnv("MIN_BATTERY_CHARGE_RATE_W") ?? 250,
      minBatteryLevelPercent: optionalNumberEnv("MIN_BATTERY_LEVEL_PERCENT")
    },
    twilio: loadTwilioConfig(),
    slack: loadSlackConfig(),
    heartbeat: loadHeartbeatConfig()
  };
}
