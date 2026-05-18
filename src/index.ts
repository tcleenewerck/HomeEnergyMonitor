import { evaluateAlerts } from "./alerts.js";
import { createAlertSender } from "./alertSender.js";
import { loadConfig } from "./config.js";
import { DailyHeartbeat } from "./heartbeat.js";
import { settingsOverview } from "./settingsOverview.js";
import { fetchCurrentPowerFlow } from "./solaredge.js";

const config = loadConfig();
const alertSender = createAlertSender(config);
const heartbeat = config.heartbeat ? new DailyHeartbeat(config.heartbeat, config.requestTimeoutMs) : undefined;
const lastAlertAt = new Map<string, number>();
const activeOnceAlertKeys = new Set<string>();
let consecutiveMonitorFailures = 0;

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
    apiKey: config.solarEdgeApiKey,
    timeoutMs: config.requestTimeoutMs
  });
  consecutiveMonitorFailures = 0;

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

async function handleMonitorError(error: unknown): Promise<void> {
  consecutiveMonitorFailures += 1;
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Monitor poll failed (${consecutiveMonitorFailures} consecutive): ${message}`);

  if (consecutiveMonitorFailures < config.maxConsecutiveMonitorFailures) {
    return;
  }

  const alert = {
    key: "monitor-poll-failure",
    message:
      `SolarEdge monitoring has failed ${consecutiveMonitorFailures} times in a row. ` +
      `Latest error: ${message}`,
    sendOnceUntilCleared: true
  };

  if (shouldSendAlert(alert)) {
    await alertSender.send(alert);
  }
}

async function runMonitorCycle(): Promise<void> {
  try {
    await monitorOnce();
  } catch (error: unknown) {
    await handleMonitorError(error);
  }
}

async function startMonitor(): Promise<void> {
  const overview = settingsOverview(config);
  console.log(overview);

  if (heartbeat) {
    heartbeat.sendDeploymentOverview(overview).catch((error: unknown) => {
      console.error(
        `Could not send deployment settings overview to heartbeat channel: ${
          error instanceof Error ? error.message : error
        }`
      );
    });
  }

  await runMonitorCycle();
  setInterval(() => {
    runMonitorCycle().catch((error: unknown) => {
      console.error(`Could not send monitor failure alert: ${error instanceof Error ? error.message : error}`);
    });
  }, config.pollIntervalMs);
}

startMonitor().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
