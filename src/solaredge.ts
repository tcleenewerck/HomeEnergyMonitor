export type SolarEdgeConnection = {
  status: "Active" | "Idle" | "Disabled" | string;
  currentPower: number;
  chargeLevel?: number;
  critical?: boolean;
};

export type SolarEdgePowerRoute = {
  from: "GRID" | "LOAD" | "PV" | "Storage" | string;
  to: "GRID" | "LOAD" | "PV" | "Storage" | string;
};

export type CurrentPowerFlow = {
  unit: string;
  connections: SolarEdgePowerRoute[];
  GRID?: SolarEdgeConnection;
  LOAD?: SolarEdgeConnection;
  PV?: SolarEdgeConnection;
  STORAGE?: SolarEdgeConnection;
  Storage?: SolarEdgeConnection;
};

type SolarEdgeCurrentPowerFlowResponse = {
  siteCurrentPowerFlow: CurrentPowerFlow;
};

export async function fetchCurrentPowerFlow(options: {
  siteId: string;
  apiKey: string;
}): Promise<CurrentPowerFlow> {
  const url = new URL(
    `https://monitoringapi.solaredge.com/site/${encodeURIComponent(options.siteId)}/currentPowerFlow.json`
  );
  url.searchParams.set("api_key", options.apiKey);

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SolarEdge API returned ${response.status}: ${body}`);
  }

  const data = (await response.json()) as SolarEdgeCurrentPowerFlowResponse;

  if (!data.siteCurrentPowerFlow) {
    throw new Error("SolarEdge API response did not contain siteCurrentPowerFlow.");
  }

  return data.siteCurrentPowerFlow;
}
