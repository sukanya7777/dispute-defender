"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/** Polls a JSON endpoint. `interval` may depend on the latest data. */
export function usePoll<T>(url: string | null, interval: (data: T | null) => number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<T | null>(null);
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

  const load = useCallback(
    async (fresh = false) => {
      if (!url) return;
      try {
        const d = await api<T>(fresh ? `${url}${url.includes("?") ? "&" : "?"}fresh=1` : url);
        latest.current = d;
        setData(d);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [url],
  );

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stop) timer = setTimeout(tick, intervalRef.current(latest.current));
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [load]);

  return { data, error, reload: load };
}

export const money = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

export const label = (s: string | undefined) => (s ? s.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "");

export const REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised payment",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Incorrect amount",
};
export const reason = (r: string) => REASON[r] ?? label(r);

export const STATUS: Record<string, { text: string; tone: string }> = {
  WAITING_FOR_SELLER_RESPONSE: { text: "Needs your response", tone: "warn" },
  WAITING_FOR_BUYER_RESPONSE: { text: "Waiting for buyer", tone: "" },
  UNDER_REVIEW: { text: "PayPal reviewing", tone: "accent" },
  OPEN: { text: "Open", tone: "warn" },
  RESOLVED: { text: "Resolved", tone: "" },
};

export const STAGE: Record<string, string> = { INQUIRY: "Inquiry", CHARGEBACK: "Claim", PRE_ARBITRATION: "Pre-arbitration", ARBITRATION: "Arbitration" };

export function outcomeInfo(code: string | undefined): { text: string; tone: string } | null {
  if (!code || code === "NONE") return null;
  if (code === "RESOLVED_SELLER_FAVOUR" || code === "DENIED") return { text: "Won", tone: "good" };
  if (code === "CANCELED_BY_BUYER") return { text: "Buyer withdrew", tone: "good" };
  if (code === "RESOLVED_BUYER_FAVOUR" || code === "ACCEPTED") return { text: "Refunded", tone: "bad" };
  return { text: label(code), tone: "" };
}

export const STRATEGY_TONE: Record<string, string> = { FIGHT: "accent", NEGOTIATE: "warn", SETTLE: "warn", ACCEPT: "bad", WAIT: "" };

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function dueIn(iso: string | undefined): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const h = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (h < 0) return { text: "Overdue", urgent: true };
  if (h < 48) return { text: `${Math.ceil(h)} h left`, urgent: true };
  return { text: `${Math.floor(h / 24)} days left`, urgent: false };
}

export const clock = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
