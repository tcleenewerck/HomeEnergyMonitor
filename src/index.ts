import { evaluateAlerts } from "./alerts.js";
import { createAlertSender } from "./alertSender.js";
import { loadConfig } from "./config.js";
import { DailyHeartbeat } from "./heartbeat.js";
import { fetchCurrentPowerFlow } from "./solaredge.js";

const config = loadConfig();
const alertSender = createAlertSender(config);
const heartbeat = config.heartbeat ? new DailyHeartbeat(config.heartbeat) : undefined;
const lastAlertAt = new Map<string, number>();

function shouldSendAlert(key: string): boolean {
  const lastSentAt = lastAlertAt.get(key);
  const now = Date.now();

  if (lastSentAt && now - lastSentAt < config.alertCooldownMs) {
    return false;
  }

  lastAlertAt.set(key, now);
  return true;
}

async function monitorOnce(): Promise<void> {
  const flow = await fetchCurrentPowerFlow({
    siteId: config.solarEdgeSiteId,
    apiKey: config.solarEdgeApiKey
  });

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      grid: flow.GRID,
      load: flow.LOAD,
      pv: flow.PV,
      storage: flow.STORAGE ?? flow.Storage,
      connections: flow.connections
    })
  );

  for (const alert of evaluateAlerts(flow, config)) {
    if (shouldSendAlert(alert.key)) {
      await alertSender.send(alert);
    }
  }

  await heartbeat?.sendIfDue(flow);
}

async function startMonitor(): Promise<void> {
  console.log(`Starting Home Energy Monitor. Polling every ${config.pollIntervalMs / 1000}s.`);
  console.log(`SMS alerts are ${config.twilio ? "enabled" : "disabled"}.`);
  console.log(`Slack alerts are ${config.slack ? "enabled" : "disabled"}.`);
  console.log(
    config.heartbeat
      ? `Heartbeat is enabled at hour ${config.heartbeat.hour} in ${config.heartbeat.timezone}.`
      : "Heartbeat is disabled."
  );

  await monitorOnce();
  setInterval(() => {
    monitorOnce().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }, config.pollIntervalMs);
}

startMonitor().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
