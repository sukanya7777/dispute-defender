// In-process PayPal simulator used when no sandbox credentials are set.
//
// It mirrors the Disputes API lifecycle closely enough that the agent, the
// guardrails and the UI run the exact same code paths as against the sandbox:
//   INQUIRY (send-message / make-offer / accept-claim / escalate)
//     -> CHARGEBACK + UNDER_REVIEW
//     -> WAITING_FOR_SELLER_RESPONSE (provide-evidence / accept-claim)
//     -> UNDER_REVIEW -> RESOLVED
// Which actions are possible is expressed the way PayPal does it: HATEOAS links.
import { db, save } from "./store";
import { PayPalError } from "./paypal-error";
import { buildOrderRecord, CATALOG, encodeCustomId, findProduct, saveOrderRecord } from "./oms";
import type { CaptureResult, PayPalApi } from "./paypal";
import type { Dispute, Money, PayPalLink } from "./types";

interface MockCapture {
  id: string;
  orderId: string;
  create_time: string;
  amount: Money;
  custom_id: string;
  sku: string;
  payer: { name: string; email: string; payerId: string };
  shippingAddress?: string;
  tracking?: { carrier: string; trackingNumber: string };
}

interface MockState {
  seq: number;
  orders: Record<string, { sku: string; customId: string; price: string }>;
  captures: Record<string, MockCapture>;
  disputes: Record<string, Dispute>;
  seeded: boolean;
}

const BUYERS = [
  { name: "Alex Rivera", email: "alex.rivera@example.com", payerId: "BUYERALEX0001", address: "418 Maple Court, Columbus, OH, 43215, US" },
  { name: "Priya Nair", email: "priya.nair@example.com", payerId: "BUYERPRIYA002", address: "92 Harbor Street, Portland, ME, 04101, US" },
  { name: "Jordan Blake", email: "jordan.blake@example.com", payerId: "BUYERJORDAN03", address: "7 Larkspur Lane, Austin, TX, 78704, US" },
  { name: "Sam Okafor", email: "sam.okafor@example.com", payerId: "BUYERSAM00004", address: "1550 Birch Avenue, Denver, CO, 80203, US" },
  { name: "Mei Tanaka", email: "mei.tanaka@example.com", payerId: "BUYERMEI00005", address: "23 Orchard Row, Madison, WI, 53703, US" },
];

