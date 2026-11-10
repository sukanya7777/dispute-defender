# Dispute Defender

**An AI agent that fights PayPal disputes for small sellers.**

When a buyer opens a PayPal dispute, a small seller has days to answer with the right evidence in the right format. Most are one-person shops; they answer late, send the wrong thing, or do not answer at all, and lose money they were owed. Just as often they fight disputes they should have refunded on day one, and pay a dispute fee on top.

Dispute Defender watches a seller's PayPal account. The moment a dispute opens, an agent:

1. **Investigates**: reads the dispute from PayPal, the payment and its Seller Protection status, the seller's own order record (tracking scans, delivery proof, digital access logs, support emails, warehouse notes) and the store's policy.
2. **Decides**: fight, negotiate, settle or refund, with a win probability and the expected-value maths behind it. It concedes quickly when the seller is in the wrong.
3. **Acts through PayPal**: messages the buyer, makes a settlement offer, escalates to a claim, submits typed evidence with a generated PDF evidence packet, or accepts the claim, all through the Disputes API.

The seller approves each plan with one click, or switches on **autopilot** and sets a refund limit.

Built for the PayPal AI Hackathon.

---

## Try it

**Hosted demo:** _add your Render URL here_

**Locally, in two minutes (no PayPal account needed):**

```bash
git clone <this repo> && cd dispute-defender
npm install
cp .env.example .env.local      # pick an AI provider; leave PayPal blank
npm run dev                     # http://localhost:3000
```

With no PayPal credentials the app runs against a built-in **PayPal simulator** that mirrors the Disputes API lifecycle (same states, same HATEOAS links, same error shapes), pre-loaded with five disputes. Add sandbox credentials and the same code talks to the real PayPal sandbox instead.

Requires Node 20+.

### A five-minute tour

1. **Disputes**: five open disputes; the agent analyses each one as it appears. Watch the *Agent's call* and *Win chance* columns fill in.
2. Open **Studio Monitor Headphones** (item not received). The agent found a signed-for delivery at the PayPal address and wants to fight. Read its reasoning trace, edit the drafted message if you like, press **Approve and send to PayPal**.
3. In *Play the other side*, make the buyer escalate to a claim. PayPal now asks for evidence; the agent re-runs by itself, prepares a `PROOF_OF_FULFILLMENT` submission with the tracking number, and attaches a PDF evidence packet. Approve it, then have PayPal rule.
4. Open **Hand-thrown Mug Set**. The carrier scanned it as destroyed in transit. The agent recommends refunding, and says why fighting would only add a fee.
5. Open **Wire Desk Lamp**. The warehouse note shows the wrong colour was packed. The agent proposes a settlement instead of a fight.
6. **Demo store**: buy something, dispute it as the buyer, and watch a brand-new dispute get picked up.
7. **Rules & autopilot**: turn autopilot on with a $25 limit. Small refunds and all evidence go out unattended; anything bigger still waits for you.

---

## How it uses PayPal

| PayPal capability | Where | What for |
|---|---|---|
| **Disputes API v1**: list, show | `src/lib/paypal.ts`, `src/lib/sync.ts` | Source of truth for every dispute, its thread, evidence requests and deadlines |
| Disputes: `send-message`, `make-offer`, `escalate`, `accept-claim` | `src/lib/agent.ts` → `executeRun` | The agent's actions during the inquiry stage |
| Disputes: `provide-evidence` (multipart, typed evidence + tracking info + PDF) | `src/lib/paypal.ts`, `src/lib/evidence-pdf.ts` | The agent's evidence submission on a claim |
| Disputes: `require-evidence`, `adjudicate` (sandbox-only) | `src/app/api/disputes/[id]/sandbox` | Stand in for PayPal's reviewer so the whole lifecycle can be demonstrated |
| **HATEOAS links** on the dispute | `src/lib/guardrails.ts` | The agent may only stage an action PayPal currently offers |
| **Orders API v2**: create, capture | `src/app/api/store` | Demo store checkout with the PayPal JS SDK |
| Orders: add tracking (`/track`) | capture route | Tracking is pushed to PayPal at fulfilment, which is itself dispute prevention |
| Disputes: `provide-supporting-info` (notes + PDF) | `src/lib/paypal.ts` | The agent's proof for PayPal's reviewer when a claim is already under review |
| **Payments API v2**: refund capture | agent tool `stage_refund_payment` | How the agent concedes when a claim is under review and `accept-claim` is not offered |
| **Payments API v2**: show capture | agent tool `get_payment_details` | Seller Protection eligibility feeds the win estimate |
| **Webhooks**: `CUSTOMER.DISPUTE.*` + `verify-webhook-signature` | `src/app/api/webhooks/paypal` | A new dispute starts the agent with nobody at the dashboard |

## How it uses AI

The agent is an LLM tool-use loop (`src/lib/agent.ts`). The model is pluggable through `AI_PROVIDER`:

