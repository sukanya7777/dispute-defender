import { NextResponse } from "next/server";
import { PayPalError } from "./paypal-error";

/** Wraps a route handler so every failure becomes a readable JSON error. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof PayPalError) {
        return NextResponse.json({ error: e.message, code: e.code, source: "paypal", debugId: e.debugId }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
      }
      const msg = e instanceof Error ? e.message : "Unexpected error";
      console.error("[api]", e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
