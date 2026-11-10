"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clock, money, reason, usePoll } from "@/components/client";
import type { Product } from "@/lib/oms";

interface StoreData {
  mode: "sandbox" | "simulator";
  clientId: string | null;
  products: Product[];
  presets: Record<string, { reason: string; message: string }>;
  orders: Array<{ orderId: string; captureId: string; sku: string; productName: string; amount: { value: string; currency_code: string }; createdAt: string; buyer: string | null }>;
}

interface PayPalButtons {
  render: (el: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
}
declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: {
        style?: Record<string, unknown>;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError?: (err: unknown) => void;
      }) => PayPalButtons;
    };
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(clientId: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the PayPal checkout script."));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

function PayPalButton({ clientId, sku, onPaid, onError }: { clientId: string; sku: string; onPaid: (r: Captured) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ onPaid, onError });
  cb.current = { onPaid, onError };
  useEffect(() => {
    let buttons: PayPalButtons | undefined;
    let gone = false;
    loadSdk(clientId)
      .then(() => {
        if (gone || !ref.current || !window.paypal) return;
        buttons = window.paypal.Buttons({
          style: { layout: "horizontal", height: 38, tagline: false, label: "pay" },
          // The server creates the order, so the browser never sets the price.
          createOrder: async () => (await api<{ id: string }>("/api/store/orders", { method: "POST", json: { sku } })).id,
          onApprove: async (data) => {
            try {
              cb.current.onPaid(await api<Captured>(`/api/store/orders/${data.orderID}/capture`, { method: "POST" }));
            } catch (e) {
              cb.current.onError((e as Error).message);
            }
          },
          onError: (err) => cb.current.onError(err instanceof Error ? err.message : "PayPal checkout failed."),
        });
        buttons.render(ref.current).catch(() => {});
      })
      .catch((e) => cb.current.onError((e as Error).message));
    return () => {
      gone = true;
      buttons?.close().catch(() => {});
    };
  }, [clientId, sku]);
  return <div ref={ref} style={{ minHeight: 38 }} />;
}

interface Captured {
  orderId: string;
  captureId: string;
  productName?: string;
  sellerProtection: string | null;
  trackingRegistered: boolean;
}

export default function Store() {
  const router = useRouter();
  const { data, error, reload } = usePoll<StoreData>("/api/store", () => 15000);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const paid = (r: Captured) => {
    setFlash({
      tone: "info",
      text: `Paid. PayPal capture ${r.captureId}${r.sellerProtection ? ` · Seller Protection: ${r.sellerProtection.toLowerCase().replaceAll("_", " ")}` : ""}${r.trackingRegistered ? " · tracking added to the PayPal order" : ""}.`,
    });
    reload();
  };

  const simBuy = async (sku: string) => {
    setBusy(sku);
    setFlash(null);
    try {
      const { id } = await api<{ id: string }>("/api/store/orders", { method: "POST", json: { sku } });
      paid(await api<Captured>(`/api/store/orders/${id}/capture`, { method: "POST" }));
    } catch (e) {
      setFlash({ tone: "error", text: (e as Error).message });
    }
    setBusy(null);
  };

  const simDispute = async (captureId: string, sku: string) => {
    const preset = data?.presets[sku];
    if (!preset) return;
    setBusy(captureId);
    setFlash(null);
    try {
      const { disputeId } = await api<{ disputeId: string }>("/api/store/dispute", { method: "POST", json: { captureId, reason: preset.reason, message: preset.message } });
      router.push(`/disputes/${disputeId}`);
    } catch (e) {
      setFlash({ tone: "error", text: (e as Error).message });
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Demo store: Kiln &amp; Wire</h1>
          <p className="sub">
            A small shop that takes PayPal. Each product is wired to a different fulfilment story, so disputing it puts a different decision in front of the agent. Checkout uses the PayPal Orders API.
          </p>
        </div>
        {data && (
          <span className={`pill ${data.mode === "sandbox" ? "good" : ""}`}>
            <span className="dot" /> {data.mode === "sandbox" ? "PayPal sandbox checkout" : "Simulated checkout"}
          </span>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}
      {flash && <div className={`banner ${flash.tone}`}>{flash.text}</div>}

      {data?.mode === "sandbox" && (
        <div className="banner info">
          <div>
            <b>How to create a real sandbox dispute</b>
            <ol className="steps" style={{ marginTop: 6 }}>
              <li>Pay for an item below with the PayPal button, signing in as your sandbox <em>personal</em> (buyer) account.</li>
              <li>
                Open <span className="code">sandbox.paypal.com</span>, sign in as that same buyer, find the payment under Activity and choose “Report a problem”.
              </li>
              <li>Come back to the Disputes tab. The agent picks the dispute up from PayPal within seconds.</li>
            </ol>
          </div>
        </div>
      )}

      <div className="products">
        {data?.products.map((p) => (
          <article key={p.sku} className="card product">
            <div className="product-art" aria-hidden>
              {p.emoji}
            </div>
            <div className="product-body">
              <div className="spread">
                <h2>{p.name}</h2>
                <span className="price">{money(Number(p.price))}</span>
              </div>
              <p className="muted">{p.blurb}</p>
              <div className="scenario">
                <b>What happens after payment:</b> {p.scenario}
              </div>
              <span style={{ flex: 1 }} />
              {data.mode === "sandbox" && data.clientId ? (
                <PayPalButton clientId={data.clientId} sku={p.sku} onPaid={paid} onError={(m) => setFlash({ tone: "error", text: m })} />
              ) : (
                <button className="btn primary" disabled={busy !== null} onClick={() => simBuy(p.sku)}>
                  {busy === p.sku ? <span className="spinner" /> : null} Buy (simulated PayPal payment)
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <h2>Recent orders</h2>
          <span className="muted small">from the store's order records</span>
        </div>
        <div className="card-body">
          {!data?.orders.length ? (
            <p className="muted">No orders yet. Buy something above.</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {data.orders.map((o) => (
                <div key={o.captureId} className="spread">
                  <div>
                    <b>{o.productName}</b> · {money(Number(o.amount.value), o.amount.currency_code)}
                    <div className="muted small">
                      {o.buyer ? `${o.buyer} · ` : ""}
                      {clock(o.createdAt)} · <span className="mono">{o.captureId}</span>
                    </div>
                  </div>
                  {data.mode === "simulator" ? (
                    <button className="btn sm" disabled={busy !== null} onClick={() => simDispute(o.captureId, o.sku)} title={data.presets[o.sku]?.message}>
                      {busy === o.captureId ? <span className="spinner" /> : null} Dispute as the buyer: {reason(data.presets[o.sku]?.reason ?? "").toLowerCase()}
                    </button>
                  ) : (
                    <span className="muted small">Dispute it at sandbox.paypal.com as the buyer</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
