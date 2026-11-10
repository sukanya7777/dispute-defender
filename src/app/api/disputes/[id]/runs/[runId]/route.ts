import { NextResponse } from "next/server";
import { editAction, executeRun, rejectRun } from "@/lib/agent";
import { body, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string; runId: string }> }) => {
  const { id, runId } = await ctx.params;
  const b = await body<{ op?: string; actionId?: string; patch?: Record<string, unknown> }>(req);
  if (b.op === "approve") return NextResponse.json({ run: await executeRun(id, runId, "seller") });
  if (b.op === "reject") return NextResponse.json({ run: rejectRun(id, runId) });
  if (b.op === "edit" && b.actionId) return NextResponse.json({ action: editAction(id, runId, b.actionId, b.patch ?? {}) });
  return NextResponse.json({ error: "Unknown operation." }, { status: 400 });
});
