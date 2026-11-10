import { loadOrder } from "@/lib/agent";
import { buildEvidencePdf } from "@/lib/evidence-pdf";
import { route } from "@/lib/http";
import { db, peekCase } from "@/lib/store";
import { getDetail } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** Preview of the PDF evidence packet for a staged or sent provide-evidence action. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const actionId = new URL(req.url).searchParams.get("action");
  const action = peekCase(id)
    ?.runs.flatMap((r) => r.actions)
    .find((a) => a.id === actionId && a.type === "provide_evidence");
  if (!action) return Response.json({ error: "Evidence action not found." }, { status: 404 });
  const dispute = await getDetail(id);
  const pdf = await buildEvidencePdf({
    storeName: db().settings.storeName,
    dispute,
    order: await loadOrder(dispute),
    letter: String(action.input.letter ?? ""),
    evidenceType: String(action.input.evidence_type ?? "OTHER"),
  });
  return new Response(pdf as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="evidence-${id}.pdf"`, "Cache-Control": "no-store" },
  });
});
