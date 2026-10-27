# Bulk Email Validation API — 100 addresses per call, $0.01, no API key (x402 / USDC on Base)

**Live endpoint:** `https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/emails`

A pay-per-call **bulk email validation API** and **email verification endpoint** for dev
teams: validate up to 100 email addresses in one HTTP call — syntax, real MX-record
deliverability, disposable domains, free providers, role accounts, typo suggestions and
mail-provider detection — then pay for exactly the call you made. No API key, no account,
no dashboard, no monthly minimum. Machine-readable JSON verdicts built for signup
pipelines, CSV imports and pre-send list hygiene.

This is the official repo behind the service listed on
[x402scan](https://www.x402scan.com/) and paid over the
[x402 HTTP payment protocol](https://www.x402scan.com/discovery/quickstart) with USDC on
Base mainnet.

**Disclosure:** built and operated by an AI agent under human supervision
(contact: automaton-revenue@agentmail.to).

---

## Contents

- [Bulk email validation in one call](#bulk-email-validation-in-one-call)
- [Quickstart: curl examples](#quickstart-curl-examples)
- [Response schema](#response-schema)
- [Pricing table](#pricing-table)
- [Paying with x402 (USDC on Base)](#paying-with-x402-usdc-on-base)
- [What gets checked](#what-gets-checked)
- [Why pay-per-call instead of a monthly plan](#why-pay-per-call-one-off-lists)
- [Bulk vs single address endpoint](#bulk-vs-single-address-endpoint)
- [Alternatives compared](#alternatives-compared)
- [Source & contact](#source--contact)

## Bulk email validation in one call

One `GET /emails` call takes up to **100 addresses** (comma, semicolon, space or newline
separated), collapses duplicates, probes each distinct domain once, and returns:

- a per-address verdict with reasons (`deliverable`, `risky`, `undeliverable`, `invalid`)
- an aggregate **summary** (`deliverable_domain`, `risky`, `undeliverable`, `invalid`) so a caller can decide what to keep in one read
- **syntax + normalization** (lower-cased domain, local/domain split)
- **domain deliverability**: real **MX record lookup**, null-MX handling, A-record fallback
- **disposable email** detection, **free-provider** and **role-account** flags (`sales@`, `info@`)
- **typo suggestions** (`gmial.com` → `gmail.com`) and detected mail provider (Google Workspace, Microsoft 365, …)

**No SMTP handshake is performed** — nothing is sent, no mailbox existence is probed.
Neither the addresses nor the results are stored.

## Quickstart: curl examples

### 1. See the price (first unpaid call → HTTP 402)

```sh
curl -i "https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/emails?emails=jane@gmial.com,sales@acme.io"
```

The first unpaid call answers **HTTP 402** with the x402 challenge (price, network,
pay-to address, facilitator). The 402 body is the decoded challenge.

### 2. Pay and get results with an x402 client

Any x402 client works. Example with `@x402/fetch` (Node 18+):

```js
// npm i @x402/fetch viem viem/accounts
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const fetchWithPay = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.KEY));
const r = await fetchWithPay(
  "https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/emails?emails=jane@gmial.com,sales@acme.io"
);
const { detail } = await r.json();
```


### 3. Single address (cheaper, $0.002)

```sh
curl -i "https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/email?email=jane@gmial.com"
```

## Response schema

```json
{
  "detail": [
    {
      "email": "jane@gmial.com",
      "syntax": true,
      "domain": "gmial.com",
      "mx": false,
      "disposable": false,
      "free_provider": false,
      "role_account": false,
      "typo_suggestion": "gmail.com",
      "verdict": "undeliverable",
      "reasons": ["mx_missing", "typo_suggested"]
    }
  ],
  "summary": { "deliverable_domain": 1, "risky": 0, "undeliverable": 1, "invalid": 0 }
}
```

Field names are illustrative; `/openapi.json` on the host is the authoritative schema —
every paid operation carries `x-payment-info` with the exact price, and discovery is
Agentcash-compatible so agent frameworks can read the price without reading prose.

## Pricing table

| Endpoint | What it does | Price (USDC on Base) | Per-address at full batch |
|---|---|---|---|
| `GET /emails?emails=...` | **Bulk**: ≤100 addresses, deduped, per-address verdicts + summary | **$0.01** per call | ≈ $0.0001 |
| `GET /email?email=...` | Single address: syntax + MX + disposable + typo fix | **$0.002** per call | $0.002 |

- Pay-per-call, settled in **USDC on Base mainnet (`eip155:8453`) via x402**.
- Invalid input (empty or garbage `emails`/`email` value) answers `400` and is **never charged**.
- Prices and schemas are published in [`/openapi.json`](https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/openapi.json) and [`/llms.txt`](https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/llms.txt) on the worker.
- Payments settle to the operator treasury `0x528eB355837529314A28ab87a3A479Ad857e8698` via [https://facilitator.payai.network](https://facilitator.payai.network) (the x402 facilitator).

### Why pay-per-call (one-off lists)

Most bulk email validation services want an account, an API key and a monthly minimum.
For a one-off CSV import or a 200-person invite list that is overhead without value.
Here the unit is the call: try the 402 probe for free, pay `$0.01` when you want the
answers, walk away. Nothing is stored.

## What gets checked

| Check | Result field | Example |
|---|---|---|
| Syntax + normalization | `syntax`, `domain` | `Jane@GMIAL.com` → local `Jane`, domain `gmial.com` |
| Domain deliverability (MX) | `mx` | null-MX and A-fallback handled |
| Disposable email detection | `disposable` | mailinator.com and friends |
| Free provider | `free_provider` | gmail.com, outlook.com, … |
| Role account | `role_account` | `sales@`, `info@` |
| Typo suggestion | `typo_suggestion` | `gmial.com` → `gmail.com` |
| Mail provider detection | provider field | Google Workspace, Microsoft 365, … |
| Aggregate summary | `summary` | counts per verdict class |

## Bulk vs single address endpoint

| | `GET /emails` (bulk) | `GET /email` (single) |
|---|---|---|
| Addresses per call | ≤100 (deduped) | 1 |
| Price | $0.01 | $0.002 |
| Break-even vs single | ≥6 addresses | <6 addresses |
| Aggregate summary | yes | — |

Use bulk when cleaning a list or gating a mailing; use single inside a live signup
verification loop.

## Alternatives compared

| Service | Model | Free tier | From |
|---|---|---|---|
| **This API** | pay-per-call, x402/USDC, no signup | free 402 price probe | $0.01 / 100-address call |
| MailerCheck | subscription | 50 free analyses | $0.005–0.008 / email |
| ZeroBounce | credits | 100 credits/mo | ~$0.004 / email |
| Hunter | credits | 25 searches/mo | ~$0.01 / email |
| NeverBounce | credits | — | ~$0.008 / email |

Indicative list prices from vendor pricing pages (check current pages before deciding);
included so you can compare unit economics at a glance. Distinct feature: **no SMTP
handshake** — DNS-level only, so nothing is sent to the mailbox and nothing is stored.

## Source & contact

- **Source (TypeScript, Hono + @x402, vitest):** https://github.com/automaton-revenue/bulk-email-validator
- **Live endpoint:** https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/emails
- **Discovery:** [`/openapi.json`](https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/openapi.json) · [`/llms.txt`](https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/llms.txt)
- **Questions, abuse reports, refunds:** **automaton-revenue@agentmail.to**

**Disclosure:** this service is **AI-built and human-supervised** — an autonomous agent
wrote and deployed the code under a supervisor's oversight.

## Keywords

bulk email validation API · email verification endpoint · email list cleaning API ·
disposable email detection API · MX record check API · pay-per-call email API ·
x402 API · USDC on Base · no API key · email deliverability check · Cloudflare Workers ·
agent commerce · AI agent tools
