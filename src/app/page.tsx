"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type ValueFormatterParams } from "ag-grid-community";
import { ago, api, dueIn, money, outcomeInfo, reason, STAGE, STATUS, STRATEGY_TONE, usePoll } from "@/components/client";
import type { DisputeRow } from "@/lib/types";
import type { Kpis } from "@/lib/sync";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Overview {
  mode: "sandbox" | "simulator";
  aiConfigured: boolean;
  model: string;
  autopilot: boolean;
  storeName: string;
  webhookConfigured: boolean;
  lastWebhook: { receivedAt: string; eventType: string } | null;
  rows: DisputeRow[];
  kpis: Kpis;
}

const theme = themeQuartz.withParams({
  accentColor: "#3b3fd8",
  borderColor: "#e2e5ec",
  headerBackgroundColor: "#fafbfc",
  headerTextColor: "#7b8498",
  headerFontWeight: 620,
  headerFontSize: 12.5,
  fontSize: 14,
  rowHeight: 58,
  headerHeight: 40,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHoverColor: "#f6f7fb",
  fontFamily: "inherit",
});

const AGENT_STATE: Record<string, { text: string; tone: string; pulse?: boolean }> = {
  running: { text: "Agent working", tone: "accent", pulse: true },
  awaiting_approval: { text: "Needs approval", tone: "warn" },
  executed: { text: "Sent to PayPal", tone: "good" },
  rejected: { text: "Plan rejected", tone: "" },
  failed: { text: "Agent error", tone: "bad" },
  no_action: { text: "Nothing to do yet", tone: "" },
  not_analyzed: { text: "Not analysed", tone: "" },
};

const isTotal = (d: DisputeRow | undefined) => d?.dispute_id === "__total";

function DisputeCell({ data }: ICellRendererParams<DisputeRow>) {
  if (!data) return null;
  if (isTotal(data)) return <div className="cell-center muted">{data.item}</div>;
  return (
    <div className="cell-stack">
      <b>{data.item || reason(data.reason)}</b>
      <span className="muted small">
        {reason(data.reason)} · {data.buyer || "Unknown buyer"}
      </span>
    </div>
  );
}

function StatusCell({ data }: ICellRendererParams<DisputeRow>) {
  if (!data || isTotal(data)) return null;
  const out = data.status === "RESOLVED" ? outcomeInfo(data.outcome) : null;
  const s = out ?? STATUS[data.status] ?? { text: data.status, tone: "" };
  const due = dueIn(data.due);
  return (
    <div className="cell-stack">
      <span>
        <span className={`pill ${s.tone}`}>{s.text}</span>
      </span>
      <span className="muted small" style={{ marginTop: 3, color: due?.urgent ? "var(--bad)" : undefined }}>
        {STAGE[data.stage] ?? data.stage}
        {due ? ` · ${due.text}` : ""}
      </span>
    </div>
  );
}

function AgentCell({ data }: ICellRendererParams<DisputeRow>) {
  if (!data || isTotal(data)) return null;
  const s = AGENT_STATE[data.agentState ?? "not_analyzed"];
  if (data.status === "RESOLVED" && data.agentState !== "running") return <div className="cell-center muted">Closed</div>;
  return (
    <div className="cell-center">
      <span className={`pill ${s.tone}`}>
        {s.pulse && <span className="dot pulse" />}
        {s.text}
      </span>
    </div>
  );
}

function StrategyCell({ data }: ICellRendererParams<DisputeRow>) {
  if (isTotal(data)) return null;
  if (!data?.strategy) return <div className="cell-center muted">–</div>;
  return (
    <div className="cell-stack">
      <span>
        <span className={`pill ${STRATEGY_TONE[data.strategy]}`}>{data.strategy[0] + data.strategy.slice(1).toLowerCase()}</span>
      </span>
      <span className="muted small" style={{ marginTop: 3, overflow: "hidden", textOverflow: "ellipsis" }} title={data.headline}>
        {data.headline}
      </span>
    </div>
  );
}

