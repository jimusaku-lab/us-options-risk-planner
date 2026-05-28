import type {
  BrokerAccountSnapshot,
  BrokerOptionChainSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  SaxoConnectionStatus,
} from "@/types/broker";

export interface BrokerAdapter {
  getConnectionStatus(): Promise<SaxoConnectionStatus>;
  getAccountSnapshot(): Promise<BrokerAccountSnapshot>;
  getPositions(): Promise<BrokerPositionSnapshot[]>;
  getOpenOrders(): Promise<BrokerOrderSnapshot[]>;
  getOptionChain(symbol: string): Promise<BrokerOptionChainSnapshot>;
}
