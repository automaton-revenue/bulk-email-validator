# bulk-email-validator

**Live endpoint: `https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/email`**

A pay-per-call HTTP API that validates a whole list of email addresses in one
request: syntax, real MX / domain deliverability, disposable and free-provider
flags, role accounts, typo suggestions, mail-provider detection, and an
aggregate summary so a caller can decide what to keep in one read.

## Who it is for

Dev teams that need quick **bulk** validation and don't want another dashboard,
API key, sales call or monthly minimum: paste your list into one HTTP call, get
machine-readable verdicts back, pay for the call you made. Built for people
wiring a signup pipeline, cleaning a CSV import, or gating a mailing before it
burns sender reputation.

## What it checks

`GET /emails?emails=a@x.com,b@y.com` (alias: `GET /email?emails=`) accepts up to
100 addresses in one call, separated by comma, semicolon, space or newline;
duplicates collapse and each distinct domain is probed once. Every address
comes back with a verdict and reasons:

- **Syntax** and normalization (lower-cased domain, local/domain split)
- **Domain deliverability**: real MX lookup, null-MX handling, A-record fallback
- **Disposable** domains (mailinator.com and friends), **free-provider** and
  **role-account** flags (`sales@`, `info@`)
- **Typo suggestions** (`gmial.com` → `gmail.com`) and detected mail provider
  (Google Workspace, Microsoft 365, …)

No SMTP handshake is performed: nothing is sent, no mailbox existence is probed,
and neither the addresses nor the results are stored. The `summary` object
counts `deliverable_domain`, `risky`, `undeliverable` and `invalid`.
Single-address validation stays available as `GET /email?email=` at $0.002.

## How to buy

Per-call **x402 payment on Base mainnet (`eip155:8453`) in USDC** — no account,
no API key.

1. `GET https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/emails?emails=...`
2. The first unpaid call answers **HTTP 402** with the x402 challenge (price,
   network, pay-to, facilitator).
3. Retry the same request with the payment header (any x402 client, e.g.
   `@x402/fetch`). The facilitator settles USDC and the response streams back.

Prices: **$0.01 per bulk call** (≤100 addresses, ≈$0.0001/address), $0.002 for a
single address. Prices and schemas are published in `/openapi.json`
(`x-payment-info` on every paid operation) and `/llms.txt` on the worker.
Invalid input (an empty or garbage `emails` value) answers `400` and is never
charged. Payments settle to the operator treasury
`0x528eB355837529314A28ab87a3A479Ad857e8698` via
`https://facilitator.payai.network`.

## Try it

```sh
curl -i "https://exp-xmvq1nitv-worker.automaton-agent.workers.dev/emails?emails=jane@gmial.com,sales@acme.io"
```

The 402 body is the decoded challenge; a paid retry with an x402 client returns
the per-address results plus the summary. Discovery (`/openapi.json`) is
Agentcash-compatible, so agent frameworks can find the price and scheme without
reading prose.

## Source & contact

- Source (TypeScript, Hono + @x402, vitest): https://github.com/automaton-revenue/bulk-email-validator
- Questions, abuse reports, refunds: **automaton-revenue@agentmail.to**

This service is **AI-built and human-supervised**: an autonomous agent wrote and
deployed the code under a supervisor's oversight.
