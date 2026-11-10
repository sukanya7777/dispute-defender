import { NextResponse } from "next/server";
import { invalidate } from "@/lib/cache";
import { body, route } from "@/lib/http";
import { isSimulator } from "@/lib/paypal";
import { simFileDispute } from "@/lib/paypal-mock";

export const dynamic = "force-dynamic";

const REASONS = new Set(["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", "UNAUTHORISED"]);

/** Simulator only: the buyer opens a dispute. In the sandbox this is done at sandbox.paypal.com. */
export const POST = route(async (req: Request) => {
  if (!isSimulator()) return NextResponse.json({ error: "In sandbox mode, file the dispute as the buyer at sandbox.paypal.com." }, { status: 400 });
  const b = await body<{ captureId?: string; reason?: string; message?: string }>(req);
  if (!b.captureId || !b.reason || !REASONS.has(b.reason)) return NextResponse.json({ error: "captureId and a valid reason are required." }, { status: 400 });
  const d = simFileDispute(b.captureId, b.reason, String(b.message || "").slice(0, 1000) || "I have a problem with this order.");
  invalidate();
  return NextResponse.json({ disputeId: d.dispute_id });
});
