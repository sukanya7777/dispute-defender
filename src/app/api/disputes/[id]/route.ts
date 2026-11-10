import { NextResponse } from "next/server";
import { aiConfigured, isRunning, loadOrder } from "@/lib/agent";
import { route } from "@/lib/http";
import { allowedActions, paypal } from "@/lib/paypal";
import { db, peekCase } from "@/lib/store";
import { getDetail } from "@/lib/sync";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const dispute = await getDetail(id, fresh);
  const order = await loadOrder(dispute);
  return NextResponse.json({
    mode: paypal().mode,
    aiConfigured: aiConfigured(),
    running: isRunning(id),
    dispute,
    allowed: allowedActions(dispute),
    order: order ?? null,
    caseFile: peekCase(id) ?? null,
    settings: db().settings,
  });
});
