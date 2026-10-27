/**
 * Human-readable home page, served to browsers (Accept: text/html). Agents and
 * scripts keep getting the JSON docs from the same URL.
 */

export interface HomeTool { path: string; param: string; example: string; price: string; summary: string }
export interface HomeInfo { origin: string; tools: HomeTool[]; payTo: string; chain: string; operator: string; contact: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Plain-language names; the API summary stays the source of truth for details. */
const TITLES: Record<string, string> = {
  "/transcribe": "Speech to text",
  "/read": "Web page to Markdown",
  "/email": "Email validation",
  "/domain": "Domain profile",
};
const ORDER = ["/transcribe", "/read", "/email", "/domain"];

/** Drop a short "Name: " prefix that only repeats the row title. */
const describe = (summary: string) => { const s = summary.replace(/^[^:]{1,20}:\s*/, ""); return s.charAt(0).toUpperCase() + s.slice(1); };

export function homePage(info: HomeInfo): string {
  const tools = [...info.tools].sort((a, b) => ORDER.indexOf(a.path) - ORDER.indexOf(b.path));
  const hero = tools[0];
  const heroCall = `${hero.path}?${hero.param}=${hero.example}`;
  const rows = tools.map((t) => `
      <tr>
        <th scope="row"><span class="name">${esc(TITLES[t.path] ?? t.path)}</span><code>GET ${esc(t.path)}?${esc(t.param)}=</code></th>
        <td>${esc(describe(t.summary))}</td>
        <td class="price">${esc(t.price)}<small>per call</small></td>
      </tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Automaton Agent Tools</title>
<meta name="description" content="Pay-per-call tools for AI agents: speech to text, web page to Markdown, email validation and domain profiles. USDC on ${esc(info.chain)} over x402, no account or API key.">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--paper:#f2f5f9;--surface:#fff;--ink:#16233a;--muted:#55657d;--line:#d6dde8;--usdc:#2775ca;--due:#b8650f;--ok:#1d7a52;--code:#0f1b2e;--code-ink:#dfe7f3}
@media (prefers-color-scheme:dark){:root{--paper:#0d1625;--surface:#132036;--ink:#e6ecf5;--muted:#9aa9bf;--line:#26354d;--usdc:#5a9be6;--due:#f0a24a;--ok:#4fc28c;--code:#08101c;--code-ink:#dfe7f3}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.6 "Instrument Sans",system-ui,sans-serif}
a{color:var(--usdc);text-underline-offset:3px}
a:focus-visible{outline:2px solid var(--usdc);outline-offset:3px;border-radius:2px}
code,pre{font-family:"JetBrains Mono",ui-monospace,monospace}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
header.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 0;color:var(--muted);font-size:15px}
header.top strong{color:var(--ink);font-weight:600}
.hero{display:grid;grid-template-columns:1fr 1.1fr;gap:56px;align-items:center;padding:48px 0 72px}
h1{font-size:clamp(40px,5.4vw,64px);line-height:1.02;letter-spacing:-.025em;font-weight:700;margin:0 0 22px}
.lede{font-size:19px;color:var(--muted);max-width:30em;margin:0 0 28px}
.facts{display:flex;flex-wrap:wrap;gap:10px 22px;margin:0;padding:0;list-style:none;font-size:15px}
.facts li{padding-left:16px;position:relative}
.facts li::before{content:"";position:absolute;left:0;top:.62em;width:7px;height:7px;border-radius:50%;background:var(--usdc)}
.exchange{background:var(--code);color:var(--code-ink);border-radius:14px;padding:26px 26px 22px;font:400 13.5px/1.7 "JetBrains Mono",monospace;box-shadow:0 30px 60px -30px rgba(15,27,46,.55)}
.exchange ol{margin:0;padding:0;list-style:none;counter-reset:s}
.exchange li{counter-increment:s;display:grid;grid-template-columns:26px 1fr;padding:10px 0;border-top:1px solid rgba(223,231,243,.12);overflow-wrap:anywhere}
.exchange li:first-child{border-top:0}
.exchange li::before{content:counter(s);color:#7d8ea8}
.exchange .st{font-weight:500}
.exchange .due{color:#f0a24a}.exchange .ok{color:#56d39b}.exchange .dim{color:#8ea0bb}
.exchange .amt{font-size:22px;color:#fff;font-weight:500}
section{padding:56px 0;border-top:1px solid var(--line)}
h2{font-size:30px;letter-spacing:-.015em;margin:0 0 10px;font-weight:650}
.sub{color:var(--muted);margin:0 0 28px;max-width:40em}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;vertical-align:top;padding:20px 16px 20px 0;border-bottom:1px solid var(--line)}
th{width:34%;font-weight:400}
th .name{display:block;font-size:20px;font-weight:600;margin-bottom:4px}
th code{font-size:13px;color:var(--muted)}
td{color:var(--muted);font-size:16px}
td.price{text-align:right;white-space:nowrap;padding-right:0;font-size:26px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
td.price small{display:block;font-size:13px;font-weight:400;color:var(--muted);letter-spacing:0}
.how{display:grid;grid-template-columns:1fr;gap:28px}.how>div{max-width:44em}
.how p{margin:0 0 14px}
pre{margin:0;background:var(--code);color:var(--code-ink);border-radius:12px;padding:22px;font-size:13.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
pre .c{color:#8ea0bb}
dl{display:grid;grid-template-columns:max-content 1fr;gap:10px 24px;margin:0;font-size:15px}
dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
footer{padding:40px 0 56px;border-top:1px solid var(--line);color:var(--muted);font-size:15px}
@media (max-width:820px){
  .hero,.how{grid-template-columns:1fr;gap:36px}.hero{padding:28px 0 48px}
  header.top{flex-direction:column;align-items:flex-start;gap:4px}
  table,tbody,tr,th,td{display:block;width:100%}
  tr{border-bottom:1px solid var(--line);padding:18px 0}
  th,td{border:0;padding:0}td{margin-top:8px}
  td.price{text-align:left;font-size:22px;margin-top:10px}td.price small{display:inline;margin-left:8px}
  dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}
}
</style>
</head>
<body>
<div class="wrap">
<header class="top"><strong>Automaton Agent Tools</strong><span>Run by ${esc(info.operator)}</span></header>

<main>
<div class="hero">
  <div>
    <h1>Pay-per-call tools for AI agents</h1>
    <p class="lede">Transcribe audio, read any web page as Markdown, validate emails and profile domains. Your agent pays a few cents in USDC per call: no account, no API key, no subscription.</p>
    <ul class="facts">
      <li>USDC on ${esc(info.chain)} via x402</li>
      <li>Charged only for a result</li>
      <li>Inputs and results not stored</li>
    </ul>
  </div>
  <div class="exchange" aria-label="How one paid call works">
    <ol>
      <li><span>GET <span class="dim">${esc(heroCall)}</span></span></li>
      <li><span><span class="st due">402 Payment Required</span><br><span class="amt">${esc(hero.price)}</span> <span class="dim">USDC to ${esc(info.payTo.slice(0, 6))}…${esc(info.payTo.slice(-4))}</span></span></li>
      <li><span>GET <span class="dim">same URL + PAYMENT-SIGNATURE</span></span></li>
      <li><span><span class="st ok">200 OK</span> <span class="dim">{ "text": "Welcome to the show…", "language": "en" }</span></span></li>
    </ol>
  </div>
</div>

<section aria-labelledby="tools">
  <h2 id="tools">Tools and prices</h2>
  <p class="sub">One flat price per call. Invalid input (400) and failures on our side or the target site (502) are never charged.</p>
  <table>
    <tbody>${rows}
    </tbody>
  </table>
</section>

<section aria-labelledby="how">
  <div class="how">
    <div>
      <h2 id="how">Call it from your agent</h2>
      <p>Any x402 client works. The first request answers 402 with the price; the client signs a USDC transfer and retries; you get the result.</p>
      <p>Machine-readable: <a href="/openapi.json">openapi.json</a> and <a href="/llms.txt">llms.txt</a>. The same URL returns JSON to non-browser clients.</p>
    </div>
<pre><code><span class="c">// npm i @x402/fetch @x402/core @x402/evm viem</span>
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(KEY) });
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay("${esc(info.origin)}${esc(heroCall)}");
console.log((await res.json()).text);</code></pre>
  </div>
</section>

<section aria-labelledby="details">
  <h2 id="details">Payment details</h2>
  <dl>
    <dt>Pay to</dt><dd><code>${esc(info.payTo)}</code></dd>
    <dt>Network</dt><dd>${esc(info.chain)}, USDC, x402 v2 exact scheme</dd>
    <dt>Contact</dt><dd><a href="mailto:${esc(info.contact)}">${esc(info.contact)}</a></dd>
  </dl>
</section>
</main>

<footer>Operated by ${esc(info.operator)}. Questions or a tool you need: <a href="mailto:${esc(info.contact)}">${esc(info.contact)}</a></footer>
</div>
</body>
</html>`;
}
