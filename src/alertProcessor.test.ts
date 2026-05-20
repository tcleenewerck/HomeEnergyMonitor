import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AlertProcessor, createAlertProcessorState } from "./alertProcessor.js";
import type { Alert } from "./alerts.js";
import type { AlertSender } from "./alertSender.js";
import type { MonitorConfig } from "./config.js";

const config: MonitorConfig = {
  solarEdgeSiteId: "test-site",
  solarEdgeApiKey: "test-key",
  pollIntervalMs: 60_000,
  monitorStaleRestartAttempts: 5,
  monitorStaleRestartMs: 300_000,
  alertCooldownMs: 900_000,
  requestTimeoutMs: 15_000,
  maxConsecutiveMonitorFailures: 3,
  monitoring: {
    timezone: "Europe/Brussels",
    battery: { timezone: "Europe/Brussels", slots: [{ startMinute: 7 * 60, endMinute: 18 * 60 }] },
    solarEdge: { slots: [] }
  },
  thresholds: {}
};

class RecordingSender implements AlertSender {
  name = "recording";
  readonly sent: Alert[] = [];

  async send(alert: Alert): Promise<void> {
    this.sent.push(alert);
  }
}

function batteryAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    key: "battery-alert",
    device: "battery",
    message: "Battery alert",
    ...overrides
  };
}

describe("AlertProcessor", () => {
  it("sends send-once alerts once until they clear from the current alert set", async () => {
    const sender = new RecordingSender();
    const processor = new AlertProcessor(config, sender);
    const alert = batteryAlert({ sendOnceUntilCleared: true });
    const now = new Date("2026-05-19T10:00:00+02:00");

    await processor.process([alert], now);
    await processor.process([alert], new Date("2026-05-19T10:30:00+02:00"));
    await processor.process([], new Date("2026-05-19T10:31:00+02:00"));
    await processor.process([alert], new Date("2026-05-19T10:32:00+02:00"));

    assert.deepEqual(sender.sent.map((sent) => sent.message), ["Battery alert", "Battery alert"]);
  });

  it("uses active-only priming to suppress a later send-once alert with the same key", async () => {
    const sender = new RecordingSender();
    const processor = new AlertProcessor(config, sender);

    await processor.process(
      [batteryAlert({ activeOnly: true, primeOnceState: true })],
      new Date("2026-05-19T10:00:00+02:00")
    );
    await processor.process(
      [batteryAlert({ sendOnceUntilCleared: true })],
      new Date("2026-05-19T10:01:00+02:00")
    );

    assert.deepEqual(sender.sent, []);
  });

  it("does not send active-only alerts", async () => {
    const sender = new RecordingSender();
    const processor = new AlertProcessor(config, sender);

    await processor.process([batteryAlert({ activeOnly: true })], new Date("2026-05-19T10:00:00+02:00"));

    assert.deepEqual(sender.sent, []);
  });

  it("resets once-state before sending when an alert explicitly requests it", async () => {
    const sender = new RecordingSender();
    const state = createAlertProcessorState();
    state.activeOnceAlertKeys.add("battery-alert");
    const processor = new AlertProcessor(config, sender, state);

    await processor.process(
      [batteryAlert({ resetOnceStateBeforeSending: true, sendOnceUntilCleared: true })],
      new Date("2026-05-19T10:00:00+02:00")
    );

    assert.equal(sender.sent.length, 1);
    assert.equal(state.activeOnceAlertKeys.has("battery-alert"), true);
  });

  it("suppresses alerts during cooldown", async () => {
    const sender = new RecordingSender();
    const processor = new AlertProcessor(config, sender);
    const alert = batteryAlert();

    await processor.process([alert], new Date("2026-05-19T10:00:00+02:00"));
    await processor.process([alert], new Date("2026-05-19T10:05:00+02:00"));
    await processor.process([alert], new Date("2026-05-19T10:16:00+02:00"));

    assert.deepEqual(sender.sent.map((sent) => sent.message), ["Battery alert", "Battery alert"]);
  });

  it("uses battery timeslots for battery alerts and all-day SolarEdge schedules for SolarEdge alerts", async () => {
    const sender = new RecordingSender();
    const processor = new AlertProcessor(config, sender);

    await processor.process([batteryAlert()], new Date("2026-05-19T19:00:00+02:00"));
    await processor.process(
      [{ key: "grid-alert", device: "solaredge", message: "Grid alert" }],
      new Date("2026-05-19T19:00:00+02:00")
    );

    assert.deepEqual(sender.sent.map((sent) => sent.message), ["Grid alert"]);
  });

  it("can process unrelated alerts without clearing existing once-state", async () => {
    const sender = new RecordingSender();
    const state = createAlertProcessorState();
    state.activeOnceAlertKeys.add("battery-full-soon");
    const processor = new AlertProcessor(config, sender, state);

    await processor.process(
      [{ key: "monitor-poll-failure", device: "solaredge", message: "Monitor failed", sendOnceUntilCleared: true }],
      new Date("2026-05-19T19:00:00+02:00"),
      { clearMissingAlerts: false }
    );

    assert.equal(state.activeOnceAlertKeys.has("battery-full-soon"), true);
    assert.equal(state.activeOnceAlertKeys.has("monitor-poll-failure"), true);
  });
});
