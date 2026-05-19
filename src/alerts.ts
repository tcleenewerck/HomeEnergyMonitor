import type { MonitorConfig } from "./config.js";
import type { CurrentPowerFlow } from "./solaredge.js";

export type Alert = {
  key: string;
  device: "battery" | "solaredge";
  message: string;
  activeOnly?: boolean;
  primeOnceState?: boolean;
  resetOnceStateBeforeSending?: boolean;
  sendOnceUntilCleared?: boolean;
};

function toWatts(power: number, unit: string): number {
  if (unit.toLowerCase() === "kw") {
    return power * 1000;
  }

  return power;
}

function roundedWatts(power: number): number {
  return Math.round(power);
}

function normalizedNode(node: string): string {
  return node.toLowerCase();
}

function hasRoute(flow: CurrentPowerFlow, from: string, to: string): boolean {
  const normalizedFrom = normalizedNode(from);
  const normalizedTo = normalizedNode(to);

  return flow.connections.some(
    (connection) => normalizedNode(connection.from) === normalizedFrom && normalizedNode(connection.to) === normalizedTo
  );
}

function gridPowerWatts(flow: CurrentPowerFlow): number {
  return toWatts(flow.GRID?.currentPower ?? 0, flow.unit);
}

function storage(flow: CurrentPowerFlow) {
  return flow.STORAGE ?? flow.Storage;
}

function storagePowerWatts(flow: CurrentPowerFlow): number {
  return toWatts(storage(flow)?.currentPower ?? 0, flow.unit);
}

function batteryChargeLevel(flow: CurrentPowerFlow): number | undefined {
  return storage(flow)?.chargeLevel;
}

function minutesUntilBatteryFull(flow: CurrentPowerFlow, batteryCapacityKWh: number): number | undefined {
  const chargeLevel = batteryChargeLevel(flow);
  const chargingPowerW = storagePowerWatts(flow);

  if (
    chargeLevel === undefined ||
    chargeLevel < 0 ||
    chargeLevel >= 100 ||
    chargingPowerW <= 0 ||
    !isBatteryCharging(flow)
  ) {
    return undefined;
  }

  const remainingKWh = batteryCapacityKWh * ((100 - chargeLevel) / 100);
  const chargingPowerKW = chargingPowerW / 1000;

  return (remainingKWh / chargingPowerKW) * 60;
}

function isBatteryCharging(flow: CurrentPowerFlow): boolean {
  return hasRoute(flow, "PV", "Storage") || hasRoute(flow, "GRID", "Storage") || hasRoute(flow, "LOAD", "Storage");
}

export function evaluateAlerts(flow: CurrentPowerFlow, config: MonitorConfig): Alert[] {
  const alerts: Alert[] = [];
  const gridPowerW = gridPowerWatts(flow);
  const storagePowerW = storagePowerWatts(flow);
  const chargeLevel = batteryChargeLevel(flow);
  const isImportingFromGrid = hasRoute(flow, "GRID", "LOAD");
  const isExportingToGrid =
    hasRoute(flow, "PV", "GRID") || hasRoute(flow, "LOAD", "GRID") || hasRoute(flow, "Storage", "GRID");

  if (
    config.thresholds.maxGridImportW !== undefined &&
    isImportingFromGrid &&
    gridPowerW > config.thresholds.maxGridImportW
  ) {
    alerts.push({
      key: "max-grid-import",
      device: "solaredge",
      message: `Grid import is ${roundedWatts(gridPowerW)} W, above ${config.thresholds.maxGridImportW} W.`
    });
  }

  if (
    config.thresholds.maxGridExportW !== undefined &&
    isExportingToGrid &&
    gridPowerW > config.thresholds.maxGridExportW
  ) {
    alerts.push({
      key: "max-grid-export",
      device: "solaredge",
      message: `Grid export is ${roundedWatts(gridPowerW)} W, above ${config.thresholds.maxGridExportW} W.`
    });
  }

  if (
    config.thresholds.minBatteryLevelPercent !== undefined &&
    chargeLevel !== undefined &&
    chargeLevel < config.thresholds.minBatteryLevelPercent
  ) {
    alerts.push({
      key: "min-battery-level",
      device: "battery",
      message: `Battery level is ${Math.round(chargeLevel)}%, below ${config.thresholds.minBatteryLevelPercent}%.`,
      sendOnceUntilCleared: true
    });
  }

  if (config.thresholds.batteryCapacityKWh !== undefined) {
    const minutesToFull = minutesUntilBatteryFull(flow, config.thresholds.batteryCapacityKWh);
    const noticeMinutes = config.thresholds.batteryFullNoticeMinutes ?? 5;
    const minChargeRateW = config.thresholds.minBatteryChargeRateW ?? 250;
    const resetBelowPercent = config.thresholds.batteryFullAlertResetBelowPercent ?? 95;

    const resetOnceStateBeforeSending = chargeLevel !== undefined && chargeLevel < resetBelowPercent;

    if (chargeLevel !== undefined && chargeLevel >= 100) {
      alerts.push({
        key: "battery-full",
        device: "battery",
        message: "Battery is full.",
        resetOnceStateBeforeSending,
        sendOnceUntilCleared: true
      });
      alerts.push({
        key: "battery-full-soon",
        device: "battery",
        message: "",
        activeOnly: true,
        primeOnceState: true
      });
    } else if (chargeLevel !== undefined && chargeLevel >= resetBelowPercent) {
      alerts.push({
        key: "battery-full-soon",
        device: "battery",
        message: "",
        activeOnly: true,
        primeOnceState: true
      });
      alerts.push({
        key: "battery-full",
        device: "battery",
        message: "",
        activeOnly: true
      });
    } else if (minutesToFull !== undefined && minutesToFull <= noticeMinutes && storagePowerW >= minChargeRateW) {
      alerts.push({
        key: "battery-full-soon",
        device: "battery",
        message:
          `Battery is expected to be full in about ${Math.max(1, Math.round(minutesToFull))} min ` +
          `at ${roundedWatts(storagePowerW)} W charging power.`,
        resetOnceStateBeforeSending,
        sendOnceUntilCleared: true
      });
    }
  }

  return alerts;
}
