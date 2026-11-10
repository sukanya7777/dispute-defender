import { NextResponse } from "next/server";
import { invalidate } from "@/lib/cache";
import { route } from "@/lib/http";
import { isSimulator } from "@/lib/paypal";
import { simReset } from "@/lib/paypal-mock";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  if (!isSimulator()) return NextResponse.json({ error: "Reset is only available in simulator mode." }, { status: 400 });
  simReset();
  invalidate();
  return NextResponse.json({ ok: true });
});
