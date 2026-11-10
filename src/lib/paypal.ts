// PayPal REST client (sandbox). Covers the three PayPal surfaces the product
// is built on:
//   - Disputes v1  : list / show / send-message / make-offer / provide-evidence
//                    / accept-claim / escalate (+ the sandbox-only
//                    require-evidence and adjudicate endpoints)
//   - Orders v2    : create, capture and add shipment tracking (demo store)
//   - Webhooks v1  : verify-webhook-signature for CUSTOMER.DISPUTE.* events
//
// When no credentials are configured the same interface is served by an
// in-process simulator (paypal-mock.ts) so the app can be tried end to end.
import type { Dispute, Money } from "./types";
import { mockPayPal } from "./paypal-mock";
import { PayPalError } from "./paypal-error";

const BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

export { PayPalError };

export interface CaptureResult {
  orderId: string;
  captureId: string;
  createTime: string;
  amount: Money;
  customId?: string;
  payer: { name?: string; email?: string; payerId?: string };
  shippingAddress?: string;
  sellerProtection?: { status?: string; dispute_categories?: string[] };
}

export interface EvidenceInput {
  evidence_type: string;
  notes: string;
  tracking?: { carrier_name: string; tracking_number: string };
}

export interface PayPalApi {
  mode: "sandbox" | "simulator";
  listDisputes(): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute>;
  sendMessage(id: string, message: string): Promise<void>;
  makeOffer(id: string, offer: { note: string; offer_type: string; offer_amount?: Money }): Promise<void>;
  provideEvidence(id: string, evidence: EvidenceInput, pdf?: Uint8Array): Promise<void>;
  provideSupportingInfo(id: string, notes: string, pdf?: Uint8Array): Promise<void>;
  acceptClaim(id: string, body: { note: string; accept_claim_type?: string }): Promise<void>;
  escalate(id: string, note: string): Promise<void>;
  sandboxRequireEvidence(id: string, action: "BUYER_EVIDENCE" | "SELLER_EVIDENCE"): Promise<void>;
  sandboxAdjudicate(id: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR"): Promise<void>;
  createOrder(input: { sku: string; name: string; description: string; price: string; category: string; customId: string }): Promise<{ id: string }>;
  captureOrder(orderId: string): Promise<CaptureResult>;
  addTracking(orderId: string, captureId: string, carrier: string, trackingNumber: string): Promise<void>;
  getCapture(captureId: string): Promise<{ id: string; create_time: string; amount: Money; custom_id?: string; seller_protection?: { status?: string; dispute_categories?: string[] }; status?: string }>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<"verified" | "failed" | "skipped">;
}

// ---------------------------------------------------------------------------

let token: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const id = process.env.PAYPAL_CLIENT_ID!;
  const secret = process.env.PAYPAL_CLIENT_SECRET!;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new PayPalError(res.status, "AUTH_FAILED", json.error_description || "Could not get a PayPal access token. Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.");
  }
  token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
  return token.value;
}

async function call<T>(method: string, path: string, body?: unknown, extra?: { form?: FormData; rawBody?: string; headers?: Record<string, string> }): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    ...(extra?.headers ?? {}),
  };
  let payload: BodyInit | undefined;
  if (extra?.form) payload = extra.form; // fetch sets the multipart boundary
  else if (extra?.rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = extra.rawBody;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, { method, headers, body: payload, cache: "no-store" });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const details = json.details as Array<{ issue?: string; description?: string }> | undefined;
    const first = details?.[0];
    throw new PayPalError(
      res.status,
      String(first?.issue || json.name || `HTTP_${res.status}`),
      String(first?.description || json.message || text.slice(0, 300) || res.statusText),
      (json.debug_id as string) || res.headers.get("paypal-debug-id") || undefined,
      details,
    );
  }
  return json as T;
}

function formatAddress(a: Record<string, string> | undefined): string | undefined {
  if (!a) return undefined;
  return [a.address_line_1, a.address_line_2, a.admin_area_2, a.admin_area_1, a.postal_code, a.country_code].filter(Boolean).join(", ");
}

