// Shapes shared between the server (agent, PayPal client, store) and the UI.

export interface Money {
  currency_code: string;
  value: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

/** Subset of the PayPal Disputes v1 `dispute` object that we rely on. */
export interface Dispute {
  dispute_id: string;
  create_time: string;
  update_time?: string;
  reason: string;
  status: string;
  dispute_state?: string;
  dispute_life_cycle_stage: string;
  dispute_channel?: string;
  dispute_amount: Money;
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  dispute_outcome?: { outcome_code?: string; amount_refunded?: Money };
  disputed_transactions?: Array<{
    buyer_transaction_id?: string;
    seller_transaction_id?: string;
    create_time?: string;
    transaction_status?: string;
    gross_amount?: Money;
    invoice_number?: string;
    custom?: string;
    buyer?: { name?: string; email?: string; payer_id?: string };
    seller?: { name?: string; email?: string; merchant_id?: string };
    items?: Array<{ item_id?: string; item_name?: string; item_description?: string; item_quantity?: string; notes?: string; reason?: string }>;
    seller_protection_eligible?: boolean;
  }>;
  messages?: Array<{ posted_by: string; time_posted: string; content: string }>;
  evidences?: Array<{
    evidence_type?: string;
    source?: string;
    notes?: string;
    evidence_info?: { tracking_info?: Array<{ carrier_name: string; tracking_number: string }> };
  }>;
  refund_details?: { allowed_refund_amount?: Money };
  adjudications?: Array<{ type?: string; adjudication_time?: string; reason?: string }>;
  supporting_info?: Array<{ notes?: string; source?: string; provided_time?: string; documents?: Array<{ name?: string }> }>;
  offer?: { buyer_requested_amount?: Money; seller_offered_amount?: Money; offer_type?: string };
  allowed_response_options?: {
    accept_claim?: { accept_claim_types?: string[] };
    make_offer?: { offer_types?: string[] };
  };
  links?: PayPalLink[];
}

/** One step of the simulated merchant order-management system. */
export interface TrackingEvent {
  time: string;
  status: string;
  location: string;
  detail?: string;
}

export interface OrderRecord {
  orderId: string;
  captureId: string;
  sku: string;
  productName: string;
  category: "PHYSICAL_GOODS" | "DIGITAL_GOODS";
  amount: Money;
  createdAt: string;
  buyer: { name?: string; email?: string; payerId?: string };
  shippingAddress?: string;
  listing: { description: string; condition: string; url: string };
  fulfillment:
    | {
        type: "SHIPMENT";
        carrier: string;
        trackingNumber: string;
        service: string;
        shipToMatchesPayPalAddress: boolean;
        signatureRequired: boolean;
        signedBy?: string;
        packageWeightGrams: number;
        events: TrackingEvent[];
        deliveryStatus: "DELIVERED" | "IN_TRANSIT" | "EXCEPTION" | "LABEL_CREATED";
      }
    | {
        type: "DIGITAL";
        accessLogs: Array<{ time: string; action: string; ip: string; device: string; detail?: string }>;
        licenseKey: string;
      };
  supportThread: Array<{ time: string; from: "customer" | "store"; text: string }>;
  internalNotes: string[];
  /** true when rebuilt from PayPal data because the local record was lost. */
  reconstructed?: boolean;
}

export type Strategy = "FIGHT" | "NEGOTIATE" | "SETTLE" | "ACCEPT" | "WAIT";

export interface Assessment {
  strategy: Strategy;
  win_probability: number;
  evidence_strength: "STRONG" | "MODERATE" | "WEAK";
  headline: string;
  buyer_claim_summary: string;
  reasoning: string;
  expected_value: {
    fight_expected_recovery: number;
    fight_expected_cost: number;
    concede_cost: number;
    recommended_net: number;
  };
  risk_flags: string[];
}

export type ActionType = "send_message" | "make_offer" | "provide_evidence" | "provide_supporting_info" | "refund_payment" | "accept_claim" | "escalate_to_claim";

export interface StagedAction {
  id: string;
  type: ActionType;
  input: Record<string, unknown>;
  status: "staged" | "executed" | "failed" | "rejected" | "blocked";
  /** Why a guardrail blocked it, or the PayPal error. */
  detail?: string;
  executedAt?: string;
  paypalDebugId?: string;
}

export interface TraceEvent {
  t: string;
  kind: "status" | "thinking" | "text" | "tool_call" | "tool_result" | "error" | "guardrail";
  title: string;
  body?: string;
  data?: unknown;
}

export interface AgentRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  trigger: "new_dispute" | "status_change" | "manual" | "webhook";
  /** Dispute status + stage at the time of the run. */
  snapshot: string;
  state: "running" | "awaiting_approval" | "executed" | "rejected" | "failed" | "no_action";
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  assessment?: Assessment;
  actions: StagedAction[];
  trace: TraceEvent[];
  error?: string;
}

export interface CaseFile {
  disputeId: string;
  runs: AgentRun[];
  firstSeenAt: string;
  /** Set when we first respond through the API: used for response-time KPI. */
  firstResponseAt?: string;
}

export interface Settings {
  autopilot: boolean;
  /** Autopilot may refund/offer at most this much without a human. */
  autopilotMaxRefund: number;
  /** Cost the seller pays when a claim is lost (PayPal dispute fee). */
  disputeFee: number;
  /** Below this order value, conceding beats the time cost of fighting. */
  minFightValue: number;
  storeName: string;
  storePolicy: string;
  tone: "warm" | "neutral" | "firm";
}

export interface WebhookLog {
  id: string;
  receivedAt: string;
  eventType: string;
  disputeId?: string;
  verified: "verified" | "failed" | "skipped";
}

export interface DisputeRow {
  dispute_id: string;
  reason: string;
  status: string;
  stage: string;
  amount: number;
  currency: string;
  created: string;
  due?: string;
  buyer?: string;
  item?: string;
  outcome?: string;
  strategy?: Strategy;
  winProbability?: number;
  agentState?: AgentRun["state"] | "not_analyzed";
  headline?: string;
}
