/**
 * Email check without sending mail: syntax, domain mail routing (MX, or the
 * A-record fallback of RFC 5321), disposable/free/role classification, typo
 * suggestions and the domain's SPF/DMARC posture. No SMTP probing (Workers
 * cannot open port 25, and probing mailboxes annoys receivers), so a "valid"
 * verdict means "this domain accepts mail", never "this mailbox exists".
 */
import { validateDomain, type Net } from "./net.js";

export type Verdict = "deliverable_domain" | "risky" | "undeliverable" | "invalid";

export interface EmailResult {
  email: string; normalized: string; local: string; domain: string;
  verdict: Verdict; reasons: string[];
  syntaxValid: boolean; mx: { host: string; priority: number }[]; acceptsMail: boolean | null; nullMx: boolean;
  disposable: boolean; freeProvider: boolean; roleAccount: boolean;
  suggestion: string | null; mailProvider: string | null;
  spf: boolean | null; dmarc: string | null;
  checkedAt: string;
}

// Widely used throwaway-mail domains (the long tail changes daily; this list covers the common services).
export const DISPOSABLE = new Set([
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com", "anonaddy.me", "burnermail.io", "discard.email", "dispostable.com",
  "dropmail.me", "emailondeck.com", "fakeinbox.com", "fakemail.net", "getairmail.com", "getnada.com", "guerrillamail.biz", "guerrillamail.com",
  "guerrillamail.de", "guerrillamail.info", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "harakirimail.com", "inboxbear.com",
  "inboxkitten.com", "mail.tm", "mail-temp.com", "mailcatch.com", "maildrop.cc", "mailinator.com", "mailinator.net", "mailinator2.com",
  "mailnesia.com", "mailpoof.com", "mailsac.com", "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "nada.email", "sharklasers.com",
  "spam4.me", "spambox.us", "spamgourmet.com", "temp-mail.io", "temp-mail.org", "tempail.com", "tempmail.com", "tempmail.dev", "tempmail.net",
  "tempmailo.com", "tempr.email", "throwawaymail.com", "tmail.ws", "tmpmail.net", "tmpmail.org", "trashmail.com", "trashmail.de", "trashmail.net",
  "yopmail.com", "yopmail.fr", "yopmail.net", "emailfake.com", "fakemailgenerator.com", "minuteinbox.com", "mail7.io", "linshiyouxiang.net",
  "byom.de", "trbvm.com", "grr.la", "pokemail.net", "spamdecoy.net", "mailforspam.com", "incognitomail.org", "jetable.org", "mvrht.net",
  "emltmp.com", "tempinbox.com", "fexbox.org", "rootfest.net", "zeroe.ml", "cuvox.de", "armyspy.com", "dayrep.com", "einrot.com", "fleckens.hu",
  "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
]);

export const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "ymail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "hotmail.fr", "hotmail.de", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.de", "gmx.net", "web.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "mail.ru", "qq.com", "163.com", "126.com",
  "wp.pl", "o2.pl", "onet.pl", "interia.pl", "op.pl", "tutanota.com", "tuta.io", "fastmail.com", "hey.com", "libero.it", "orange.fr", "free.fr",
  "laposte.net", "t-online.de", "seznam.cz", "naver.com", "rediffmail.com",
]);

const ROLE_LOCALS = new Set([
  "admin", "administrator", "billing", "contact", "enquiries", "help", "hello", "hi", "hostmaster", "info", "jobs", "careers", "legal", "mail",
  "marketing", "media", "noreply", "no-reply", "donotreply", "do-not-reply", "office", "postmaster", "press", "privacy", "root", "sales",
  "security", "support", "team", "abuse", "webmaster", "accounts", "accounting", "hr", "orders", "service", "feedback", "newsletter",
]);

const POPULAR = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "protonmail.com", "gmx.com", "live.com", "googlemail.com", "proton.me", "wp.pl", "onet.pl", "interia.pl", "o2.pl", "yandex.com", "mail.ru", "web.de"];

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

/** "gmial.com" → "gmail.com"; only for near-misses of very common mail domains. */
export function suggestDomain(domain: string): string | null {
  if (POPULAR.includes(domain)) return null;
  let best: string | null = null;
  let bestD = 3;
  for (const candidate of POPULAR) {
    const d = distance(domain, candidate);
    if (d < bestD && d <= (candidate.length > 8 ? 2 : 1)) { best = candidate; bestD = d; }
  }
  return best;
}