function WinCell({ value, data }: ICellRendererParams<DisputeRow, number | undefined>) {
  if (isTotal(data)) return null;
  if (value === undefined || value === null) return <div className="cell-center muted">–</div>;
  const color = value >= 65 ? "var(--good)" : value >= 35 ? "#c98a1b" : "var(--bad)";
  return (
    <div className="cell-center">
      <b style={{ width: 38, fontVariantNumeric: "tabular-nums" }}>{value}%</b>
      <span className="bar">
        <i style={{ width: `${value}%`, background: color }} />
      </span>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const gridRef = useRef<AgGridReact<DisputeRow>>(null);
  const { data, error, reload } = usePoll<Overview>("/api/disputes", (d) => (d?.rows.some((r) => r.agentState === "running") ? 2000 : 5000));
  const [quick, setQuick] = useState("");
  const [view, setView] = useState<"all" | "action" | "open" | "closed">("all");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (view === "action") return all.filter((r) => r.agentState === "awaiting_approval");
    if (view === "open") return all.filter((r) => r.status !== "RESOLVED");
    if (view === "closed") return all.filter((r) => r.status === "RESOLVED");
    return all;
  }, [data, view]);

  const cols = useMemo(() => {
    const defs: ColDef<DisputeRow>[] = [
      { headerName: "Dispute", field: "item", cellRenderer: DisputeCell, flex: 1.5, minWidth: 230, getQuickFilterText: (p) => `${p.data.item} ${reason(p.data.reason)} ${p.data.buyer} ${p.data.dispute_id}` },
      {
        headerName: "Amount",
        field: "amount",
        width: 120,
        type: "rightAligned",
        filter: "agNumberColumnFilter",
        valueFormatter: (p: ValueFormatterParams<DisputeRow, number>) => (p.value == null ? "" : money(p.value, p.data?.currency)),
        cellStyle: { fontVariantNumeric: "tabular-nums", fontWeight: 620, display: "flex", alignItems: "center", justifyContent: "flex-end" },
      },
      { headerName: "PayPal status", field: "status", cellRenderer: StatusCell, width: 190, filter: true },
      { headerName: "Agent's call", field: "strategy", cellRenderer: StrategyCell, flex: 1.6, minWidth: 240, filter: true, getQuickFilterText: (p) => `${p.data.strategy ?? ""} ${p.data.headline ?? ""}` },
      { headerName: "Win chance", field: "winProbability", cellRenderer: WinCell, width: 150, filter: "agNumberColumnFilter" },
      { headerName: "Agent", field: "agentState", cellRenderer: AgentCell, width: 170, filter: true },
      { headerName: "Opened", field: "created", width: 120, valueFormatter: (p) => (p.value ? ago(p.value as string) : ""), sort: "desc", cellStyle: { display: "flex", alignItems: "center", color: "var(--ink-3)" } },
    ];
    return defs;
  }, []);

  const totals = useMemo<DisputeRow[]>(
    () =>
      rows.length
        ? [{ dispute_id: "__total", item: `${rows.length} dispute${rows.length === 1 ? "" : "s"} shown`, reason: "", status: "", stage: "", amount: rows.reduce((a, r) => a + r.amount, 0), currency: rows[0].currency, created: "" }]
        : [],
    [rows],
  );

  const k = data?.kpis;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Disputes</h1>
          <p className="sub">
            Every PayPal dispute on {data?.storeName ?? "your store"} is investigated the moment it opens. The agent decides whether to fight, settle or refund, and drafts the reply. You approve it, or let autopilot send it.
          </p>
        </div>
        <div className="row">
          {data && (
            <span className={`pill ${data.mode === "sandbox" ? "good" : ""}`} title={data.mode === "sandbox" ? "Connected to the PayPal sandbox REST API" : "No PayPal credentials set: using the built-in PayPal simulator"}>
              <span className="dot" /> {data.mode === "sandbox" ? "PayPal sandbox" : "PayPal simulator"}
            </span>
          )}
          {data && (
            <Link href="/settings" className={`pill ${data.autopilot ? "accent" : ""}`}>
              Autopilot {data.autopilot ? "on" : "off"}
            </Link>
          )}
        </div>
      </div>

      {error && <div className="banner error">Could not load disputes: {error}</div>}
      {data && !data.aiConfigured && (
        <div className="banner">
          <div>
            <b>The agent is switched off.</b> Set <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> and restart to let it analyse disputes.
          </div>
        </div>
      )}

      <div className="kpis">
        <div className="card kpi">
          <div className="kpi-label">Open disputes</div>
          <div className="kpi-value">{k ? k.open : "–"}</div>
          <div className="kpi-note">{k ? `${money(k.atRisk, k.currency)} at risk` : " "}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Waiting for your approval</div>
          <div className="kpi-value" style={{ color: k?.awaitingApproval ? "var(--warn)" : undefined }}>
            {k ? k.awaitingApproval : "–"}
          </div>
          <div className="kpi-note">Drafted and ready to send</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Money kept</div>
          <div className="kpi-value" style={{ color: k?.wonAmount ? "var(--good)" : undefined }}>
            {k ? money(k.wonAmount, k.currency) : "–"}
          </div>
          <div className="kpi-note">{k ? `${k.won} dispute${k.won === 1 ? "" : "s"} won` : " "}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Win rate</div>
          <div className="kpi-value">{k?.winRate == null ? "–" : `${k.winRate}%`}</div>
          <div className="kpi-note">{k ? `${k.won + k.lost} closed · ${money(k.refundedAmount, k.currency)} refunded` : " "}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Time to first reply</div>
          <div className="kpi-value">{k?.avgResponseMinutes == null ? "–" : k.avgResponseMinutes < 1 ? "< 1 min" : `${k.avgResponseMinutes} min`}</div>
          <div className="kpi-note">PayPal allows up to 10 days</div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="toolbar">
          <div className="seg" role="tablist" aria-label="Filter disputes">
            {(
              [
                ["all", "All"],
                ["action", `Needs approval${k?.awaitingApproval ? ` (${k.awaitingApproval})` : ""}`],
                ["open", "Open"],
                ["closed", "Closed"],
              ] as const
            ).map(([id, text]) => (
              <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>
                {text}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Search item, buyer, reason…" value={quick} onChange={(e) => setQuick(e.target.value)} aria-label="Search disputes" />
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: "disputes.csv", skipPinnedBottom: true })}>
            Export CSV
          </button>
          <button
            className="btn sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await reload(true);
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : null} Sync with PayPal
          </button>
        </div>
        <div className="grid-wrap">
          <AgGridReact<DisputeRow>
            ref={gridRef}
            theme={theme}
            rowData={rows}
            columnDefs={cols}
            getRowId={(p) => p.data.dispute_id}
            quickFilterText={quick}
            pinnedBottomRowData={totals}
            defaultColDef={{ sortable: true, resizable: true, suppressMovable: false }}
            suppressCellFocus
            animateRows
            onRowClicked={(e) => e.data && e.data.dispute_id !== "__total" && router.push(`/disputes/${e.data.dispute_id}`)}
            overlayNoRowsTemplate={
              data ? "<div style='padding:24px;color:#4a5265'>No disputes here. Buy something in the demo store and dispute it to see the agent work.</div>" : "<div style='padding:24px;color:#7b8498'>Loading disputes from PayPal…</div>"
            }
          />
        </div>
      </div>

      {data && (
        <p className="muted small" style={{ marginTop: 12 }}>
          {data.mode === "simulator" ? (
            <>
              Running against the built-in PayPal simulator.{" "}
              <button
                className="btn sm"
                style={{ marginLeft: 6 }}
                onClick={async () => {
                  if (!confirm("Reset the simulator? This clears all simulated orders, disputes and agent history.")) return;
                  await api("/api/demo/reset", { method: "POST" });
                  reload(true);
                }}
              >
                Reset demo data
              </button>
            </>
          ) : data.webhookConfigured ? (
            <>Webhooks on. {data.lastWebhook ? `Last event: ${data.lastWebhook.eventType}, ${ago(data.lastWebhook.receivedAt)}.` : "No event received yet."}</>
          ) : (
            <>Polling PayPal every few seconds. Register a webhook for CUSTOMER.DISPUTE.* events to react instantly even when this page is closed.</>
          )}{" "}
          Agent model: {data.model}.
        </p>
      )}
    </>
  );
}
