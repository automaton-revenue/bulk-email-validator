/**
 * HTTP surface and the end-to-end payment path with the official x402 client:
 * a throwaway key signs a real EIP-3009 authorization and a fake facilitator
 * stands in for the chain (no funds move).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createApp } from "../src/app.js";
import { isSettled } from "../src/edge.js";
import type { Net } from "../src/net.js";

const env = { PAY_TO: "0x528eB355837529314A28ab87a3A479Ad857e8698", NETWORK: "eip155:8453", PRICE_READ: "$0.003", PRICE_EMAIL: "$0.002", PRICE_EMAILS: "$0.01", PRICE_DOMAIN: "$0.01", PRICE_TRANSCRIBE: "$0.03", FACILITATOR_URL: "https://facilitator.invalid" };
const noFacilitator = { verify: async () => ({ isValid: false, invalidReason: "test" }), settle: async () => ({ success: false }), getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: [], signers: {} }) };

let runs = 0;
const net: Net = {
  async page(url) { runs += 1; return url.startsWith("https://up.example.org") ? { status: 200, finalUrl: url, contentType: "text/html", headers: {}, body: "<body><main><h1>Hi</h1><p>Hello world from a page that is up.</p></main></body>", ms: 5 } : null; },
  async dns(name, type) { runs += 1; return type === "MX" && (name === "acme.io" || name === "up.example.org") ? [{ name, type: 15, data: `10 mx.${name}.` }] : []; },
  async rdap() { return null; },
};

function fakeFacilitator() {
  const calls = { verify: 0, settle: 0, payTo: "", amount: "" };
  const client = {
    async verify(_p: unknown, req: { payTo: string; amount: string }) { calls.verify += 1; calls.payTo = req.payTo; calls.amount = req.amount; return { isValid: true, payer: "0x0000000000000000000000000000000000000001" }; },
    async settle() { calls.settle += 1; return { success: true, transaction: "0xabc", network: "eip155:8453", payer: "0x0000000000000000000000000000000000000001" }; },
    async getSupported() { return { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: [], signers: {} }; },
  };
  return { client, calls };
}
function payingFetch(app: ReturnType<typeof createApp>) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) as never, networks: ["eip155:8453"] });
  return wrapFetchWithPayment(((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch, client);
}

describe("agent tools API", () => {
  it("free docs, llms.txt, favicon and an Agentcash Discovery openapi.json listing all five paid tools", async () => {
    const app = createApp(env, noFacilitator as never, net);
    const docs = await (await app.request("/")).json() as { endpoints: { price: string }[]; operator: string };
    expect(docs.endpoints.map((e) => e.price)).toEqual(["$0.003", "$0.002", "$0.01", "$0.01", "$0.03"]);
    expect(docs.operator).toMatch(/AI agent/);
    expect(await (await app.request("/llms.txt")).text()).toContain("GET /email");
    const page = await app.request("/", { headers: { Accept: "text/html,application/xhtml+xml" } });
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    const html = await page.text();
    for (const s of ["GET /transcribe?url=", "$0.03", "$0.003", env.PAY_TO, "/openapi.json"]) expect(html).toContain(s);
    expect((await app.request("/favicon.ico")).headers.get("content-type")).toBe("image/svg+xml");
    const spec = await (await app.request("https://tools.example/openapi.json")).json() as { info: { contact: { email: string } }; paths: Record<string, { get: { security: unknown; "x-payment-info": { price: { amount: string } } } }> };
    expect(spec.info.contact.email).toBe("automaton-revenue@agentmail.to");
    expect(Object.keys(spec.paths)).toEqual(["/read", "/email", "/emails", "/domain", "/transcribe"]);
    expect(spec.paths["/domain"].get.security).toEqual([]);
    expect(spec.paths["/email"].get["x-payment-info"].price.amount).toBe("0.002");
  });

  it("unpaid GET, HEAD and the bare resource URL answer 402 and never run a tool", async () => {
    const app = createApp(env, noFacilitator as never, net);
    runs = 0;
    for (const req of [new Request("http://x/read?url=https://up.example.org/"), new Request("http://x/email?email=a@acme.io", { method: "HEAD" }), new Request("http://x/domain")]) {
      const res = await app.fetch(req);
      expect(res.status).toBe(402);
      expect(res.headers.get("payment-required")).toBeTruthy();
    }
    expect(runs).toBe(0);
  });

  it("invalid input is rejected before the paywall (not charged)", async () => {
    const app = createApp(env, noFacilitator as never, net);
    expect((await app.request("/read?url=http://127.0.0.1/")).status).toBe(400);
    expect((await app.request("/email?email=not-an-email")).status).toBe(400);
    expect((await app.request("/domain?domain=localhost")).status).toBe(400);
  });

  it("a paid call settles the exact price to the treasury and returns the result", async () => {
    const { client, calls } = fakeFacilitator();
    const app = createApp(env, client as never, net);
    const res = await payingFetch(app)("https://api.test/email?email=jane@acme.io");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verdict: "deliverable_domain", operator: expect.stringMatching(/AI agent/) });
    expect(calls).toMatchObject({ verify: 1, settle: 1, amount: "2000" });
    expect(calls.payTo.toLowerCase()).toBe(env.PAY_TO.toLowerCase());
  });

  it("bulk /emails rejects bad lists before the paywall (not charged)", async () => {
    const app = createApp(env, noFacilitator as never, net);
    runs = 0;
    // A missing parameter is an unpaid request, not bad input: like every other
    // tool, the bare /emails answers 402 so x402 buyers discover the terms.
    const bare = await app.request("/emails");
    expect(bare.status).toBe(402);
    expect(bare.headers.get("payment-required")).toBeTruthy();
    // A present-but-unusable value is invalid input: 400, never charged.
    for (const q of ["emails=", "emails=,,,not-an-email", `emails=${Array.from({ length: 101 }, (_, i) => `a${i}@acme.io`).join(",")}`]) {
      const res = await app.request(`/emails?${q}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ charged: false, usage: expect.stringContaining("/emails") });
    }
    expect(runs).toBe(0);
  });

  it("a paid /emails settles $0.01 and returns per-address verdicts; duplicates and bad syntax share one answer", async () => {
    const { client, calls } = fakeFacilitator();
    const app = createApp(env, client as never, net);
    runs = 0;
    const list = encodeURIComponent("jane@acme.io,JANE@ACME.IO,broken-no-at,sales@acme.io,mark@up.example.org");
    const res = await payingFetch(app)(`https://api.test/emails?emails=${list}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { requested: number; unique: number; summary: { deliverable_domain: number; invalid: number }; results: { email: string; verdict: string }[]; errors: unknown[] };
    // 5 raw entries -> 4 unique (jane@acme.io == JANE@ACME.IO case-insensitively)
    expect(body.requested).toBe(5);
    expect(body.unique).toBe(4);
    expect(body.summary).toMatchObject({ deliverable_domain: 3, invalid: 1 });
    // One verdict per unique address (the JANE@ACME.IO duplicate collapses into the
    // first result); syntactically broken entries are reported once, after them.
    expect(body.results.map((r) => r.email)).toEqual(["jane@acme.io", "sales@acme.io", "mark@up.example.org", "broken-no-at"]);
    expect(body.results.map((r) => r.verdict)).toEqual(["deliverable_domain", "deliverable_domain", "deliverable_domain", "invalid"]);
    expect(body.errors).toEqual([]);
    expect(calls).toMatchObject({ verify: 1, settle: 1, amount: "10000" });
    // Three acme.io addresses share one domain probe; up.example.org gets its own:
    // 2 distinct domains x 4 DNS lookups (MX, A, TXT, DMARC) = 8, not 4 addresses x 4 = 16.
    expect(runs).toBe(8);
  });

  it("an upstream failure is never settled", async () => {
    const { client, calls } = fakeFacilitator();
    const app = createApp(env, client as never, net);
    const res = await payingFetch(app)("https://api.test/read?url=https://down.example.org/");
    expect(res.status).toBe(502);
    expect(calls.settle).toBe(0);
  });

  it("a paid /transcribe settles $0.03 and returns the transcript; without the AI binding it is a 502, never settled", async () => {
    const audio = async () => ({ status: 200, contentType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]), tooLarge: false });
    const ai = { async run() { return { text: " Hello agents. ", word_count: 2, transcription_info: { language: "en", duration: 1.23 }, segments: [{ start: 0, end: 1.2, text: " Hello agents." }], vtt: "WEBVTT" }; } };
    const paid = fakeFacilitator();
    const res = await payingFetch(createApp({ ...env, AI: ai }, paid.client as never, net, audio))("https://api.test/transcribe?url=https://up.example.org/a.mp3");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "Hello agents.", language: "en", durationSeconds: 1.2, words: 2, segments: [{ start: 0, end: 1.2, text: "Hello agents." }] });
    expect(paid.calls).toMatchObject({ settle: 1, amount: "30000" });
    const unconfigured = fakeFacilitator();
    const down = await payingFetch(createApp(env, unconfigured.client as never, net, audio))("https://api.test/transcribe?url=https://up.example.org/a.mp3");
    expect(down.status).toBe(502);
    expect(unconfigured.calls.settle).toBe(0);
  });
});

describe("buyer-agent compatibility", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const decode = (h: string | null) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(h!), (ch) => ch.charCodeAt(0))));

  it("CORS headers on 402, 400, 200, HEAD and 404 responses", async () => {
    const app = createApp(env, noFacilitator as never, net);
    const cases: [Request, number][] = [
      [new Request("http://x/email?email=a@b.co"), 402],
      [new Request("http://x/email?email=not-an-email"), 400],
      [new Request("http://x/health"), 200],
      [new Request("http://x/email?email=a@b.co", { method: "HEAD" }), 402],
      [new Request("http://x/nope"), 404],
    ];
    for (const [req, status] of cases) {
      const res = await app.fetch(req);
      expect(res.status).toBe(status);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-expose-headers")).toBe("PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, Content-Type");
    }
  });

  it("OPTIONS on any path answers 204 with the preflight headers and never meets the paywall", async () => {
    const app = createApp(env, noFacilitator as never, net);
    for (const path of ["/email?email=a@b.co", "/read", "/anything"]) {
      const res = await app.fetch(new Request(`http://x${path}`, { method: "OPTIONS", headers: { Origin: "https://agent.example", "Access-Control-Request-Method": "GET" } }));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
      expect(res.headers.get("access-control-allow-headers")).toBe("PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Authorization, Access-Control-Expose-Headers");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
      expect(res.headers.get("payment-required")).toBeNull();
    }
  });

  it("an unpaid 402 carries the decoded PAYMENT-REQUIRED as its JSON body; HEAD stays bodiless", async () => {
    const app = createApp(env, noFacilitator as never, net);
    const res = await app.request("/email?email=a@b.co");
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json() as { x402Version: number; accepts: { amount: string }[]; extensions: { bazaar?: unknown } };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0].amount).toBe("2000");
    expect(body.extensions.bazaar).toBeTruthy();
    expect(body).toEqual(decode(res.headers.get("payment-required")));
    const head = await app.request("/email?email=a@b.co", { method: "HEAD" });
    expect(head.status).toBe(402);
    expect(await head.text()).toBe("");
  });

  it("Bazaar metadata fits the facilitator caps: service name <= 32 chars, <= 5 tags", async () => {
    const app = createApp(env, noFacilitator as never, net);
    for (const path of ["/read", "/email", "/domain"]) {
      const body = await (await app.request(path)).json() as { resource: { serviceName: string; tags: string[]; description: string } };
      expect(body.resource.serviceName.length).toBeLessThanOrEqual(32);
      expect(body.resource.tags.length).toBeLessThanOrEqual(5);
    }
    const email = await (await app.request("/email")).json() as { resource: { serviceName: string; tags: string[]; description: string } };
    expect(email.resource.serviceName).toBe("Automaton Email Validation");
    expect(email.resource.tags).toEqual(expect.arrayContaining(["email-validation", "email-verification"]));
    expect(email.resource.description).toMatch(/\$0\.002 per call in USDC on Base/);
  });

  it("openapi.json: 200 and parameter schemas, a 402 schema matching the runtime body, paid ops classified by x-payment-info", async () => {
    const app = createApp(env, noFacilitator as never, net);
    type Op = { security: unknown; summary: string; description: string; tags: string[]; "x-payment-info": unknown; parameters: { schema: { type: string; format: string } }[]; responses: Record<string, { description: string; content?: { "application/json": { schema: { type: string; properties: Record<string, unknown> }; example: { accepts: Record<string, unknown>[] } } } }> };
    const spec = await (await app.request("https://tools.example/openapi.json")).json() as { info: Record<string, unknown>; "x-agentcash-guidance": { llmsTxtUrl: string }; paths: Record<string, { get: Op }> };
    expect(spec.info["x-guidance"]).toBeTruthy();
    expect(spec["x-agentcash-guidance"].llmsTxtUrl).toBe("https://tools.example/llms.txt");
    // /domain has no format: it also accepts a pasted URL or an email and keeps the host.
    const formats: Record<string, string | undefined> = { "/read": "uri", "/email": "email", "/domain": undefined, "/transcribe": "uri" };
    for (const [path, { get: op }] of Object.entries(spec.paths)) {
      // AgentCash Discovery: `security: []` + x-payment-info => "paid" (no API key needed).
      expect(op.security).toEqual([]);
      expect(op["x-payment-info"]).toBeTruthy();
      expect(op.parameters[0].schema.type).toBe("string");
      expect(op.parameters[0].schema.format).toBe(formats[path]);
      const ok = op.responses["200"].content!["application/json"].schema;
      expect(ok.type).toBe("object");
      expect(Object.keys(ok.properties).length).toBeGreaterThan(5);
      const pr = op.responses["402"];
      expect(pr.description).toMatch(/Payment Required/);
      const example = pr.content!["application/json"].example.accepts[0];
      const runtime = (await (await app.request(path)).json() as { accepts: Record<string, unknown>[] }).accepts[0];
      for (const k of ["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds"]) expect(example[k]).toEqual(runtime[k]);
    }
    const email = spec.paths["/email"].get;
    expect(email.tags).toEqual(expect.arrayContaining(["email-validation", "email-verification", "disposable-email", "mx-record-check", "spf-dmarc"]));
    for (const phrase of [/deliverability/i, /MX record check/, /disposable email detection/, /SPF and DMARC/, /No SMTP handshake/, /No PII stored/, /\$0\.002 per call in USDC on Base/]) {
      expect(email.description).toMatch(phrase);
    }
  });

  it("logs one privacy-safe JSON line per request: paid and settled flags, no query values", async () => {
    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => { lines.push(JSON.parse(String(s))); });
    const { client } = fakeFacilitator();
    const app = createApp(env, client as never, net);
    const res = await payingFetch(app)("https://api.test/email?email=jane@acme.io", { headers: { "User-Agent": "test-agent/1.0" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("payment-response")).toBeTruthy();
    await app.request("/email?email=jane@acme.io", { method: "HEAD" });
    expect(lines).toHaveLength(3); // unpaid 402, paid 200, HEAD (its internal GET is not logged)
    expect(lines[0]).toMatchObject({ evt: "req", path: "/email", method: "GET", status: 402, paid: false, settled: false });
    expect(lines[1]).toMatchObject({ evt: "req", path: "/email", method: "GET", status: 200, paid: true, settled: true, ua: "test-agent/1.0" });
    expect(lines[2]).toMatchObject({ path: "/email", method: "HEAD", status: 402, paid: false });
    expect(typeof lines[1].ms).toBe("number");
    expect(JSON.stringify(lines)).not.toMatch(/jane|acme/);
  });
});

describe("reviewer fixes", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("preflight echoes Access-Control-Request-Headers, so the @x402/fetch paid retry passes CORS", async () => {
    const app = createApp(env, noFacilitator as never);
    const res = await app.fetch(new Request("http://x/anything", { method: "OPTIONS", headers: { Origin: "https://agent.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "payment-signature, access-control-expose-headers" } }));
    expect(res.status).toBe(204);
    const allowed = res.headers.get("access-control-allow-headers")!.toLowerCase();
    expect(allowed).toContain("payment-signature");
    expect(allowed).toContain("access-control-expose-headers");
    expect(res.headers.get("vary")).toMatch(/Access-Control-Request-Headers/);
  });

  it("settled only for a successful response that carries PAYMENT-RESPONSE", () => {
    const h = { "PAYMENT-RESPONSE": "e30=" };
    expect(isSettled(new Response("{}", { status: 200, headers: h }))).toBe(true);
    expect(isSettled(new Response("{}", { status: 402, headers: h }))).toBe(false); // failed settlement
    expect(isSettled(new Response("{}", { status: 200 }))).toBe(false);
  });
});

describe("failed settlement", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("answers 402 that still carries PAYMENT-RESPONSE, and is logged as paid but not settled", async () => {
    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => { lines.push(JSON.parse(String(s))); });
    const { client } = fakeFacilitator();
    const failing = { ...client, async settle() { return { success: false, errorReason: "insufficient_funds", transaction: "", network: "eip155:8453" }; } };
    const app = createApp(env, failing as never, net);
    const url = "https://api.test/email?email=jane@acme.io";
    const first = await app.request(url);
    const payer = new x402Client();
    registerExactEvmScheme(payer, { signer: privateKeyToAccount(generatePrivateKey()) as never, networks: ["eip155:8453"] });
    const http = new x402HTTPClient(payer);
    const payload = await payer.createPaymentPayload(http.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json()));
    const res = await app.request(url, { headers: http.encodePaymentSignatureHeader(payload) });
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-response")).toBeTruthy();
    expect(lines[lines.length - 1]).toMatchObject({ path: "/email", status: 402, paid: true, settled: false });
  });
});
