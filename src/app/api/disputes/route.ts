import { NextResponse } from "next/server";
import { aiConfigured, MODEL } from "@/lib/agent";
import { route } from "@/lib/http";
import { paypal } from "@/lib/paypal";
import { db } from "@/lib/store";
import { syncAll } from "@/lib/sync";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const { rows, kpis } = await syncAll({ fresh });
  return NextResponse.json({
    mode: paypal().mode,
    aiConfigured: aiConfigured(),
    model: MODEL,
    autopilot: db().settings.autopilot,
    storeName: db().settings.storeName,
    webhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    lastWebhook: db().webhooks[0] ?? null,
    rows,
    kpis,
  });
});