const real: PayPalApi = {
  mode: "sandbox",

  async listDisputes() {
    const out: Dispute[] = [];
    let url: string | undefined = "/v1/customer/disputes?page_size=50";
    for (let page = 0; url && page < 4; page++) {
      const res: { items?: Dispute[]; links?: Array<{ rel: string; href: string }> } = await call("GET", url);
      out.push(...(res.items ?? []));
      url = res.links?.find((l) => l.rel === "next")?.href;
    }
    return out;
  },

  getDispute: (id) => call<Dispute>("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`),

  async sendMessage(id, message) {
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, { message });
  },

  async makeOffer(id, offer) {
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, offer);
  },

  async provideEvidence(id, evidence, pdf) {
    // multipart/form-data: a JSON `input` part plus the evidence document.
    const input = {
      evidences: [
        {
          evidence_type: evidence.evidence_type,
          notes: evidence.notes,
          ...(evidence.tracking ? { evidence_info: { tracking_info: [evidence.tracking] } } : {}),
        },
      ],
    };
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
    if (pdf) form.append("file1", new Blob([pdf as BlobPart], { type: "application/pdf" }), `evidence-${id}.pdf`);
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, undefined, { form });
  },

  async provideSupportingInfo(id, notes, pdf) {
    // Available while PayPal is reviewing a claim: extra notes and documents
    // for the reviewer, without a formal evidence request.
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify({ notes })], { type: "application/json" }), "input.json");
    if (pdf) form.append("file1", new Blob([pdf as BlobPart], { type: "application/pdf" }), `supporting-info-${id}.pdf`);
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-supporting-info`, undefined, { form });
  },

  async acceptClaim(id, body) {
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, body);
  },

  async escalate(id, note) {
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/escalate`, { note });
  },

  async sandboxRequireEvidence(id, action) {
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/require-evidence`, { action });
  },

  async sandboxAdjudicate(id, outcome) {
    await call("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/adjudicate`, { adjudication_outcome: outcome });
  },

  async createOrder({ sku, name, description, price, category, customId }) {
    const res = await call<{ id: string }>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: sku,
            custom_id: customId,
            description: name,
            amount: { currency_code: "USD", value: price, breakdown: { item_total: { currency_code: "USD", value: price } } },
            items: [{ name, description: description.slice(0, 127), sku, quantity: "1", category, unit_amount: { currency_code: "USD", value: price } }],
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "Kiln & Wire",
              user_action: "PAY_NOW",
              shipping_preference: category === "DIGITAL_GOODS" ? "NO_SHIPPING" : "GET_FROM_FILE",
            },
          },
        },
      },
      { headers: { "PayPal-Request-Id": `dd-${sku}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } },
    );
    return { id: res.id };
  },

  async captureOrder(orderId) {
    type Cap = { id: string; create_time: string; amount: Money; custom_id?: string; seller_protection?: { status?: string; dispute_categories?: string[] } };
    const res = await call<{
      id: string;
      payer?: { name?: { given_name?: string; surname?: string }; email_address?: string; payer_id?: string };
      purchase_units?: Array<{ shipping?: { address?: Record<string, string> }; payments?: { captures?: Cap[] } }>;
    }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
    const pu = res.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    if (!cap) throw new PayPalError(502, "NO_CAPTURE", "PayPal captured the order but returned no capture.");
    return {
      orderId: res.id,
      captureId: cap.id,
      createTime: cap.create_time,
      amount: cap.amount,
      customId: cap.custom_id,
      payer: {
        name: [res.payer?.name?.given_name, res.payer?.name?.surname].filter(Boolean).join(" ") || undefined,
        email: res.payer?.email_address,
        payerId: res.payer?.payer_id,
      },
      shippingAddress: formatAddress(pu?.shipping?.address),
      sellerProtection: cap.seller_protection,
    };
  },

  async addTracking(orderId, captureId, carrier, trackingNumber) {
    await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, {
      capture_id: captureId,
      tracking_number: trackingNumber,
      carrier,
      notify_payer: false,
    });
  },

  getCapture: (captureId) => call("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`),

  async verifyWebhook(headers, rawBody) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return "skipped";
    const h = (k: string) => headers.get(k) || "";
    // The event must be forwarded byte-for-byte, so splice the raw body in
    // rather than re-serialising a parsed copy.
    const body =
      `{"auth_algo":${JSON.stringify(h("paypal-auth-algo"))},"cert_url":${JSON.stringify(h("paypal-cert-url"))},` +
      `"transmission_id":${JSON.stringify(h("paypal-transmission-id"))},"transmission_sig":${JSON.stringify(h("paypal-transmission-sig"))},` +
      `"transmission_time":${JSON.stringify(h("paypal-transmission-time"))},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${rawBody}}`;
    try {
      const res = await call<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", undefined, { rawBody: body });
      return res.verification_status === "SUCCESS" ? "verified" : "failed";
    } catch {
      return "failed";
    }
  },
};

export function isSimulator(): boolean {
  return process.env.PAYPAL_MOCK === "true" || !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET;
}

export function paypal(): PayPalApi {
  return isSimulator() ? mockPayPal : real;
}

/** Action names (HATEOAS `rel`s) PayPal currently allows on a dispute. */
export function allowedActions(d: Dispute): string[] {
  return (d.links ?? []).map((l) => l.rel.replaceAll("_", "-")).filter((r) => r !== "self");
}

export function num(m: Money | undefined): number {
  return m ? Number(m.value) || 0 : 0;
}
