// Hard limits on what the agent may do with the seller's money. These are
// plain code, checked when an action is staged and again right before it is
// sent, so they hold no matter what the model (or a manipulative buyer
// message) says.
import { allowedActions, num } from "./paypal";
import type { ActionType, Dispute, Settings, StagedAction } from "./types";

/** Our action -> the PayPal HATEOAS rel that must be present on the dispute. */
export const PAYPAL_REL: Record<ActionType, string> = {
  send_message: "send-message",
  make_offer: "make-offer",
  provide_evidence: "provide-evidence",
  accept_claim: "accept-claim",
  escalate_to_claim: "escalate",
};

const TEXT_FIELDS: Record<ActionType, string[]> = {
  send_message: ["message"],
  make_offer: ["note"],
  provide_evidence: ["notes"],
  accept_claim: ["note"],
  escalate_to_claim: ["note"],
};

/** Returns why the action can never be sent as it stands, or null if it is fine. */
export function checkAction(action: StagedAction, d: Dispute): string | null {
  const rel = PAYPAL_REL[action.type];
  const allowed = allowedActions(d);
  if (!allowed.includes(rel)) {
    return `PayPal does not allow '${rel}' on this dispute right now (status ${d.status}, stage ${d.dispute_life_cycle_stage}). Allowed: ${allowed.join(", ") || "none"}.`;
  }
  for (const f of TEXT_FIELDS[action.type]) {
    const v = action.input[f];
    if (typeof v !== "string" || !v.trim()) return `'${f}' is empty.`;
    if (v.length > 2000) return `'${f}' is ${v.length} characters; PayPal's limit is 2,000.`;
  }
  if (action.type === "make_offer") {
    const amount = Number(action.input.amount);
    const max = num(d.dispute_amount);
    if (!Number.isFinite(amount) || amount <= 0) return "The offer amount must be greater than zero.";
    if (amount > max + 0.001) return `The offer (${amount.toFixed(2)}) exceeds the disputed amount (${max.toFixed(2)}).`;
    const types = d.allowed_response_options?.make_offer?.offer_types;
    if (types?.length && !types.includes(String(action.input.offer_type))) {
      return `PayPal only allows these offer types here: ${types.join(", ")}.`;
    }
  }
  if (action.type === "provide_evidence" && typeof action.input.letter !== "string") return "The evidence letter is missing.";
  return null;
}

/** How much of the seller's money this action gives away. */
export function refundExposure(action: StagedAction, d: Dispute): number {
  if (action.type === "accept_claim") return num(d.dispute_amount);
  if (action.type === "make_offer") return Number(action.input.amount) || 0;
  return 0;
}

/** Returns why autopilot must hand this action to a human, or null if it may run. */
export function needsHuman(action: StagedAction, d: Dispute, s: Settings): string | null {
  const exposure = refundExposure(action, d);
  if (exposure > s.autopilotMaxRefund) {
    return `Refunding ${exposure.toFixed(2)} ${d.dispute_amount.currency_code} is above the autopilot limit of ${s.autopilotMaxRefund.toFixed(2)}.`;
  }
  return null;
}
