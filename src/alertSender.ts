import twilio from "twilio";
import type { Alert } from "./alerts.js";
import type { MonitorConfig } from "./config.js";
import { sendSlackMessage } from "./slack.js";

export type AlertSender = {
  name: string;
  send(alert: Alert): Promise<void>;
};

class ConsoleAlertSender implements AlertSender {
  name = "console";

  async send(alert: Alert): Promise<void> {
    console.warn(`[ALERT] ${alert.message}`);
  }
}

class TwilioSmsAlertSender implements AlertSender {
  name = "twilio-sms";
  private readonly client: ReturnType<typeof twilio>;

  constructor(
    private readonly config: NonNullable<MonitorConfig["twilio"]>,
    timeoutMs: number
  ) {
    this.client = twilio(config.accountSid, config.authToken, { timeout: timeoutMs });
  }

  async send(alert: Alert): Promise<void> {
    await this.client.messages.create({
      body: `[Home Energy Monitor] ${alert.message}`,
      from: this.config.fromNumber,
      to: this.config.toNumber
    });
  }
}

class SlackAlertSender implements AlertSender {
  name = "slack";

  constructor(
    private readonly config: NonNullable<MonitorConfig["slack"]>,
    private readonly timeoutMs: number
  ) {}

  async send(alert: Alert): Promise<void> {
    await sendSlackMessage(this.config.webhookUrl, `:warning: *Home Energy Monitor*\n${alert.message}`, this.timeoutMs);
  }
}

class CompositeAlertSender implements AlertSender {
  name = "composite";

  constructor(private readonly senders: AlertSender[]) {}

  async send(alert: Alert): Promise<void> {
    await Promise.all(this.senders.map((sender) => sender.send(alert)));
  }
}

export function createAlertSenders(config: MonitorConfig): AlertSender[] {
  const senders: AlertSender[] = [new ConsoleAlertSender()];

  if (config.twilio) {
    senders.push(new TwilioSmsAlertSender(config.twilio, config.requestTimeoutMs));
  }

  if (config.slack) {
    senders.push(new SlackAlertSender(config.slack, config.requestTimeoutMs));
  }

  return senders;
}

export function createAlertSender(config: MonitorConfig): AlertSender {
  return new CompositeAlertSender(createAlertSenders(config));
}
