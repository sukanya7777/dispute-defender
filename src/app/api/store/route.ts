import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { CATALOG } from "@/lib/oms";
import { isSimulator, paypal } from "@/lib/paypal";
import { DISPUTE_PRESETS } from "@/lib/paypal-mock";
import { db } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  // Orders made in the simulator stay in the store file; hide them when live.
  const simCaptures = (db().mock as { captures?: Record<string, unknown> } | undefined)?.captures ?? {};
  const orders = Object.values(db().orders)
    .filter((o) => isSimulator() || !(o.captureId in simCaptures))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map((o) => ({ orderId: o.orderId, captureId: o.captureId, sku: o.sku, productName: o.productName, amount: o.amount, createdAt: o.createdAt, buyer: o.buyer.name ?? null }));
  return NextResponse.json({
    mode: paypal().mode,
    // The client ID is public by design: the PayPal JS SDK needs it in the browser.
    clientId: isSimulator() ? null : process.env.PAYPAL_CLIENT_ID,
    products: CATALOG,
    presets: DISPUTE_PRESETS,
    orders,
  });
});
