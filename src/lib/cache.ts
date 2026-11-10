// Short-lived cache of dispute details fetched from PayPal, shared by the
// dashboard sync and the agent's tools.
import type { Dispute } from "./types";

interface Cache {
  details: Map<string, { at: number; dispute: Dispute }>;
  listAt: number;
  list: Dispute[];
}
const g = globalThis as unknown as { __ddCache?: Cache };
export function cache(): Cache {
  if (!g.__ddCache) g.__ddCache = { details: new Map(), listAt: 0, list: [] };
  return g.__ddCache;
}
export function invalidate(disputeId?: string): void {
  const c = cache();
  c.listAt = 0;
  if (disputeId) c.details.delete(disputeId);
  else c.details.clear();
}
