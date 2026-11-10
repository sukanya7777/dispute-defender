// Pulls disputes from PayPal, joins them with the agent's case files, and
// starts the agent on anything that newly needs the seller's attention.
import { aiConfigured, disputeSnapshot, isRunning, startRun } from "./agent";
import { cache } from "./cache";
import { allowedActions, num, paypal } from "./paypal";
import { db, peekCase } from "./store";
import type { AgentRun, Dispute, DisputeRow } from "./types";

const LIST_TTL = 6_000;
const OPEN_TTL = 12_000;
const RESOLVED_TTL = 5 * 60_000;

export async function getDetail(id: string, fresh = false): Promise<Dispute> {
  const c = cache();
  const hit = c.details.get(id);
  if (hit && !fresh) {
    const ttl = hit.dispute.status === "RESOLVED" ? RESOLVED_TTL : OPEN_TTL;
    if (Date.now() - hit.at < ttl) return hit.dispute;
  }
  const dispute = await paypal().getDispute(id);
  c.details.set(id, { at: Date.now(), dispute });
  return dispute;
}

export function latestRun(disputeId: string): AgentRun | undefined {
  return peekCase(disputeId)?.runs.at(-1);
}

const NEEDS_SELLER = new Set(["WAITING_FOR_SELLER_RESPONSE", "OPEN"]);

function maybeAnalyze(d: Dispute, trigger: "new_dispute" | "status_change" | "webhook"): void {
  // The seller can act when PayPal is waiting for them, or while PayPal is
  // reviewing and still accepts supporting information.
  const canAct = NEEDS_SELLER.has(d.status) || (d.status === "UNDER_REVIEW" && allowedActions(d).includes("provide-supporting-info"));
  if (!aiConfigured() || d.status === "RESOLVED" || !canAct || isRunning(d.dispute_id)) return;
  const last = latestRun(d.dispute_id);
  const snap = disputeSnapshot(d);
  if (last && last.snapshot === snap) return; // already handled this exact situation
  startRun(d.dispute_id, last ? (trigger === "webhook" ? "webhook" : "status_change") : trigger, snap);
}

export interface Kpis {
  open: number;
  atRisk: number;
  awaitingApproval: number;
  won: number;
  wonAmount: number;
  lost: number;
  refundedAmount: number;
  winRate: number | null;
  avgResponseMinutes: number | null;
  currency: string;
}

export async function syncAll(opts: { fresh?: boolean; trigger?: "webhook" } = {}): Promise<{ rows: DisputeRow[]; kpis: Kpis }> {
  const c = cache();
  if (opts.fresh || Date.now() - c.listAt > LIST_TTL) {
    c.list = await paypal().listDisputes();
    c.listAt = Date.now();
  }
  // The list endpoint returns summaries; the thread, evidence requests and
  // HATEOAS links only come with the detail call.
  const details = await Promise.all(
    c.list.map((s) =>
      getDetail(s.dispute_id, opts.fresh).catch(() => s), // fall back to the summary
    ),
  );

  const rows: DisputeRow[] = [];
  const k: Kpis = { open: 0, atRisk: 0, awaitingApproval: 0, won: 0, wonAmount: 0, lost: 0, refundedAmount: 0, winRate: null, avgResponseMinutes: null, currency: "USD" };
  const responseTimes: number[] = [];

  for (const d of details) {
    maybeAnalyze(d, opts.trigger ?? "new_dispute");
    const run = latestRun(d.dispute_id);
    const withAssessment = [...(peekCase(d.dispute_id)?.runs ?? [])].reverse().find((r) => r.assessment);
    const tx = d.disputed_transactions?.[0];
    const amount = num(d.dispute_amount);
    const outcome = d.dispute_outcome?.outcome_code;
    k.currency = d.dispute_amount.currency_code || k.currency;

    if (d.status === "RESOLVED") {
      if (outcome === "RESOLVED_SELLER_FAVOUR" || outcome === "CANCELED_BY_BUYER" || outcome === "DENIED") {
        k.won += 1;
        k.wonAmount += amount;
      } else {
        k.lost += 1;
        k.refundedAmount += num(d.dispute_outcome?.amount_refunded) || amount;
      }
    } else {
      k.open += 1;
      k.atRisk += amount;
    }
    if (run?.state === "awaiting_approval") k.awaitingApproval += 1;
    // Time from the agent first seeing the dispute to the first reply sent.
    const cf = peekCase(d.dispute_id);
    if (cf?.firstResponseAt) responseTimes.push((new Date(cf.firstResponseAt).getTime() - new Date(cf.firstSeenAt).getTime()) / 60_000);

    rows.push({
      dispute_id: d.dispute_id,
      reason: d.reason,
      status: d.status,
      stage: d.dispute_life_cycle_stage,
      amount,
      currency: d.dispute_amount.currency_code,
      created: d.create_time,
      due: d.status === "WAITING_FOR_SELLER_RESPONSE" ? d.seller_response_due_date : undefined,
      buyer: tx?.buyer?.name,
      item: tx?.items?.[0]?.item_name,
      outcome,
      strategy: withAssessment?.assessment?.strategy,
      winProbability: withAssessment?.assessment?.win_probability,
      headline: withAssessment?.assessment?.headline,
      agentState: run?.state ?? "not_analyzed",
    });
  }
  if (k.won + k.lost > 0) k.winRate = Math.round((k.won / (k.won + k.lost)) * 100);
  if (responseTimes.length) k.avgResponseMinutes = Math.max(0, Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length));
  rows.sort((a, b) => b.created.localeCompare(a.created));
  return { rows, kpis: k };
}

export function publicSettings() {
  return db().settings;
}
