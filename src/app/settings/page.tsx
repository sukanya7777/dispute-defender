"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/client";
import type { Settings } from "@/lib/types";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings")
      .then((r) => setS(r.settings))
      .catch((e) => setState((e as Error).message));
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((cur) => (cur ? { ...cur, [k]: v } : cur));
    setState("idle");
  };

  const save = async () => {
    if (!s) return;
    setState("saving");
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PUT", json: s });
      setS(r.settings);
      setState("saved");
    } catch (e) {
      setState((e as Error).message);
    }
  };

  if (!s) return <p className="muted">{state !== "idle" ? state : "Loading…"}</p>;
  const errored = !["idle", "saving", "saved"].includes(state);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rules &amp; autopilot</h1>
          <p className="sub">The agent decides; these rules limit what it may do with your money. They are enforced in code before anything is sent to PayPal, so no message from a buyer can talk the agent past them.</p>
        </div>
        <div className="row">
          {state === "saved" && <span className="pill good">Saved</span>}
          <button className="btn primary" onClick={save} disabled={state === "saving"}>
            {state === "saving" ? <span className="spinner" /> : null} Save rules
          </button>
        </div>
      </div>
      {errored && <div className="banner error">{state}</div>}

      <div className="stack">
        <section className="card">
          <div className="card-body">
            <div className="spread">
              <div>
                <h2>Autopilot</h2>
                <p className="muted" style={{ marginTop: 4, maxWidth: "70ch" }}>
                  Off: the agent drafts every reply and waits for your approval. On: it sends messages, evidence and escalations by itself, and any refund up to the limit below. Larger refunds still wait for you.
                </p>
              </div>
              <label className="switch" aria-label="Autopilot">
                <input type="checkbox" checked={s.autopilot} onChange={(e) => set("autopilot", e.target.checked)} />
                <span />
              </label>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Money limits</h2>
          </div>
          <div className="card-body form-grid">
            <div className="field">
              <label htmlFor="max">Autopilot refund limit (USD)</label>
              <input id="max" className="input" type="number" min={0} step={1} value={s.autopilotMaxRefund} onChange={(e) => set("autopilotMaxRefund", Number(e.target.value))} />
              <span className="hint">Refunds or offers above this always need your approval.</span>
            </div>
            <div className="field">
              <label htmlFor="fee">Dispute fee on a lost claim (USD)</label>
              <input id="fee" className="input" type="number" min={0} step={1} value={s.disputeFee} onChange={(e) => set("disputeFee", Number(e.target.value))} />
              <span className="hint">What PayPal charges you when a claim is lost. Used in the fight-or-settle maths.</span>
            </div>
            <div className="field">
              <label htmlFor="min">Don't fight orders under (USD)</label>
              <input id="min" className="input" type="number" min={0} step={1} value={s.minFightValue} onChange={(e) => set("minFightValue", Number(e.target.value))} />
              <span className="hint">Below this, the agent leans towards refunding.</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Store voice and policy</h2>
          </div>
          <div className="card-body stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">Store name</label>
                <input id="name" className="input" value={s.storeName} maxLength={60} onChange={(e) => set("storeName", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="tone">Tone with buyers</label>
                <select id="tone" className="input" value={s.tone} onChange={(e) => set("tone", e.target.value as Settings["tone"])}>
                  <option value="warm">Warm</option>
                  <option value="neutral">Neutral</option>
                  <option value="firm">Firm</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="policy">Return and refund policy</label>
              <textarea id="policy" value={s.storePolicy} maxLength={4000} onChange={(e) => set("storePolicy", e.target.value)} />
              <span className="hint">The agent reads this before every decision and quotes it as evidence where it helps.</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
