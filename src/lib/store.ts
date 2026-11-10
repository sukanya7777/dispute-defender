// Tiny JSON-file persistence. PayPal stays the source of truth for disputes;
// this only holds what PayPal does not know: merchant order records, the
// agent's case files, settings and a webhook log.
import fs from "node:fs";
import path from "node:path";
import type { CaseFile, OrderRecord, Settings, WebhookLog } from "./types";

interface Db {
  orders: Record<string, OrderRecord>; // keyed by capture id
  cases: Record<string, CaseFile>; // keyed by dispute id
  settings: Settings;
  webhooks: WebhookLog[];
  runCounter: { day: string; count: number };
  mock?: unknown; // state of the PayPal simulator (demo mode only)
}

export const DEFAULT_SETTINGS: Settings = {
  autopilot: false,
  autopilotMaxRefund: 25,
  disputeFee: 15,
  minFightValue: 12,
  storeName: "Kiln & Wire",
  tone: "warm",
  storePolicy: [
    "Returns: unused physical items may be returned within 30 days for a full refund; the customer pays return shipping unless the item arrived damaged or not as described.",
    "Damaged in transit: we replace or fully refund, no return required, when the carrier scan or a photo confirms damage.",
    "Digital goods: non-refundable once the download link has been opened or the license key activated, except where the file is defective.",
    "Shipping: orders ship within 1 business day with tracking; orders above $75 ship signature-required.",
    "Goodwill: for orders under $12 we would rather refund than argue.",
  ].join("\n"),
};

const DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "store.json");

// Survive Next.js dev hot reloads: keep one copy on globalThis.
const g = globalThis as unknown as { __ddDb?: Db; __ddTimer?: NodeJS.Timeout };

function load(): Db {
  if (g.__ddDb) return g.__ddDb;
  let db: Db = {
    orders: {},
    cases: {},
    settings: { ...DEFAULT_SETTINGS },
    webhooks: [],
    runCounter: { day: "", count: 0 },
  };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<Db>;
    db = { ...db, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) } };
    // A run that was mid-flight when the process died can never finish.
    for (const c of Object.values(db.cases)) {
      for (const r of c.runs) {
        if (r.state === "running") {
          r.state = "failed";
          r.error = "Server restarted while the agent was working. Run it again.";
        }
      }
    }
  } catch {
    /* first boot */
  }
  g.__ddDb = db;
  return db;
}

export function db(): Db {
  return load();
}

/** Debounced write so a chatty agent trace does not hammer the disk. */
export function save(): void {
  if (g.__ddTimer) return;
  g.__ddTimer = setTimeout(() => {
    g.__ddTimer = undefined;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(load()));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error("[store] could not persist:", err);
    }
  }, 250);
}

export function getCase(disputeId: string): CaseFile {
  const d = load();
  if (!d.cases[disputeId]) {
    d.cases[disputeId] = { disputeId, runs: [], firstSeenAt: new Date().toISOString() };
    save();
  }
  return d.cases[disputeId];
}

export function peekCase(disputeId: string): CaseFile | undefined {
  return load().cases[disputeId];
}

/** Returns false when today's agent-run budget is spent. */
export function consumeRunBudget(): boolean {
  const d = load();
  const limit = Number(process.env.AGENT_DAILY_RUN_LIMIT || 60);
  const day = new Date().toISOString().slice(0, 10);
  if (d.runCounter.day !== day) d.runCounter = { day, count: 0 };
  if (d.runCounter.count >= limit) return false;
  d.runCounter.count += 1;
  save();
  return true;
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