export const DISPUTE_PRESETS: Record<string, { reason: string; message: string }> = {
  "KW-HEADPHONES": { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "I never got my headphones. Nothing was delivered to me. I want my money back." },
  "KW-MUG-SET": { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "Tracking stopped updating and the mugs never showed up. Please refund me." },
  "KW-COURSE": { reason: "UNAUTHORISED", message: "I don't recognise this charge. I did not buy any pottery course." },
  "KW-LAMP": { reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", message: "The lamp is black, not brass like the listing. I emailed the store and nobody replied." },
  "KW-STICKERS": { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", message: "Stickers never arrived. It has been ages." },
};

function state(): MockState {
  const d = db();
  if (!d.mock) {
    d.mock = { seq: 1000, orders: {}, captures: {}, disputes: {}, seeded: false } satisfies MockState;
  }
  const s = d.mock as MockState;
  if (!s.seeded) {
    s.seeded = true;
    seed(s);
    save();
  }
  return s;
}

function nextId(s: MockState, prefix: string): string {
  s.seq += 1;
  return `${prefix}${s.seq.toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function links(d: Dispute): PayPalLink[] {
  const base = `https://api-m.sandbox.paypal.com/v1/customer/disputes/${d.dispute_id}`;
  const rels: string[] = ["self"];
  if (d.status !== "RESOLVED") {
    if (d.dispute_life_cycle_stage === "INQUIRY") rels.push("send-message", "make-offer", "accept-claim", "escalate");
    else if (d.status === "WAITING_FOR_SELLER_RESPONSE") rels.push("provide-evidence", "accept-claim");
    else if (d.status === "UNDER_REVIEW") rels.push("provide-supporting-info");
  }
  return rels.map((rel) => ({ rel, href: rel === "self" ? base : `${base}/${rel}`, method: rel === "self" ? "GET" : "POST" }));
}

function touch(d: Dispute): void {
  d.update_time = new Date().toISOString();
  d.links = links(d);
  d.allowed_response_options =
    d.status === "RESOLVED"
      ? undefined
      : { accept_claim: { accept_claim_types: ["REFUND"] }, make_offer: { offer_types: ["REFUND", "REFUND_WITH_RETURN"] } };
  save();
}

function makeCapture(s: MockState, sku: string, buyerIdx: number, createdAt: string): MockCapture {
  const p = findProduct(sku)!;
  const b = BUYERS[buyerIdx % BUYERS.length];
  const cap: MockCapture = {
    id: nextId(s, "CAP"),
    orderId: nextId(s, "ORD"),
    create_time: createdAt,
    amount: { currency_code: "USD", value: p.price },
    custom_id: encodeCustomId(sku),
    sku,
    payer: { name: b.name, email: b.email, payerId: b.payerId },
    shippingAddress: p.category === "DIGITAL_GOODS" ? undefined : b.address,
  };
  s.captures[cap.id] = cap;
  const rec = buildOrderRecord({
    orderId: cap.orderId,
    captureId: cap.id,
    sku,
    createdAt,
    amount: cap.amount,
    buyer: cap.payer,
    shippingAddress: cap.shippingAddress,
  });
  if (rec) saveOrderRecord(rec);
  return cap;
}

function openDispute(s: MockState, cap: MockCapture, reason: string, message: string, createdAt: string): Dispute {
  const p = findProduct(cap.sku)!;
  const d: Dispute = {
    dispute_id: nextId(s, "PP-D-"),
    create_time: createdAt,
    reason,
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_state: "REQUIRED_ACTION",
    dispute_life_cycle_stage: "INQUIRY",
    dispute_channel: "INTERNAL",
    dispute_amount: cap.amount,
    seller_response_due_date: new Date(new Date(createdAt).getTime() + 10 * 86_400_000).toISOString(),
    disputed_transactions: [
      {
        seller_transaction_id: cap.id,
        buyer_transaction_id: cap.id.replace("CAP", "BTX"),
        create_time: cap.create_time,
        transaction_status: "COMPLETED",
        gross_amount: cap.amount,
        custom: cap.custom_id,
        buyer: { name: cap.payer.name, email: cap.payer.email, payer_id: cap.payer.payerId },
        seller: { name: "Kiln & Wire", merchant_id: "SIMMERCHANT01" },
        items: [{ item_id: p.sku, item_name: p.name, item_description: p.description, item_quantity: "1" }],
        seller_protection_eligible: p.category === "PHYSICAL_GOODS",
      },
    ],
    messages: [{ posted_by: "BUYER", time_posted: createdAt, content: message }],
    evidences: [],
  };
  touch(d);
  s.disputes[d.dispute_id] = d;
  return d;
}

function seed(s: MockState): void {
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  // Five live disputes, one per product, so every strategy is on show.
  CATALOG.forEach((p, i) => {
    const cap = makeCapture(s, p.sku, i, ago(30 + i * 7));
    const preset = DISPUTE_PRESETS[p.sku];
    openDispute(s, cap, preset.reason, preset.message, ago(4 + i * 3));
  });
}

function mustGet(id: string): Dispute {
  const d = state().disputes[id];
  if (!d) throw new PayPalError(404, "RESOURCE_NOT_FOUND", `Dispute ${id} does not exist.`, "sim-debug");
  return d;
}

function requireLink(d: Dispute, rel: string): void {
  if (!links(d).some((l) => l.rel === rel)) {
    throw new PayPalError(
      422,
      "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE",
      `'${rel}' is not allowed while the dispute is ${d.status} at stage ${d.dispute_life_cycle_stage}.`,
      "sim-debug",
    );
  }
}

function resolve(d: Dispute, outcome: "RESOLVED_BUYER_FAVOUR" | "RESOLVED_SELLER_FAVOUR", refunded?: Money): void {
  d.status = "RESOLVED";
  d.dispute_state = "RESOLVED";
  d.dispute_outcome = {
    outcome_code: outcome,
    amount_refunded: refunded ?? (outcome === "RESOLVED_BUYER_FAVOUR" ? d.dispute_amount : { currency_code: d.dispute_amount.currency_code, value: "0.00" }),
  };
  touch(d);
}

export const mockPayPal: PayPalApi = {
  mode: "simulator",

  async listDisputes() {
    // The real list endpoint returns summaries without messages or evidence.
    return Object.values(state().disputes)
      .map(({ messages: _m, evidences: _e, ...rest }) => ({ ...rest }) as Dispute)
      .sort((a, b) => b.create_time.localeCompare(a.create_time));
  },

  async getDispute(id) {
    return structuredClone(mustGet(id));
  },

  async sendMessage(id, message) {
    const d = mustGet(id);
    requireLink(d, "send-message");
    d.messages = [...(d.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: message }];
    d.status = "WAITING_FOR_BUYER_RESPONSE";
    d.dispute_state = "REQUIRED_OTHER_PARTY_ACTION";
    touch(d);
  },

  async makeOffer(id, offer) {
    const d = mustGet(id);
    requireLink(d, "make-offer");
    if (offer.offer_amount && Number(offer.offer_amount.value) > Number(d.dispute_amount.value)) {
      throw new PayPalError(422, "INVALID_OFFER_AMOUNT", "The offer amount cannot exceed the dispute amount.", "sim-debug");
    }
    d.offer = { seller_offered_amount: offer.offer_amount ?? d.dispute_amount, offer_type: offer.offer_type };
    d.messages = [...(d.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: offer.note }];
    d.status = "WAITING_FOR_BUYER_RESPONSE";
    d.dispute_state = "REQUIRED_OTHER_PARTY_ACTION";
    touch(d);
  },

  async provideEvidence(id, evidence, pdf) {
    const d = mustGet(id);
    requireLink(d, "provide-evidence");
    d.evidences = [
      ...(d.evidences ?? []),
      {
        evidence_type: evidence.evidence_type,
        source: "SUBMITTED_BY_SELLER",
        notes: evidence.notes + (pdf ? `\n[attached: evidence-${id}.pdf, ${pdf.byteLength} bytes]` : ""),
        ...(evidence.tracking ? { evidence_info: { tracking_info: [evidence.tracking] } } : {}),
      },
    ];
    d.status = "UNDER_REVIEW";
    d.dispute_state = "UNDER_PAYPAL_REVIEW";
    touch(d);
  },

  async provideSupportingInfo(id, notes, pdf) {
    const d = mustGet(id);
    requireLink(d, "provide-supporting-info");
    d.evidences = [...(d.evidences ?? []), { evidence_type: "OTHER", source: "SUBMITTED_BY_SELLER", notes: notes + (pdf ? `\n[attached: supporting-info-${id}.pdf, ${pdf.byteLength} bytes]` : "") }];
    touch(d);
  },

  async acceptClaim(id, body) {
    const d = mustGet(id);
    requireLink(d, "accept-claim");
    d.messages = [...(d.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: body.note }];
    resolve(d, "RESOLVED_BUYER_FAVOUR");
  },

  async escalate(id, note) {
    const d = mustGet(id);
    requireLink(d, "escalate");
    d.messages = [...(d.messages ?? []), { posted_by: "SELLER", time_posted: new Date().toISOString(), content: note }];
    d.dispute_life_cycle_stage = "CHARGEBACK";
    d.status = "UNDER_REVIEW";
    d.dispute_state = "UNDER_PAYPAL_REVIEW";
    touch(d);
  },

  async sandboxRequireEvidence(id, action) {
    const d = mustGet(id);
    if (d.status === "RESOLVED") throw new PayPalError(422, "DISPUTE_ALREADY_RESOLVED", "The dispute is resolved.", "sim-debug");
    if (d.dispute_life_cycle_stage === "INQUIRY") {
      throw new PayPalError(422, "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "Evidence can only be requested once the dispute is a claim. Escalate it first.", "sim-debug");
    }
    if (action === "SELLER_EVIDENCE") {
      d.status = "WAITING_FOR_SELLER_RESPONSE";
      d.dispute_state = "REQUIRED_ACTION";
      d.seller_response_due_date = new Date(Date.now() + 10 * 86_400_000).toISOString();
      d.evidences = [...(d.evidences ?? []), { evidence_type: d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" ? "PROOF_OF_FULFILLMENT" : "OTHER", source: "REQUESTED_FROM_SELLER" }];
    } else {
      d.status = "WAITING_FOR_BUYER_RESPONSE";
      d.dispute_state = "REQUIRED_OTHER_PARTY_ACTION";
    }
    touch(d);
  },

  async sandboxAdjudicate(id, outcome) {
    const d = mustGet(id);
    if (d.status === "RESOLVED") throw new PayPalError(422, "DISPUTE_ALREADY_RESOLVED", "The dispute is resolved.", "sim-debug");
    if (d.dispute_life_cycle_stage === "INQUIRY") {
      throw new PayPalError(422, "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "PayPal only rules on claims. Escalate the dispute first.", "sim-debug");
    }
    resolve(d, outcome === "SELLER_FAVOR" ? "RESOLVED_SELLER_FAVOUR" : "RESOLVED_BUYER_FAVOUR");
  },

  async createOrder({ sku, price, customId }) {
    const s = state();
    const id = nextId(s, "ORD");
    s.orders[id] = { sku, customId, price };
    save();
    return { id };
  },

  async captureOrder(orderId) {
    const s = state();
    const o = s.orders[orderId];
    if (!o) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "Order not found.", "sim-debug");
    const buyerIdx = Object.keys(s.captures).length;
    const b = BUYERS[buyerIdx % BUYERS.length];
    const p = findProduct(o.sku)!;
    const cap: MockCapture = {
      id: nextId(s, "CAP"),
      orderId,
      create_time: new Date().toISOString(),
      amount: { currency_code: "USD", value: o.price },
      custom_id: o.customId,
      sku: o.sku,
      payer: { name: b.name, email: b.email, payerId: b.payerId },
      shippingAddress: p.category === "DIGITAL_GOODS" ? undefined : b.address,
    };
    s.captures[cap.id] = cap;
    save();
    const result: CaptureResult = {
      orderId,
      captureId: cap.id,
      createTime: cap.create_time,
      amount: cap.amount,
      customId: cap.custom_id,
      payer: cap.payer,
      shippingAddress: cap.shippingAddress,
      sellerProtection: p.category === "PHYSICAL_GOODS" ? { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] } : { status: "NOT_ELIGIBLE" },
    };
    return result;
  },

  async addTracking(_orderId, captureId, carrier, trackingNumber) {
    const cap = state().captures[captureId];
    if (cap) {
      cap.tracking = { carrier, trackingNumber };
      save();
    }
  },

  async getCapture(captureId) {
    const cap = state().captures[captureId];
    if (!cap) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "Capture not found.", "sim-debug");
    const physical = findProduct(cap.sku)?.category === "PHYSICAL_GOODS";
    return {
      id: cap.id,
      create_time: cap.create_time,
      amount: cap.amount,
      custom_id: cap.custom_id,
      status: "COMPLETED",
      seller_protection: physical ? { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] } : { status: "NOT_ELIGIBLE" },
    };
  },

  async verifyWebhook() {
    return "skipped";
  },
};

// --- Simulator-only buyer actions (in the sandbox the buyer does these at
// --- sandbox.paypal.com, so they have no API equivalent for the seller).

export function simFileDispute(captureId: string, reason: string, message: string): Dispute {
  const s = state();
  const cap = s.captures[captureId];
  if (!cap) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "Capture not found.", "sim-debug");
  if (Object.values(s.disputes).some((d) => d.disputed_transactions?.[0]?.seller_transaction_id === captureId)) {
    throw new PayPalError(422, "DUPLICATE_DISPUTE", "A dispute already exists for this transaction.", "sim-debug");
  }
  const d = openDispute(s, cap, reason, message, new Date().toISOString());
  save();
  return d;
}

export function simBuyerAcceptsOffer(id: string): void {
  const d = mustGet(id);
  if (!d.offer || d.status === "RESOLVED") throw new PayPalError(422, "NO_OPEN_OFFER", "There is no open offer on this dispute.", "sim-debug");
  resolve(d, "RESOLVED_BUYER_FAVOUR", d.offer.seller_offered_amount);
}

export function simBuyerReplies(id: string, message: string): void {
  const d = mustGet(id);
  if (d.status === "RESOLVED") throw new PayPalError(422, "DISPUTE_ALREADY_RESOLVED", "The dispute is resolved.", "sim-debug");
  d.messages = [...(d.messages ?? []), { posted_by: "BUYER", time_posted: new Date().toISOString(), content: message }];
  if (d.dispute_life_cycle_stage === "INQUIRY") {
    d.status = "WAITING_FOR_SELLER_RESPONSE";
    d.dispute_state = "REQUIRED_ACTION";
  }
  touch(d);
}

export function simBuyerEscalates(id: string): void {
  const d = mustGet(id);
  if (d.dispute_life_cycle_stage !== "INQUIRY" || d.status === "RESOLVED") {
    throw new PayPalError(422, "ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "Only an open inquiry can be escalated.", "sim-debug");
  }
  d.dispute_life_cycle_stage = "CHARGEBACK";
  d.status = "WAITING_FOR_SELLER_RESPONSE";
  d.dispute_state = "REQUIRED_ACTION";
  d.evidences = [...(d.evidences ?? []), { evidence_type: d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" ? "PROOF_OF_FULFILLMENT" : "OTHER", source: "REQUESTED_FROM_SELLER" }];
  touch(d);
}

export function simReset(): void {
  const d = db();
  d.mock = undefined;
  d.cases = {};
  d.orders = {};
  save();
}