export function mailProviderOf(mxHosts: string[]): string | null {
  const joined = mxHosts.join(" ").toLowerCase();
  const providers: [RegExp, string][] = [
    [/google\.com|googlemail\.com/, "Google Workspace"], [/outlook\.com|protection\.outlook/, "Microsoft 365"], [/zoho\./, "Zoho Mail"],
    [/protonmail\.ch|proton\.me/, "Proton Mail"], [/messagingengine\.com/, "Fastmail"], [/yahoodns\.net/, "Yahoo"], [/icloud\.com|apple\.com/, "iCloud"],
    [/mimecast\./, "Mimecast"], [/pphosted\.com/, "Proofpoint"], [/secureserver\.net/, "GoDaddy"], [/ovh\.net/, "OVH"], [/mailgun\.org/, "Mailgun"],
    [/sendgrid\.net/, "SendGrid"], [/amazonaws\.com|amazonses/, "Amazon SES/WorkMail"], [/yandex\./, "Yandex"], [/home\.pl/, "home.pl"],
    [/emailsrvr\.com/, "Rackspace"], [/improvmx\.com/, "ImprovMX"], [/forwardemail\.net/, "Forward Email"], [/mx\.cloudflare\.net/, "Cloudflare Email Routing"],
  ];
  for (const [re, name] of providers) if (re.test(joined)) return name;
  return null;
}

const SYNTAX = /^(?!\.)(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}(?<!\.)@[^@\s]+$/i;

export function parseEmail(raw: string | undefined | null): { ok: true; email: string; local: string; domain: string } | { ok: false; reason: string } {
  const email = (raw ?? "").trim();
  if (!email) return { ok: false, reason: "email is required" };
  if (email.length > 254) return { ok: false, reason: "email longer than 254 characters" };
  if (!SYNTAX.test(email)) return { ok: false, reason: "not a syntactically valid email address" };
  const at = email.lastIndexOf("@");
  const domain = validateDomain(email.slice(at + 1));
  if (!domain.ok) return { ok: false, reason: `invalid domain: ${domain.reason}` };
  return { ok: true, email, local: email.slice(0, at), domain: domain.domain };
}

/** What one domain contributes to a verdict: probed once per domain and reused across a bulk list. */
export interface DomainProbe {
  mx: { host: string; priority: number }[];
  acceptsMail: boolean | null; nullMx: boolean;
  spf: boolean | null; dmarc: string | null; mailProvider: string | null;
}

/** MX, A fallback, SPF and DMARC of one domain. Returns null when the resolver itself failed. */
export async function probeDomain(domain: string, net: Net): Promise<DomainProbe | null> {
  const [mxAnswers, aAnswers, txt, dmarcTxt] = await Promise.all([net.dns(domain, "MX"), net.dns(domain, "A"), net.dns(domain, "TXT"), net.dns(`_dmarc.${domain}`, "TXT")]);
  if (mxAnswers === null) return null;

  const mx = mxAnswers.map((a) => { const [p, ...host] = a.data.split(/\s+/); return { priority: Number(p), host: host.join(" ").replace(/\.$/, "").toLowerCase() }; })
    .sort((x, y) => x.priority - y.priority);
  const nullMx = mx.length === 1 && (mx[0].host === "" || mx[0].host === ".");
  const acceptsMail = nullMx ? false : mx.length > 0 ? true : (aAnswers?.length ?? 0) > 0;
  const unquote = (s: string) => s.replace(/^"|"$/g, "").replace(/"\s*"/g, "");
  const spf = txt === null ? null : txt.some((t) => /^v=spf1\b/i.test(unquote(t.data)));
  const dmarcRecord = dmarcTxt?.map((t) => unquote(t.data)).find((t) => /^v=DMARC1/i.test(t)) ?? null;
  const dmarc = dmarcRecord ? (/\bp=(none|quarantine|reject)\b/i.exec(dmarcRecord)?.[1]?.toLowerCase() ?? "present") : (dmarcTxt === null ? null : "none-published");
  return { mx, acceptsMail, nullMx, spf, dmarc, mailProvider: mailProviderOf(mx.map((m) => m.host)) };
}

