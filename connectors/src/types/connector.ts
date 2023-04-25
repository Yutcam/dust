const CONNECTOR_PROVIDERS = ["slack", "notion"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export function isConnectorProvider(val: string): val is ConnectorProvider {
  return (CONNECTOR_PROVIDERS as unknown as string[]).includes(val);
}

export type ConnectorSyncStatus = "succeeded" | "failed";
