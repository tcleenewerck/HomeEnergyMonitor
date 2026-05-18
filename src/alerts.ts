import type { MonitorConfig } from "./config.js";
import type { CurrentPowerFlow } from "./solaredge.js";

export type Alert = {
  key: string;
  message: string;
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

function hasRoute(flow: CurrentPowerFlow, from: string, to: string): boolean {
  return flow.connections.some((connection) => connection.from === from && connection.to === to);
}

function gridPowerWatts(flow: CurrentPowerFlow): number {
  return toWatts(flow.GRID?.currentPower ?? 0, flow.unit);
}

function pvPowerWatts(flow: CurrentPowerFlow): number {
  return toWatts(flow.PV?.currentPower ?? 0, flow.unit);
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
  const isCharging =
    hasRoute(flow, "PV", "Storage") || hasRoute(flow, "GRID", "Storage") || hasRoute(flow, "LOAD", "Storage");

  if (
    chargeLevel === undefined ||
    chargeLevel < 0 ||
    chargeLevel >= 100 ||
    chargingPowerW <= 0 ||
    !isCharging
  ) {
    return undefined;
  }

  const remainingKWh = batteryCapacityKWh * ((100 - chargeLevel) / 100);
  const chargingPowerKW = chargingPowerW / 1000;

  return (remainingKWh / chargingPowerKW) * 60;
}

export function evaluateAlerts(flow: CurrentPowerFlow, config: MonitorConfig): Alert[] {
  const alerts: Alert[] = [];
  const gridPowerW = gridPowerWatts(flow);
  const pvPowerW = pvPowerWatts(flow);
  const storagePowerW = storagePowerWatts(flow);
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
      message: `Grid export is ${roundedWatts(gridPowerW)} W, above ${config.thresholds.maxGridExportW} W.`
    });
  }

  if (
    config.thresholds.minPvProductionW !== undefined &&
    pvPowerW < config.thresholds.minPvProductionW
  ) {
    alerts.push({
      key: "min-pv-production",
      message: `PV production is ${roundedWatts(pvPowerW)} W, below ${config.thresholds.minPvProductionW} W.`
    });
  }

  if (config.thresholds.batteryCapacityKWh !== undefined) {
    const minutesToFull = minutesUntilBatteryFull(flow, config.thresholds.batteryCapacityKWh);
    const noticeMinutes = config.thresholds.batteryFullNoticeMinutes ?? 5;
    const minChargeRateW = config.thresholds.minBatteryChargeRateW ?? 250;

    if (minutesToFull !== undefined && minutesToFull <= noticeMinutes && storagePowerW >= minChargeRateW) {
      alerts.push({
        key: "battery-full-soon",
        message:
          `Battery is expected to be full in about ${Math.max(1, Math.round(minutesToFull))} min ` +
          `at ${roundedWatts(storagePowerW)} W charging power.`
      });
    }
  }

  return alerts;
}
