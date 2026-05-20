import { AlertProcessor } from "./alertProcessor.js";
import { evaluateAlerts } from "./alerts.js";
import { createAlertSender } from "./alertSender.js";
import { loadConfig } from "./config.js";
import { DailyHeartbeat } from "./heartbeat.js";
import { settingsOverview } from "./settingsOverview.js";
import { fetchCurrentPowerFlow } from "./solaredge.js";

const config = loadConfig();
const alertSender = createAlertSender(config);
const alertProcessor = new AlertProcessor(config, alertSender);
const heartbeat = config.heartbeat ? new DailyHeartbeat(config.heartbeat, config.requestTimeoutMs) : undefined;
let consecutiveMonitorFailures = 0;
let lastMonitorCycleCompletedAt = Date.now();

function exitAfterUnexpectedError(source: string, error: unknown): never {
  console.error(`${source}: ${error instanceof Error ? error.stack ?? error.message : error}`);
  process.exit(1);
}

process.on("uncaughtException", (error) => {
  exitAfterUnexpectedError("Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  exitAfterUnexpectedError("Unhandled rejection", reason);
});

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
  await alertProcessor.process(alerts);

  await heartbeat?.sendIfDue(flow);
}

async function handleMonitorError(error: unknown): Promise<void> {
  consecutiveMonitorFailures += 1;
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Monitor poll failed (${consecutiveMonitorFailures} consecutive): ${message}`);

  heartbeat?.sendFailureIfDue(message).catch((heartbeatError: unknown) => {
    console.error(
      `Could not send failure heartbeat: ${heartbeatError instanceof Error ? heartbeatError.message : heartbeatError}`
    );
  });

  if (consecutiveMonitorFailures < config.maxConsecutiveMonitorFailures) {
    return;
  }

  const alert = {
    key: "monitor-poll-failure",
    device: "solaredge" as const,
    message:
      `SolarEdge monitoring has failed ${consecutiveMonitorFailures} times in a row. ` +
      `Latest error: ${message}`,
    sendOnceUntilCleared: true
  };

  await alertProcessor.process([alert], new Date(), { clearMissingAlerts: false });
}

async function runMonitorCycle(): Promise<void> {
  try {
    await monitorOnce();
  } catch (error: unknown) {
    await handleMonitorError(error);
  } finally {
    lastMonitorCycleCompletedAt = Date.now();
  }
}

function checkMonitorWatchdog(): void {
  const staleForMs = Date.now() - lastMonitorCycleCompletedAt;

  if (staleForMs <= config.monitorStaleRestartMs) {
    return;
  }

  console.error(
    `No monitor cycle completed for ${config.monitorStaleRestartAttempts} poll attempts ` +
      `(${Math.round(staleForMs / 1000)} seconds). Exiting so Railway can restart the worker.`
  );
  process.exit(1);
}

async function startMonitor(): Promise<void> {
  const overview = settingsOverview(config);
  console.log(overview);

  if (heartbeat && config.heartbeat?.startupOverviewEnabled) {
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
  setInterval(checkMonitorWatchdog, Math.min(config.monitorStaleRestartMs, 60_000));
}

startMonitor().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
