import { evaluateAlerts } from "./alerts.js";
import { createAlertSender } from "./alertSender.js";
import { loadConfig } from "./config.js";
import { DailyHeartbeat } from "./heartbeat.js";
import { fetchCurrentPowerFlow } from "./solaredge.js";

const config = loadConfig();
const alertSender = createAlertSender(config);
const heartbeat = config.heartbeat ? new DailyHeartbeat(config.heartbeat) : undefined;
const lastAlertAt = new Map<string, number>();
const activeOnceAlertKeys = new Set<string>();

function shouldSendAlert(alert: ReturnType<typeof evaluateAlerts>[number]): boolean {
  if (alert.sendOnceUntilCleared && activeOnceAlertKeys.has(alert.key)) {
    return false;
  }

  const lastSentAt = lastAlertAt.get(alert.key);
  const now = Date.now();

  if (lastSentAt && now - lastSentAt < config.alertCooldownMs) {
    return false;
  }

  lastAlertAt.set(alert.key, now);

  if (alert.sendOnceUntilCleared) {
    activeOnceAlertKeys.add(alert.key);
  }

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

  const alerts = evaluateAlerts(flow, config);
  const currentAlertKeys = new Set(alerts.map((alert) => alert.key));

  for (const key of activeOnceAlertKeys) {
    if (!currentAlertKeys.has(key)) {
      activeOnceAlertKeys.delete(key);
    }
  }

  for (const alert of alerts) {
    if (shouldSendAlert(alert)) {
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
