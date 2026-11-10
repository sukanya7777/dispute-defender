import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { buildOrderRecord, decodeCustomId, saveOrderRecord } from "@/lib/oms";
import { paypal } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** Captures the approved order, files the fulfilment record, and registers tracking with PayPal. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const pp = paypal();
  const cap = await pp.captureOrder(id);
  const sku = decodeCustomId(cap.customId);
  const rec = sku
    ? buildOrderRecord({ orderId: cap.orderId, captureId: cap.captureId, sku, createdAt: cap.createTime, amount: cap.amount, buyer: cap.payer, shippingAddress: cap.shippingAddress })
    : undefined;
  let trackingRegistered = false;
  if (rec) {
    saveOrderRecord(rec);
    if (rec.fulfillment.type === "SHIPMENT" && rec.fulfillment.trackingNumber !== "UNTRACKED") {
      try {
        // Putting tracking on the PayPal order is itself dispute prevention:
        // PayPal shows it to the buyer and uses it for Seller Protection.
        await pp.addTracking(cap.orderId, cap.captureId, rec.fulfillment.carrier, rec.fulfillment.trackingNumber);
        trackingRegistered = true;
      } catch (e) {
        console.warn("[store] could not add tracking:", (e as Error).message);
      }
    }
  }
  return NextResponse.json({ orderId: cap.orderId, captureId: cap.captureId, productName: rec?.productName, sellerProtection: cap.sellerProtection?.status ?? null, trackingRegistered });
});
