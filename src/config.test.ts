import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig } from "./config.js";

const originalEnv = { ...process.env };

function resetTestEnv(): void {
  process.env = {};
}

function setRequiredEnv(): void {
  process.env.SOLAREDGE_SITE_ID = "test-site";
  process.env.SOLAREDGE_API_KEY = "test-key";
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("accepts multiple minimum battery levels with percent signs", () => {
    resetTestEnv();
    setRequiredEnv();
    process.env.MIN_BATTERY_LEVEL_PERCENT = "30%,50%,70%";

    const config = loadConfig();

    assert.deepEqual(config.thresholds.minBatteryLevelPercents, [70, 50, 30]);
  });

  it("keeps a single minimum battery level compatible", () => {
    resetTestEnv();
    setRequiredEnv();
    process.env.MIN_BATTERY_LEVEL_PERCENT = "50";

    const config = loadConfig();

    assert.deepEqual(config.thresholds.minBatteryLevelPercents, [50]);
  });
});
