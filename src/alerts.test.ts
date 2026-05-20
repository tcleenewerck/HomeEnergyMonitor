import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAlerts } from "./alerts.js";
import type { MonitorConfig } from "./config.js";
import type { CurrentPowerFlow, SolarEdgePowerRoute } from "./solaredge.js";

const baseConfig: MonitorConfig = {
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
    battery: { timezone: "Europe/Brussels", slots: [] },
    solarEdge: { slots: [] }
  },
  thresholds: {
    maxGridImportW: 5000,
    maxGridExportW: 1000,
    batteryCapacityKWh: 10,
    batteryFullNoticeMinutes: 5,
    batteryFullAlertResetBelowPercent: 95,
    minBatteryChargeRateW: 250,
    minBatteryLevelPercent: 50
  }
};

function flow(options: {
  unit?: string;
  connections?: SolarEdgePowerRoute[];
  gridPower?: number;
  storagePower?: number;
  chargeLevel?: number;
  storageKey?: "STORAGE" | "Storage";
}): CurrentPowerFlow {
  const storage = options.chargeLevel === undefined && options.storagePower === undefined
    ? undefined
    : {
        status: "Active",
        currentPower: options.storagePower ?? 0,
        chargeLevel: options.chargeLevel
      };

  return {
    unit: options.unit ?? "kW",
    connections: options.connections ?? [],
    GRID: { status: "Active", currentPower: options.gridPower ?? 0 },
    PV: { status: "Active", currentPower: 0 },
    ...(storage && { [options.storageKey ?? "STORAGE"]: storage })
  };
}

function alertKeys(flowValue: CurrentPowerFlow, config = baseConfig): string[] {
  return evaluateAlerts(flowValue, config).filter((alert) => !alert.activeOnly).map((alert) => alert.key);
}

describe("grid alerts", () => {
  it("sends grid import only when the import route is active and power is above the threshold", () => {
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "GRID", to: "LOAD" }], gridPower: 5.1 })), [
      "max-grid-import"
    ]);
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "GRID", to: "LOAD" }], gridPower: 5 })), []);
    assert.deepEqual(alertKeys(flow({ connections: [], gridPower: 6 })), []);
  });

  it("sends grid export for all supported export routes when power is above the threshold", () => {
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "PV", to: "GRID" }], gridPower: 1.1 })), [
      "max-grid-export"
    ]);
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "LOAD", to: "GRID" }], gridPower: 1.1 })), [
      "max-grid-export"
    ]);
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "Storage", to: "GRID" }], gridPower: 1.1 })), [
      "max-grid-export"
    ]);
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "PV", to: "GRID" }], gridPower: 1 })), []);
    assert.deepEqual(alertKeys(flow({ connections: [], gridPower: 2 })), []);
  });

  it("treats route names case-insensitively and converts W values to the configured W thresholds", () => {
    assert.deepEqual(alertKeys(flow({ unit: "W", connections: [{ from: "grid", to: "load" }], gridPower: 5100 })), [
      "max-grid-import"
    ]);
  });
});

describe("minimum battery level alerts", () => {
  it("sends once when battery level is below the configured threshold", () => {
    assert.deepEqual(evaluateAlerts(flow({ chargeLevel: 49, storagePower: 0 }), baseConfig), [
      {
        key: "min-battery-level",
        device: "battery",
        message: "Battery level is 49%, below 50%.",
        sendOnceUntilCleared: true
      }
    ]);
  });

  it("does not send at the threshold, above it, or without a charge level", () => {
    assert.deepEqual(alertKeys(flow({ chargeLevel: 50, storagePower: 0 })), []);
    assert.deepEqual(alertKeys(flow({ chargeLevel: 60, storagePower: 0 })), []);
    assert.deepEqual(alertKeys(flow({ storagePower: 0 })), []);
  });
});

describe("battery full-soon alerts", () => {
  it("sends full-soon below the reset threshold when the battery will be full within the notice window", () => {
    const alerts = evaluateAlerts(flow({ connections: [{ from: "PV", to: "Storage" }], chargeLevel: 94, storagePower: 8 }), baseConfig);

    assert.deepEqual(alerts, [
      {
        key: "battery-full-soon",
        device: "battery",
        message: "Battery is expected to be full in about 5 min at 8000 W charging power.",
        resetOnceStateBeforeSending: true,
        sendOnceUntilCleared: true
      }
    ]);
  });

  it("does not send full-soon outside the notice window, below the minimum charge rate, or without a charging route", () => {
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "PV", to: "Storage" }], chargeLevel: 94, storagePower: 7 })), []);
    assert.deepEqual(alertKeys(flow({ connections: [{ from: "PV", to: "Storage" }], chargeLevel: 94, storagePower: 0.2 })), []);
    assert.deepEqual(alertKeys(flow({ connections: [], chargeLevel: 94, storagePower: 8 })), []);
  });

  it("supports W units and the SolarEdge Storage property shape", () => {
    const alerts = evaluateAlerts(
      flow({
        unit: "W",
        connections: [{ from: "PV", to: "Storage" }],
        chargeLevel: 94,
        storagePower: 8000,
        storageKey: "Storage"
      }),
      baseConfig
    );

    assert.equal(alerts[0]?.message, "Battery is expected to be full in about 5 min at 8000 W charging power.");
  });
});

describe("battery reset threshold and full alerts", () => {
  it("primes full-soon as active above the reset threshold instead of sending it after a restart", () => {
    const alerts = evaluateAlerts(flow({ connections: [{ from: "PV", to: "Storage" }], chargeLevel: 99, storagePower: 1.03 }), baseConfig);

    assert.deepEqual(alerts, [
      {
        key: "battery-full-soon",
        device: "battery",
        message: "",
        activeOnly: true,
        primeOnceState: true
      },
      {
        key: "battery-full",
        device: "battery",
        message: "",
        activeOnly: true
      }
    ]);
  });

  it("still sends the separate full alert at 100 percent", () => {
    const alerts = evaluateAlerts(flow({ connections: [{ from: "PV", to: "Storage" }], chargeLevel: 100, storagePower: 0.1 }), baseConfig);

    assert.deepEqual(alerts, [
      {
        key: "battery-full",
        device: "battery",
        message: "Battery is full.",
        resetOnceStateBeforeSending: false,
        sendOnceUntilCleared: true
      },
      {
        key: "battery-full-soon",
        device: "battery",
        message: "",
        activeOnly: true,
        primeOnceState: true
      }
    ]);
  });
});
