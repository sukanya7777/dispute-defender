"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, clock, dueIn, label, money, outcomeInfo, reason, STAGE, STATUS, STRATEGY_TONE, usePoll } from "@/components/client";
import type { AgentRun, CaseFile, Dispute, OrderRecord, Settings, StagedAction, TraceEvent } from "@/lib/types";

interface Detail {
  mode: "sandbox" | "simulator";
  aiConfigured: boolean;
  running: boolean;
  dispute: Dispute;
  allowed: string[];
  order: OrderRecord | null;
  caseFile: CaseFile | null;
  settings: Settings;
}

const ACTION_TITLE: Record<string, string> = {
  send_message: "Message the buyer",
  make_offer: "Offer a settlement",
  provide_evidence: "Submit evidence to PayPal",
  provide_supporting_info: "Send supporting information to PayPal",
  accept_claim: "Accept the claim and refund",
  escalate_to_claim: "Escalate to a PayPal claim",
};
const ACTION_API: Record<string, string> = {
  send_message: "POST /v1/customer/disputes/{id}/send-message",
  make_offer: "POST /v1/customer/disputes/{id}/make-offer",
  provide_evidence: "POST /v1/customer/disputes/{id}/provide-evidence",
  provide_supporting_info: "POST /v1/customer/disputes/{id}/provide-supporting-info",
  accept_claim: "POST /v1/customer/disputes/{id}/accept-claim",
  escalate_to_claim: "POST /v1/customer/disputes/{id}/escalate",
};
const TEXT_KEY: Record<string, string> = { send_message: "message", make_offer: "note", provide_evidence: "notes", provide_supporting_info: "notes", accept_claim: "note", escalate_to_claim: "note" };
const ACTION_STATUS: Record<string, { text: string; tone: string }> = {
  staged: { text: "Ready to send", tone: "warn" },
  executed: { text: "Sent", tone: "good" },
  failed: { text: "PayPal rejected it", tone: "bad" },
  rejected: { text: "Not sent", tone: "" },
  blocked: { text: "Blocked by guardrail", tone: "bad" },
};

function Gauge({ value }: { value: number }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const color = value >= 65 ? "var(--good)" : value >= 35 ? "#c98a1b" : "var(--bad)";
  return (
    <div className="gauge" role="img" aria-label={`Estimated chance of winning: ${value}%`}>
      <svg width="132" height="132" viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="11" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} style={{ transition: "stroke-dasharray .6s ease" }} />
      </svg>
      <div className="gauge-label">
        <div>
          <div className="gauge-num">{value}%</div>
          <div className="muted small">win chance</div>
        </div>
      </div>
    </div>
  );
}

