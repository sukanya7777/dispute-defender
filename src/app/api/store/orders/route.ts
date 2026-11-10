import { NextResponse } from "next/server";
import { body, route } from "@/lib/http";
import { encodeCustomId, findProduct } from "@/lib/oms";
import { paypal } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** Creates a PayPal order (Orders v2) for one catalogue item. Price comes from the server, never the browser. */
export const POST = route(async (req: Request) => {
  const { sku } = await body<{ sku?: string }>(req);
  const p = findProduct(sku);
  if (!p) return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  const order = await paypal().createOrder({ sku: p.sku, name: p.name, description: p.description, price: p.price, category: p.category, customId: encodeCustomId(p.sku) });
  return NextResponse.json(order);
});
