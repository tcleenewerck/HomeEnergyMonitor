import type { MonitorConfig } from "./config.js";
import { sendSlackMessage } from "./slack.js";
import type { CurrentPowerFlow } from "./solaredge.js";

type LocalDateHour = {
  dateKey: string;
  hour: number;
};

function localDateHour(now: Date, timezone: string): LocalDateHour {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const part = (type: string): string => {
    const value = parts.find((item) => item.type === type)?.value;

    if (!value) {
      throw new Error(`Could not determine local ${type} for timezone ${timezone}.`);
    }

    return value;
  };

  return {
    dateKey: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour"))
  };
}

function powerText(label: string, value?: number): string {
  if (value === undefined) {
    return `${label}: n/a`;
  }

  return `${label}: ${value} kW`;
}

function heartbeatMessage(flow: CurrentPowerFlow, timezone: string): string {
  const storage = flow.STORAGE ?? flow.Storage;
  const chargeLevel = storage?.chargeLevel === undefined ? "n/a" : `${storage.chargeLevel}%`;

  return [
    ":white_check_mark: *Home Energy Monitor heartbeat*",
    `Time: ${new Date().toLocaleString("en-GB", { timeZone: timezone })}`,
    powerText("Grid", flow.GRID?.currentPower),
    powerText("Load", flow.LOAD?.currentPower),
    powerText("PV", flow.PV?.currentPower),
    `${powerText("Storage", storage?.currentPower)} (${chargeLevel})`
  ].join("\n");
}

export class DailyHeartbeat {
  private lastSentDateKey?: string;

  constructor(private readonly config: NonNullable<MonitorConfig["heartbeat"]>) {}

  async sendDeploymentOverview(settingsOverview: string): Promise<void> {
    await sendSlackMessage(
      this.config.slackWebhookUrl,
      [
        ":rocket: *Home Energy Monitor deployed*",
        "```",
        settingsOverview,
        "```"
      ].join("\n")
    );
    console.log("Deployment settings overview sent to heartbeat channel.");
  }

  async sendIfDue(flow: CurrentPowerFlow, now = new Date()): Promise<void> {
    const local = localDateHour(now, this.config.timezone);

    if (local.hour < this.config.hour || this.lastSentDateKey === local.dateKey) {
      return;
    }

    await sendSlackMessage(this.config.slackWebhookUrl, heartbeatMessage(flow, this.config.timezone));
    this.lastSentDateKey = local.dateKey;
    console.log(`Heartbeat sent for ${local.dateKey}.`);
  }
}
