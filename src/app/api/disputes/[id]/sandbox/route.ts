import { NextResponse } from "next/server";
import { invalidate } from "@/lib/cache";
import { body, route } from "@/lib/http";
import { isSimulator, paypal } from "@/lib/paypal";
import { simBuyerAcceptsOffer, simBuyerEscalates, simBuyerReplies } from "@/lib/paypal-mock";

export const dynamic = "force-dynamic";

// Moves a dispute through its lifecycle for a demo. `require_evidence` and
// `adjudicate_*` call PayPal's sandbox-only endpoints, which stand in for the
// PayPal reviewer. The `buyer_*` operations exist only in the simulator: in
// the sandbox the buyer acts at sandbox.paypal.com.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = await body<{ op?: string; message?: string }>(req);
  const pp = paypal();
  switch (b.op) {
    case "require_evidence":
      await pp.sandboxRequireEvidence(id, "SELLER_EVIDENCE");
      break;
    case "adjudicate_seller":
      await pp.sandboxAdjudicate(id, "SELLER_FAVOR");
      break;
    case "adjudicate_buyer":
      await pp.sandboxAdjudicate(id, "BUYER_FAVOR");
      break;
    case "buyer_accepts_offer":
    case "buyer_escalates":
    case "buyer_replies":
      if (!isSimulator()) return NextResponse.json({ error: "In sandbox mode the buyer acts at sandbox.paypal.com." }, { status: 400 });
      if (b.op === "buyer_accepts_offer") simBuyerAcceptsOffer(id);
      else if (b.op === "buyer_escalates") simBuyerEscalates(id);
      else simBuyerReplies(id, String(b.message || "").slice(0, 1000) || "I still want a refund.");
      break;
    default:
      return NextResponse.json({ error: "Unknown operation." }, { status: 400 });
  }
  invalidate(id);
  return NextResponse.json({ ok: true });
});