| `AI_PROVIDER` | Model | Credentials |
|---|---|---|
| `nova` | Amazon Nova Pro on Amazon Bedrock (Converse API, `src/lib/nova.ts`) | AWS credential chain |
| `bedrock` | Claude on Amazon Bedrock | AWS credential chain |
| unset | Claude through the Anthropic API | `ANTHROPIC_API_KEY` |

The demo and the results described here were produced with **Amazon Nova Pro**.

- **Five read tools** (`get_dispute`, `get_order_record`, `get_payment_details`, `get_buyer_history`, `get_store_policy`) let it investigate before deciding.
- **`record_assessment`** comes first: the model must commit to a strategy before it is offered any write tool, and then sees only the write tools that fit that strategy and that PayPal allows right now.
- **Seven write tools** (`stage_send_message`, `stage_make_offer`, `stage_provide_evidence`, `stage_provide_supporting_info`, `stage_refund_payment`, `stage_accept_claim`, `stage_escalate_to_claim`) only *stage* an action. Tool inputs are schema-constrained (`strict: true`).
- **`record_assessment`** captures strategy and win probability as structured data; the expected-value figures are then computed in code from that probability, the disputed amount and the dispute fee, so the money always adds up.
- Once the dispute is loaded, the model is only offered the write tools PayPal currently allows.
- The full trace (reasoning summaries, every tool call and result) is stored and shown, so the seller can see why.

### Guardrails: the model decides, code enforces

An agent that can refund money needs limits that do not depend on the model behaving.

- The model cannot call a PayPal write endpoint. Only `executeRun` does, after approval or an autopilot check.
- Every action is validated when staged **and again against the live dispute at send time**: it must be an action PayPal currently offers, text within PayPal's limits, offer no greater than the disputed amount.
- Autopilot has a refund ceiling set by the seller. Anything above it waits for a human.
- A run is bound to one dispute; its tools take no dispute ID, so it cannot touch another.
- Buyer-written text is passed to the model labelled as untrusted, with instructions to treat it as information only. Even if that failed, the limits above are in code.
- The agent is told to use only facts its tools returned and never to invent evidence.

## How it uses AG Grid

The dispute inbox (`src/app/page.tsx`) is AG Grid Community with the Theming API: custom React cell renderers (status, strategy, win-probability bar, agent state), column filters and quick filter, live row updates keyed by `getRowId` while the agent works, a pinned totals row, and CSV export.

## Architecture

```
Browser (Next.js App Router, React 19, AG Grid)
   │  polls JSON
   ▼
Next.js route handlers ──────────────► PayPal REST (sandbox)   or   built-in simulator
   │        ▲                             Disputes · Orders · Payments · Webhooks
   │        └── webhook: CUSTOMER.DISPUTE.*
   ▼
sync.ts ── new or changed dispute ──► agent.ts (LLM tool loop)   
                                         │ read tools → PayPal + order records
                                         │ stage_* tools → guardrails.ts
                                         ▼
                                  plan awaiting approval ──► executeRun ──► PayPal write calls
```

State PayPal does not hold (order records, agent case files, settings) lives in one JSON file under `.data/`. If that file is lost, order records are rebuilt from the PayPal capture and the `custom_id` stored on it.

## Connect the PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials** (Sandbox) create a REST app. Copy the client ID and secret into `.env.local` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. Restart. The header pill changes to **PayPal sandbox**.
3. In **Demo store**, pay with the PayPal button using your sandbox *personal* account (Testing Tools → Sandbox Accounts shows its login).
4. Sign in to [sandbox.paypal.com](https://www.sandbox.paypal.com) as that buyer, open the payment and choose **Report a problem**.
5. The dispute appears under **Disputes** and the agent starts.
6. Optional, for instant pickup: add a webhook in your REST app pointing at `https://<your-host>/api/webhooks/paypal`, subscribed to the *Customer dispute* events, and set `PAYPAL_WEBHOOK_ID`. Signatures are then verified with PayPal.

## Deploy on Render

The repo has a `render.yaml` blueprint: **New → Blueprint**, select the repo, enter the secrets. The free plan's disk is not persistent; the app is built to tolerate that (see Architecture).

## What is simulated

- **The seller's order system.** PayPal does not know what happened to a parcel. A real seller's records would come from Shopify, WooCommerce or a carrier API; here `src/lib/oms.ts` generates them per product so each item exercises a different decision. Timelines run on an accelerated clock (minutes, not days) so a purchase can be disputed straight away.
- **PayPal's reviewer**, through PayPal's own sandbox-only endpoints.
- **PayPal itself, only when no credentials are set**, by the simulator in `src/lib/paypal-mock.ts`.

The dispute fee used in the maths is a setting; check PayPal's current fee schedule for your account.

## Tools used

Amazon Nova Pro on Amazon Bedrock for the agent (Claude supported as an alternative) · PayPal Disputes, Orders, Payments and Webhooks APIs and the PayPal JS SDK · AG Grid Community · Next.js, React, TypeScript · pdf-lib · Render.

## License

MIT
