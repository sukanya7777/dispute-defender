import { NextResponse } from "next/server";
import { invalidate } from "@/lib/cache";
import { paypal } from "@/lib/paypal";
import { db, save, uid } from "@/lib/store";
import { syncAll } from "@/lib/sync";

export const dynamic = "force-dynamic";

// PayPal -> us. Subscribe this URL to CUSTOMER.DISPUTE.CREATED / UPDATED /
// RESOLVED. A new or changed dispute starts the agent within seconds, with no
// one looking at the dashboard.
export async function POST(req: Request) {
  const raw = await req.text();
  let event: { id?: string; event_type?: string; resource?: { dispute_id?: string } } = {};
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const verified = await paypal().verifyWebhook(req.headers, raw);
  const d = db();
  d.webhooks.unshift({
    id: event.id || uid("wh"),
    receivedAt: new Date().toISOString(),
    eventType: String(event.event_type || "unknown").slice(0, 80),
    disputeId: event.resource?.dispute_id,
    verified,
  });
  d.webhooks = d.webhooks.slice(0, 50);
  save();
  if (verified === "failed") return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });

  if (event.event_type?.startsWith("CUSTOMER.DISPUTE.")) {
    // The payload is only a hint: re-read the truth from PayPal before acting.
    invalidate(event.resource?.dispute_id);
    syncAll({ fresh: true, trigger: "webhook" }).catch((e) => console.error("[webhook] sync failed", e));
  }
  return NextResponse.json({ received: true });
}
