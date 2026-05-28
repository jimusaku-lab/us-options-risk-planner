import type { BrokerAdapter } from "./BrokerAdapter";
import type {
  BrokerAccountSnapshot,
  BrokerOptionChainSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  SaxoConnectionStatus,
} from "@/types/broker";
import { demoAccountSnapshot, demoPositions } from "@/data/saxoDemoFixtures";

export class ManualBrokerAdapter implements BrokerAdapter {
  async getConnectionStatus(): Promise<SaxoConnectionStatus> {
    return {
      environment: "sim",
      connected: false,
      permissions: [],
    };
  }

  async getAccountSnapshot(): Promise<BrokerAccountSnapshot> {
    return demoAccountSnapshot;
  }

  async getPositions(): Promise<BrokerPositionSnapshot[]> {
    return demoPositions;
  }

  async getOpenOrders(): Promise<BrokerOrderSnapshot[]> {
    return [];
  }

  async getOptionChain(symbol: string): Promise<BrokerOptionChainSnapshot> {
    return {
      underlyingSymbol: symbol,
      underlyingPrice: 0,
      expiries: [],
    };
  }
}
