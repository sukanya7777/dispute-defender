import { NextResponse } from "next/server";
import { body, route } from "@/lib/http";
import { db, DEFAULT_SETTINGS, save } from "@/lib/store";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ settings: db().settings, defaults: DEFAULT_SETTINGS }));

export const PUT = route(async (req: Request) => {
  const b = await body<Partial<Settings>>(req);
  const s = db().settings;
  const money = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : fallback;
  };
  if (typeof b.autopilot === "boolean") s.autopilot = b.autopilot;
  if (b.autopilotMaxRefund !== undefined) s.autopilotMaxRefund = money(b.autopilotMaxRefund, s.autopilotMaxRefund);
  if (b.disputeFee !== undefined) s.disputeFee = money(b.disputeFee, s.disputeFee);
  if (b.minFightValue !== undefined) s.minFightValue = money(b.minFightValue, s.minFightValue);
  if (typeof b.storeName === "string" && b.storeName.trim()) s.storeName = b.storeName.trim().slice(0, 60);
  if (typeof b.storePolicy === "string") s.storePolicy = b.storePolicy.slice(0, 4000);
  if (b.tone === "warm" || b.tone === "neutral" || b.tone === "firm") s.tone = b.tone;
  save();
  return NextResponse.json({ settings: s });
});