/** The invalid-input shape shared by the single and bulk endpoints. */
export function invalidResult(raw: string, reason: string): EmailResult {
  return {
    email: raw, normalized: raw.trim().toLowerCase(), local: "", domain: "", verdict: "invalid", reasons: [reason],
    syntaxValid: false, mx: [], acceptsMail: null, nullMx: false, disposable: false, freeProvider: false, roleAccount: false,
    suggestion: null, mailProvider: null, spf: null, dmarc: null, checkedAt: new Date().toISOString(),
  };
}

export async function checkEmail(raw: string, net: Net): Promise<EmailResult | { error: string }> {
  const parsed = parseEmail(raw);
  if (!parsed.ok) return invalidResult(raw, parsed.reason);
  const { local, domain } = parsed;
  const probe = await probeDomain(domain, net);
  if (probe === null) return { error: "DNS lookup failed; nothing was checked" };
  return assemble(raw, parsed.local, parsed.domain, probe);
}

/** Combine one parsed address with its (already probed) domain facts into a verdict. */
function assemble(raw: string, local: string, domain: string, probe: DomainProbe): EmailResult {
  const disposable = DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`));
  const freeProvider = FREE_PROVIDERS.has(domain);
  const roleAccount = ROLE_LOCALS.has(local.toLowerCase().split("+")[0]);
  const suggestion = suggestDomain(domain);

  const reasons: string[] = [];
  let verdict: Verdict = "deliverable_domain";
  if (!probe.acceptsMail) { verdict = "undeliverable"; reasons.push(probe.nullMx ? "domain publishes a null MX (accepts no mail)" : "domain has no MX or A record"); }
  else {
    reasons.push(probe.mx.length ? `domain accepts mail (${probe.mx.length} MX)` : "no MX; mail falls back to the A record");
    if (disposable) { verdict = "risky"; reasons.push("disposable / throwaway mail service"); }
    if (suggestion) { verdict = "risky"; reasons.push(`possible typo of ${suggestion}`); }
    if (roleAccount) reasons.push("role account (shared inbox, not a person)");
    if (!probe.mx.length) { verdict = "risky"; }
  }
  reasons.push("mailbox existence is not probed (no SMTP)");

  return {
    email: raw, normalized: `${local}@${domain}`, local, domain, verdict, reasons,
    syntaxValid: true, mx: probe.mx, acceptsMail: probe.acceptsMail, nullMx: probe.nullMx, disposable, freeProvider, roleAccount,
    suggestion: suggestion ? `${local}@${suggestion}` : null, mailProvider: probe.mailProvider,
    spf: probe.spf, dmarc: probe.dmarc, checkedAt: new Date().toISOString(),
  };
}

/** Split a bulk payload (commas, semicolons, whitespace or newlines) into unique addresses, preserving first-seen order. */
/** Split a submitted list into the addresses as received (order kept, duplicates kept):
 *  `requested` reports this count; deduplication happens later, in `bulkCheckEmail`. */
export function splitEmailList(raw: string): string[] {
  return raw.split(/[\s;,]+/).filter((token) => token !== "");
}

/** Cap on list size, so one call cannot fan out into thousands of subrequests. */
export const BULK_MAX = 100;
/** Distinct domains a single call will resolve (4 DNS lookups each); keeps the subrequest budget bounded. */
export const BULK_MAX_DOMAINS = 50;

/**
 * Shared gate for the bulk endpoint: the pre-paywall validator and the route
 * handler both call it, so a request that passes validation and reaches the
 * paywall is always answered 200, never a charged 400.
 */
export function parseBulkList(raw: string | undefined | null): { ok: true; inputs: string[] } | { ok: false; missing?: boolean; reason: string } {
  // A missing parameter is not invalid input: like every other tool, the bare
  // resource URL answers 402 (and an unpaid caller is never told anything else).
  // Only a value that is present but unusable (empty, too long, all garbage) is 400.
  if (raw === undefined || raw === null) return { ok: false, missing: true, reason: "emails is required, e.g. jane@gmial.com, sales@acme.io" };
  const list = splitEmailList(raw);
  if (list.length === 0) return { ok: false, reason: "emails is required, e.g. jane@gmial.com, sales@acme.io" };
  if (list.length > BULK_MAX) return { ok: false, reason: `too many addresses: ${list.length} as received (max ${BULK_MAX})` };
  if (!list.some((t) => parseEmail(t).ok)) return { ok: false, reason: "no syntactically valid email address in the list" };
  return { ok: true, inputs: list };
}

/**
 * Pre-paywall gate for /emails: same rules as `parseBulkList` for a value that is
 * present. (A missing parameter is decided before this runs: it falls through to
 * the paywall and answers 402, so it is never classified here.)
 */
export function validateBulk(raw: string): { ok: true; inputs: string[] } | { ok: false; reason: string } {
  const parsed = parseBulkList(raw);
  return parsed.ok ? parsed : { ok: false, reason: parsed.reason };
}

export interface BulkResult {
  requested: number; unique: number; checked: number; failed: number;
  summary: { deliverable_domain: number; risky: number; undeliverable: number; invalid: number };
  results: EmailResult[];
  /** Addresses whose domain could not be resolved; the caller can retry them. */
  errors: { email: string; error: string }[];
}

/**
 * Validate many addresses in one call. Each distinct domain is probed once (not
 * once per address) and the verdicts of duplicates are reused, so a 100-address
 * list over 20 domains costs 20 DNS round trips, not 400.
 */
export async function bulkCheckEmail(inputs: string[], net: Net): Promise<BulkResult> {
  // Duplicates collapse before validation, so an address repeated three times is
  // one `requested` entry in the results and counts once in the summary.
  const parsedList = inputs.map((raw) => ({ raw, parsed: parseEmail(raw) }));
  const deduped: typeof parsedList = [];
  const seenInputs = new Set<string>();
  for (const item of parsedList) {
    const key = item.parsed.ok ? item.parsed.email.toLowerCase() : `invalid:${item.raw.toLowerCase()}`;
    if (seenInputs.has(key)) continue;
    seenInputs.add(key);
    deduped.push(item);
  }
  const invalid = deduped.filter((p) => !p.parsed.ok);

  // Deduplicate by domain, then probe every distinct domain once, in parallel.
  const domains = new Map<string, Promise<DomainProbe | null>>();
  for (const { parsed } of parsedList) {
    if (!parsed.ok || domains.has(parsed.domain)) continue;
    domains.set(parsed.domain, probeDomain(parsed.domain, net));
  }

  const probes = new Map<string, DomainProbe | null>();
  await Promise.all([...domains].map(async ([domain, pending]) => { probes.set(domain, await pending); }));

  // One verdict per unique address; identical addresses share the same result.
  const uniqueKeys = new Set(parsedList.map(({ parsed, raw }) => parsed.ok ? parsed.email.toLowerCase() : `invalid:${raw.toLowerCase()}`));
  const byAddress = new Map<string, EmailResult>();
  const summary = { deliverable_domain: 0, risky: 0, undeliverable: 0, invalid: 0 };
  for (const { raw, parsed } of parsedList) {
    if (!parsed.ok) continue;
    const key = parsed.email.toLowerCase();
    if (byAddress.has(key)) continue;
    const probe = probes.get(parsed.domain);
    if (!probe) continue; // resolver failed for this domain; the address lands in errors below
    const result = assemble(raw, parsed.local, parsed.domain, probe);
    byAddress.set(key, result);
    summary[result.verdict] += 1;
  }

  const results: EmailResult[] = [...byAddress.values()];
  // Syntactically broken addresses keep their place in the list order: they are
  // reported as invalid verdicts, not dropped, so results align with the input.
  for (const { raw, parsed } of parsedList) {
    if (parsed.ok || byAddress.has(`invalid:${raw.toLowerCase()}`)) continue;
    results.push(invalidResult(raw, parsed.reason));
  }
  const errors: { email: string; error: string }[] = [];
  const erroredDomains = [...probes.entries()].filter(([, p]) => p === null).map(([d]) => d);
  for (const { raw, parsed } of parsedList) {
    if (!parsed.ok || byAddress.has(parsed.email.toLowerCase())) continue;
    if (!erroredDomains.includes(parsed.domain)) continue;
    if (!errors.some((e) => e.email.toLowerCase() === raw.toLowerCase())) errors.push({ email: raw, error: "DNS lookup failed for this domain" });
  }

  return {
    requested: inputs.length, unique: uniqueKeys.size, checked: results.length, failed: errors.length,
    summary: { ...summary, invalid: invalid.length },
    results,
    errors,
  };
}
