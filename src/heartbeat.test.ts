import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DailyHeartbeat } from "./heartbeat.js";
import type { MonitorConfig } from "./config.js";
import type { CurrentPowerFlow } from "./solaredge.js";

const heartbeatConfig: NonNullable<MonitorConfig["heartbeat"]> = {
  hour: 8,
  timezone: "Europe/Brussels",
  slackWebhookUrl: "https://example.invalid/heartbeat",
  startupOverviewEnabled: false
};

const flow: CurrentPowerFlow = {
  unit: "kW",
  GRID: { status: "Active", currentPower: 1.2 },
  LOAD: { status: "Active", currentPower: 2.3 },
  PV: { status: "Active", currentPower: 3.4 },
  STORAGE: { status: "Active", currentPower: -0.5, chargeLevel: 78 },
  connections: []
};

function recordingHeartbeat() {
  const sent: string[] = [];
  const heartbeat = new DailyHeartbeat(heartbeatConfig, 15_000, async (_webhookUrl, message) => {
    sent.push(message);
  });

  return { heartbeat, sent };
}

describe("DailyHeartbeat", () => {
  it("does not send before the configured local hour", async () => {
    const { heartbeat, sent } = recordingHeartbeat();

    await heartbeat.sendIfDue(flow, new Date("2026-05-20T05:59:00Z"));

    assert.deepEqual(sent, []);
  });

  it("sends a successful heartbeat once per local day", async () => {
    const { heartbeat, sent } = recordingHeartbeat();

    await heartbeat.sendIfDue(flow, new Date("2026-05-20T06:00:00Z"));
    await heartbeat.sendIfDue(flow, new Date("2026-05-20T07:00:00Z"));

    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? "", /Home Energy Monitor heartbeat/);
    assert.match(sent[0] ?? "", /Storage: -0.5 kW \(78%\)/);
  });

  it("sends a failure heartbeat when the daily poll is failing", async () => {
    const { heartbeat, sent } = recordingHeartbeat();

    await heartbeat.sendFailureIfDue("SolarEdge timeout", new Date("2026-05-20T06:00:00Z"));
    await heartbeat.sendIfDue(flow, new Date("2026-05-20T07:00:00Z"));

    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? "", /latest SolarEdge poll failed/);
    assert.match(sent[0] ?? "", /SolarEdge timeout/);
  });
});
