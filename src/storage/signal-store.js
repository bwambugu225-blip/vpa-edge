const STORAGE_KEY = "vpaEdgeSignals";

export async function loadSignals() {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  const signals = result[STORAGE_KEY];
  if (!Array.isArray(signals)) throw new TypeError("Stored VPA Edge signals are invalid");
  return signals;
}

export async function saveSignals(signals) {
  if (!Array.isArray(signals)) throw new TypeError("Signals must be an array");
  await chrome.storage.local.set({ [STORAGE_KEY]: signals });
}

export async function persistSignals(additions) {
  const existing = await loadSignals();
  const byId = new Map(existing.map((signal) => [signal.id, signal]));
  for (const signal of additions) {
    if (!byId.has(signal.id)) byId.set(signal.id, signal);
  }
  const signals = [...byId.values()];
  await saveSignals(signals);
  return signals;
}
