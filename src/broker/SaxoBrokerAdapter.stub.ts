import type { BrokerAdapter } from "./BrokerAdapter";
import type {
  BrokerAccountSnapshot,
  BrokerOptionChainSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  SaxoConnectionStatus,
} from "@/types/broker";

export class SaxoBrokerAdapterStub implements BrokerAdapter {
  async getConnectionStatus(): Promise<SaxoConnectionStatus> {
    return {
      environment: "sim",
      connected: false,
      permissions: ["read"],
    };
  }

  async getAccountSnapshot(): Promise<BrokerAccountSnapshot> {
    throw new Error("Saxo OpenAPI Read Only連携はMVPでは未実装です。");
  }

  async getPositions(): Promise<BrokerPositionSnapshot[]> {
    throw new Error("Saxo OpenAPI Read Only連携はMVPでは未実装です。");
  }

  async getOpenOrders(): Promise<BrokerOrderSnapshot[]> {
    throw new Error("Saxo OpenAPI Read Only連携はMVPでは未実装です。");
  }

  async getOptionChain(_symbol: string): Promise<BrokerOptionChainSnapshot> {
    throw new Error("Saxo OpenAPI Read Only連携はMVPでは未実装です。");
  }
}