function Trace({ events, live }: { events: TraceEvent[]; live: boolean }) {
  return (
    <ul className="timeline">
      {events.map((e, i) => (
        <li key={i} className={`k-${e.kind}`}>
          <div className="t-title">
            {e.title} <span className="muted small" style={{ fontWeight: 400 }}>{new Date(e.t).toLocaleTimeString()}</span>
          </div>
          {e.body && <div className={`t-body ${e.kind === "thinking" ? "t-thinking" : ""}`}>{e.body}</div>}
          {e.data !== undefined && (
            <details className="json">
              <summary>{e.kind === "tool_call" ? "Tool input" : "Data returned"}</summary>
              <pre>{JSON.stringify(e.data, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
      {live && (
        <li className="k-tool_call">
          <div className="t-title row" style={{ gap: 8 }}>
            <span className="spinner" style={{ color: "var(--accent)" }} /> Working…
          </div>
        </li>
      )}
    </ul>
  );
}

function ActionCard({ a, run, disputeId, currency, editable, onChanged }: { a: StagedAction; run: AgentRun; disputeId: string; currency: string; editable: boolean; onChanged: () => void }) {
  const key = TEXT_KEY[a.type];
  const [text, setText] = useState(String(a.input[key] ?? ""));
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setText(String(a.input[key] ?? ""));
    setSaved(true);
  }, [a.id, a.input, key]);
  const st = ACTION_STATUS[a.status];
  const tracking = a.input.tracking as { carrier_name: string; tracking_number: string } | undefined;

  const saveEdit = async () => {
    await api(`/api/disputes/${disputeId}/runs/${run.id}`, { method: "POST", json: { op: "edit", actionId: a.id, patch: { [key]: text } } });
    setSaved(true);
    onChanged();
  };

  return (
    <div className="action">
      <div className="action-head">
        <div>
          <b>{ACTION_TITLE[a.type]}</b>
          <div className="mono muted">{ACTION_API[a.type]}</div>
        </div>
        <span className={`pill ${st.tone}`}>{st.text}</span>
      </div>
      <div className="action-body stack" style={{ gap: 10 }}>
        {a.type === "make_offer" && (
          <div className="row">
            <span className="pill accent">{label(String(a.input.offer_type))}</span>
            <b>{money(Number(a.input.amount), currency)}</b>
          </div>
        )}
        {a.type === "provide_supporting_info" && (
          <div className="row">
            <a className="btn sm" href={`/api/disputes/${disputeId}/evidence?action=${a.id}`} target="_blank" rel="noreferrer">
              Open evidence PDF
            </a>
          </div>
        )}
        {a.type === "provide_evidence" && (
          <div className="row">
            <span className="pill accent">{label(String(a.input.evidence_type))}</span>
            {tracking && (
              <span className="pill">
                {tracking.carrier_name} · {tracking.tracking_number}
              </span>
            )}
            <a className="btn sm" href={`/api/disputes/${disputeId}/evidence?action=${a.id}`} target="_blank" rel="noreferrer">
              Open evidence PDF
            </a>
          </div>
        )}
        {editable && a.status === "staged" ? (
          <>
            <textarea
              value={text}
              aria-label={`${ACTION_TITLE[a.type]} text`}
              maxLength={2000}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(false);
              }}
            />
            {!saved && (
              <div className="row">
                <button className="btn sm" onClick={saveEdit}>
                  Save edit
                </button>
                <span className="muted small">Your wording replaces the agent's draft.</span>
              </div>
            )}
          </>
        ) : (
          <div className="quote">{text}</div>
        )}
        {(a.type === "provide_evidence" || a.type === "provide_supporting_info") && (
          <details className="json">
            <summary>Full statement in the PDF</summary>
            <div className="quote" style={{ marginTop: 6 }}>{String(a.input.letter ?? "")}</div>
          </details>
        )}
        {a.detail && (
          <div className="banner error" style={{ margin: 0 }}>
            {a.detail}
            {a.paypalDebugId ? ` (PayPal debug ID ${a.paypalDebugId})` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = usePoll<Detail>(`/api/disputes/${id}`, (d) => (d?.running ? 1200 : 5000));
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [showRun, setShowRun] = useState<string | null>(null);

  const act = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    setFlash(null);
    try {
      await fn();
      if (done) setFlash({ tone: "info", text: done });
    } catch (e) {
      setFlash({ tone: "error", text: (e as Error).message });
    }
    await reload(true);
    setBusy(null);
  };

  if (error && !data) return <div className="banner error">Could not load this dispute: {error}</div>;
  if (!data) return <p className="muted">Loading dispute from PayPal…</p>;

  const { dispute: d, order, caseFile, allowed, mode, settings } = data;
  const runs = caseFile?.runs ?? [];
  const run = (showRun && runs.find((r) => r.id === showRun)) || runs.at(-1);
  const isLatest = run?.id === runs.at(-1)?.id;
  const assessment = run?.assessment;
  const tx = d.disputed_transactions?.[0];
  const cur = d.dispute_amount.currency_code;
  const amount = Number(d.dispute_amount.value);
  const resolved = d.status === "RESOLVED";
  const out = resolved ? outcomeInfo(d.dispute_outcome?.outcome_code) : null;
  const status = out ?? STATUS[d.status] ?? { text: d.status, tone: "" };
  const due = d.status === "WAITING_FOR_SELLER_RESPONSE" ? dueIn(d.seller_response_due_date) : null;
  const awaiting = run?.state === "awaiting_approval" && isLatest;
  const isClaim = d.dispute_life_cycle_stage !== "INQUIRY";
  // PayPal records its ruling first and closes the case a little later.
  const ruling = !resolved ? d.adjudications?.at(-1) : undefined;
  const ruledForSeller = ruling?.type === "DENY_BUYER";
  const post = (op: string) => api(`/api/disputes/${id}/sandbox`, { method: "POST", json: { op } });

  return (
    <>
      <div className="crumbs">
        <Link href="/">Disputes</Link> / <span className="mono">{d.dispute_id}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>
            {tx?.items?.[0]?.item_name || reason(d.reason)} · {money(amount, cur)}
          </h1>
          <div className="row" style={{ marginTop: 8 }}>
            <span className={`pill ${status.tone}`}>{status.text}</span>
            <span className="pill">{STAGE[d.dispute_life_cycle_stage] ?? d.dispute_life_cycle_stage}</span>
            <span className="pill">{reason(d.reason)}</span>
            {due && <span className={`pill ${due.urgent ? "bad" : ""}`}>Reply due: {due.text}</span>}
            <span className="muted small">
              {tx?.buyer?.name ? `${tx.buyer.name} · ` : ""}opened {clock(d.create_time)}
            </span>
          </div>
        </div>
        <button className="btn" disabled={data.running || !data.aiConfigured || busy !== null} onClick={() => act("run", () => api(`/api/disputes/${id}/run`, { method: "POST" }))}>
          {data.running ? <span className="spinner" /> : null}
          {data.running ? "Agent working…" : runs.length ? "Re-analyse" : "Analyse with agent"}
        </button>
      </div>

      {flash && <div className={`banner ${flash.tone}`}>{flash.text}</div>}
      {!data.aiConfigured && (
        <div className="banner">
          The agent is switched off: set <code>ANTHROPIC_API_KEY</code> and restart.
        </div>
      )}
      {ruling && (
        <div className="banner info" style={ruledForSeller ? { background: "var(--good-soft)", color: "var(--good)", borderColor: "#bfe6d2" } : undefined}>
          <div>
            <b>{ruledForSeller ? `PayPal has ruled in your favour. You keep ${money(amount, cur)}.` : "PayPal has ruled for the buyer."}</b> PayPal is closing the case; the status updates when it does.
          </div>
        </div>
      )}
      {resolved && (
        <div className={`banner ${out?.tone === "good" ? "info" : ""}`} style={out?.tone === "good" ? { background: "var(--good-soft)", color: "var(--good)", borderColor: "#bfe6d2" } : undefined}>
          <div>
            <b>{out?.tone === "good" ? `Dispute closed in your favour. You keep ${money(amount, cur)}.` : `Dispute closed. ${money(Number(d.dispute_outcome?.amount_refunded?.value ?? amount), cur)} refunded to the buyer.`}</b>
          </div>
        </div>
      )}

      <div className="cols">
        <div className="stack">
          {/* ---- verdict ---- */}
          <section className="card">
            <div className="card-head">
              <h2>Agent's assessment</h2>
              {runs.length > 1 && (
                <select className="input" style={{ height: 30 }} value={run?.id} onChange={(e) => setShowRun(e.target.value)} aria-label="Agent run">
                  {runs.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      Run {i + 1} · {clock(r.startedAt)} · {label(r.trigger)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="card-body">
              {!run ? (
                <div className="empty">{data.aiConfigured ? "The agent has not looked at this dispute yet." : "No analysis yet."}</div>
              ) : assessment ? (
                <>
                  <div className="verdict">
                    <Gauge value={assessment.win_probability} />
                    <div>
                      <div className="row" style={{ marginBottom: 8 }}>
                        <span className={`pill ${STRATEGY_TONE[assessment.strategy]}`}>Recommended: {assessment.strategy.toLowerCase()}</span>
                        <span className="pill">Evidence: {assessment.evidence_strength.toLowerCase()}</span>
                      </div>
                      <div className="headline">{assessment.headline}</div>
                      <p className="muted" style={{ marginTop: 6 }}>
                        Buyer's claim: {assessment.buyer_claim_summary}
                      </p>
                    </div>
                  </div>
                  <p style={{ marginTop: 16 }}>{assessment.reasoning}</p>
                  <div className="ev">
                    <div>
                      <b>{money(assessment.expected_value.fight_expected_recovery, cur)}</b>
                      <span>Expected recovery if you fight</span>
                    </div>
                    <div>
                      <b>{money(assessment.expected_value.fight_expected_cost, cur)}</b>
                      <span>Expected dispute-fee cost</span>
                    </div>
                    <div>
                      <b>{money(assessment.expected_value.concede_cost, cur)}</b>
                      <span>Cost of conceding or settling</span>
                    </div>
                    <div style={{ background: "var(--accent-soft)" }}>
                      <b>{money(assessment.expected_value.recommended_net, cur)}</b>
                      <span>You keep, on the recommended path</span>
                    </div>
                  </div>
                  {assessment.risk_flags.length > 0 && (
                    <div className="flags">
                      {assessment.risk_flags.map((f) => (
                        <span key={f} className="pill warn">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : run.state === "running" ? (
                <div className="empty row" style={{ justifyContent: "center" }}>
                  <span className="spinner" style={{ color: "var(--accent)" }} /> Investigating: reading the dispute, the order record and the payment…
                </div>
              ) : (
                <div className="empty">{run.error || "This run ended without an assessment."}</div>
              )}
            </div>
          </section>

          {/* ---- plan ---- */}
          {run && run.actions.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>{awaiting ? "Plan waiting for your approval" : "Actions"}</h2>
                {awaiting && (
                  <div className="row">
                    <button className="btn danger" disabled={busy !== null} onClick={() => act("reject", () => api(`/api/disputes/${id}/runs/${run.id}`, { method: "POST", json: { op: "reject" } }))}>
                      Reject
                    </button>
                    <button
                      className="btn primary"
                      disabled={busy !== null}
                      onClick={() => act("approve", () => api(`/api/disputes/${id}/runs/${run.id}`, { method: "POST", json: { op: "approve" } }), "Sent to PayPal.")}
                    >
                      {busy === "approve" ? <span className="spinner" /> : null} Approve and send to PayPal
                    </button>
                  </div>
                )}
              </div>
              <div className="card-body">
                {run.actions.map((a) => (
                  <ActionCard key={a.id} a={a} run={run} disputeId={id} currency={cur} editable={awaiting} onChanged={() => reload(true)} />
                ))}
                {awaiting && (
                  <p className="muted small" style={{ marginTop: 12 }}>
                    Nothing has been sent yet. Guardrails are re-checked against the live dispute at the moment you approve.
                    {settings.autopilot ? ` Autopilot left this for you because it is above your ${money(settings.autopilotMaxRefund, cur)} refund limit.` : ""}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ---- trace ---- */}
          {run && (
            <section className="card">
              <div className="card-head">
                <h2>How the agent got there</h2>
                <span className="muted small">
                  {run.model ?? ""}
                  {run.usage ? ` · ${(run.usage.input_tokens + run.usage.output_tokens).toLocaleString()} tokens` : ""}
                </span>
              </div>
              <div className="card-body">
                <Trace events={run.trace} live={run.state === "running"} />
              </div>
            </section>
          )}
        </div>

        <div className="stack">
          {/* ---- demo controls ---- */}
          {!resolved && !ruling && (
            <section className="card">
              <div className="card-head">
                <h2>Play the other side</h2>
                <span className="pill">{mode === "sandbox" ? "Sandbox-only endpoints" : "Simulator"}</span>
              </div>
              <div className="card-body stack" style={{ gap: 10 }}>
                <p className="muted small">
                  {mode === "sandbox"
                    ? "In production PayPal's reviewers and the buyer make these moves. PayPal's sandbox exposes them as API calls so the full lifecycle can be tested."
                    : "Stand in for the buyer and for PayPal's reviewer to move this dispute through its lifecycle."}
                </p>
                <div className="row">
                  {mode === "simulator" && !isClaim && (
                    <>
                      <button className="btn sm" disabled={busy !== null} onClick={() => act("s", () => post("buyer_replies"), "The buyer replied.")}>
                        Buyer replies "still want a refund"
                      </button>
                      <button className="btn sm" disabled={busy !== null} onClick={() => act("s", () => post("buyer_escalates"), "The buyer escalated to a claim. PayPal now asks you for evidence.")}>
                        Buyer escalates to claim
                      </button>
                      {d.offer && (
                        <button className="btn sm" disabled={busy !== null} onClick={() => act("s", () => post("buyer_accepts_offer"), "The buyer accepted the offer.")}>
                          Buyer accepts offer
                        </button>
                      )}
                    </>
                  )}
                  {isClaim && d.status !== "WAITING_FOR_SELLER_RESPONSE" && (
                    <button className="btn sm" disabled={busy !== null} onClick={() => act("s", () => post("require_evidence"), "PayPal is now waiting for the seller's evidence.")}>
                      PayPal requests seller evidence
                    </button>
                  )}
                  {isClaim && (
                    <>
                      <button className="btn sm" disabled={busy !== null} onClick={() => act("s", () => post("adjudicate_seller"), "PayPal ruled for the seller.")}>
                        PayPal rules for seller
                      </button>
                      <button className="btn sm" disabled={busy !== null} onClick={() => act("s", () => post("adjudicate_buyer"), "PayPal ruled for the buyer.")}>
                        PayPal rules for buyer
                      </button>
                    </>
                  )}
                </div>
                {mode === "sandbox" && !isClaim && <p className="muted small">The buyer's moves (reply, accept an offer, escalate) are made by logging in to sandbox.paypal.com with the sandbox buyer account.</p>}
              </div>
            </section>
          )}

          {/* ---- thread ---- */}
          <section className="card">
            <div className="card-head">
              <h2>PayPal dispute thread</h2>
              <span className="muted small">live from PayPal</span>
            </div>
            <div className="card-body">
              {(d.messages ?? []).length === 0 && <p className="muted">No messages yet.</p>}
              {(d.messages ?? []).map((m, i) => (
                <div key={i} className={`msg ${m.posted_by === "SELLER" ? "seller" : ""}`}>
                  <div className="msg-meta">
                    {m.posted_by === "SELLER" ? "You (sent by the agent)" : label(m.posted_by)} · {clock(m.time_posted)}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              ))}
              {d.offer?.seller_offered_amount && (
                <p className="small" style={{ marginTop: 12 }}>
                  <span className="pill warn">Open offer</span> {label(d.offer.offer_type)} of {money(Number(d.offer.seller_offered_amount.value), cur)}
                </p>
              )}
              {(d.evidences ?? []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="kpi-label" style={{ marginBottom: 6 }}>Evidence on file at PayPal</div>
                  {(d.evidences ?? []).map((e, i) => (
                    <div key={i} className="small" style={{ marginBottom: 6 }}>
                      <span className={`pill ${e.source === "SUBMITTED_BY_SELLER" ? "good" : "warn"}`}>{label(e.source)}</span> {label(e.evidence_type)}
                      {e.evidence_info?.tracking_info?.[0] ? ` · ${e.evidence_info.tracking_info[0].carrier_name} ${e.evidence_info.tracking_info[0].tracking_number}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {(d.supporting_info ?? []).map((s, i) => (
                <div key={`si${i}`} className={`msg ${s.source === "SUBMITTED_BY_SELLER" ? "seller" : ""}`} style={{ marginTop: 8 }}>
                  <div className="msg-meta">
                    {s.source === "SUBMITTED_BY_SELLER" ? "Supporting information you sent (by the agent)" : "Supporting information"}
                    {s.provided_time ? ` · ${clock(s.provided_time)}` : ""}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{s.notes}</div>
                  {(s.documents ?? []).map((doc) => (
                    <div key={doc.name} className="small muted" style={{ marginTop: 4 }}>
                      Attached: {doc.name}
                    </div>
                  ))}
                </div>
              ))}
              <p className="muted small" style={{ marginTop: 12 }}>
                PayPal allows right now: {allowed.length ? allowed.map((a) => <span key={a} className="code" style={{ marginRight: 4 }}>{a}</span>) : "no seller action"}
              </p>
            </div>
          </section>

          {/* ---- order ---- */}
          <section className="card">
            <div className="card-head">
              <h2>Your order record</h2>
              {order?.reconstructed && <span className="pill">rebuilt from PayPal</span>}
            </div>
            <div className="card-body">
              {!order ? (
                <p className="muted">No order record was found for this transaction.</p>
              ) : (
                <>
                  <dl className="kv">
                    <dt>Item</dt>
                    <dd>{order.productName}</dd>
                    <dt>Listing</dt>
                    <dd>{order.listing.description}</dd>
                    <dt>Transaction</dt>
                    <dd className="mono">{order.captureId}</dd>
                    {order.shippingAddress && (
                      <>
                        <dt>Ship to</dt>
                        <dd>{order.shippingAddress}</dd>
                      </>
                    )}
                    {order.fulfillment.type === "SHIPMENT" ? (
                      <>
                        <dt>Carrier</dt>
                        <dd>
                          {order.fulfillment.carrier} · {order.fulfillment.service}
                        </dd>
                        <dt>Tracking</dt>
                        <dd className="mono">{order.fulfillment.trackingNumber}</dd>
                        {order.fulfillment.signedBy && (
                          <>
                            <dt>Signed by</dt>
                            <dd>{order.fulfillment.signedBy}</dd>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <dt>Delivery</dt>
                        <dd>Digital, license {order.fulfillment.licenseKey}</dd>
                      </>
                    )}
                  </dl>
                  <div className="track" style={{ marginTop: 14 }}>
                    {(order.fulfillment.type === "SHIPMENT"
                      ? order.fulfillment.events.map((e) => ({ t: e.time, a: label(e.status), b: [e.location, e.detail].filter(Boolean).join(". ") }))
                      : order.fulfillment.accessLogs.map((e) => ({ t: e.time, a: label(e.action), b: [e.detail, e.ip !== "-" ? e.ip : ""].filter(Boolean).join(" · ") }))
                    ).map((e, i) => (
                      <div key={i} style={{ display: "contents" }}>
                        <time>{clock(e.t)}</time>
                        <div>
                          <b>{e.a}</b> <span className="muted">{e.b}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {order.internalNotes.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div className="kpi-label" style={{ marginBottom: 4 }}>Internal notes</div>
                      {order.internalNotes.map((n) => (
                        <p key={n} className="small" style={{ marginBottom: 4 }}>
                          {n}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
