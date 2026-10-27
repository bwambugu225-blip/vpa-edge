export class ProviderInterface {
  async initialize() { throw new Error("initialize() is not implemented"); }
  getCapabilities() { throw new Error("getCapabilities() is not implemented"); }
  async getHistory() { throw new Error("getHistory() is not implemented"); }
  subscribeToUpdates() { throw new Error("subscribeToUpdates() is not implemented"); }
  unsubscribe() { throw new Error("unsubscribe() is not implemented"); }
  getHealthStatus() { throw new Error("getHealthStatus() is not implemented"); }
}
