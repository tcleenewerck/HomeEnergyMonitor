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

export function evaluateAlerts(flow: CurrentPowerFlow, config: MonitorConfig): Alert[] {
  const alerts: Alert[] = [];
  const gridPowerW = gridPowerWatts(flow);
  const pvPowerW = pvPowerWatts(flow);
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

  return alerts;
}
