import { NextResponse } from "next/server";
import { disputeSnapshot, startRun } from "@/lib/agent";
import { route } from "@/lib/http";
import { getDetail } from "@/lib/sync";

export const dynamic = "force-dynamic";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const dispute = await getDetail(id, true);
  const res = startRun(id, "manual", disputeSnapshot(dispute));
  if (res.error) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ runId: res.run!.id });
});
