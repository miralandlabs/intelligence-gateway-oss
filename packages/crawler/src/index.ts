import { createClient } from "@supabase/supabase-js";
import { Entity, EntityInput, EntitySchema, verifyDomainControl } from "@miraland/intel-core";

const BATCH_SIZE = 8;
const DEFAULT_ENTITIES: EntityInput[] = [
  { entity_key: "cloudflare.com", entity_type: "vendor", display_name: "Cloudflare", domain: "cloudflare.com", endpoint_url: "https://www.cloudflare.com" },
  { entity_key: "stripe.com", entity_type: "vendor", display_name: "Stripe", domain: "stripe.com", endpoint_url: "https://stripe.com" },
  { entity_key: "github.com", entity_type: "vendor", display_name: "GitHub", domain: "github.com", endpoint_url: "https://github.com" },
  { entity_key: "supabase.com", entity_type: "vendor", display_name: "Supabase", domain: "supabase.com", endpoint_url: "https://supabase.com" },
  { entity_key: "vercel.com", entity_type: "vendor", display_name: "Vercel", domain: "vercel.com", endpoint_url: "https://vercel.com" },
  { entity_key: "netlify.com", entity_type: "vendor", display_name: "Netlify", domain: "netlify.com", endpoint_url: "https://www.netlify.com" },
  { entity_key: "auth0.com", entity_type: "vendor", display_name: "Auth0", domain: "auth0.com", endpoint_url: "https://auth0.com" },
  { entity_key: "okta.com", entity_type: "vendor", display_name: "Okta", domain: "okta.com", endpoint_url: "https://www.okta.com" },
  { entity_key: "twilio.com", entity_type: "vendor", display_name: "Twilio", domain: "twilio.com", endpoint_url: "https://www.twilio.com" },
  { entity_key: "sendgrid.com", entity_type: "vendor", display_name: "SendGrid", domain: "sendgrid.com", endpoint_url: "https://sendgrid.com" },
  { entity_key: "openai.com", entity_type: "vendor", display_name: "OpenAI", domain: "openai.com", endpoint_url: "https://openai.com" },
  { entity_key: "anthropic.com", entity_type: "vendor", display_name: "Anthropic", domain: "anthropic.com", endpoint_url: "https://www.anthropic.com" },
  { entity_key: "cursor.com", entity_type: "vendor", display_name: "Cursor", domain: "cursor.com", endpoint_url: "https://cursor.com" },
  { entity_key: "linear.app", entity_type: "vendor", display_name: "Linear", domain: "linear.app", endpoint_url: "https://linear.app" },
  { entity_key: "datadoghq.com", entity_type: "vendor", display_name: "Datadog", domain: "datadoghq.com", endpoint_url: "https://www.datadoghq.com" },
  { entity_key: "sentry.io", entity_type: "vendor", display_name: "Sentry", domain: "sentry.io", endpoint_url: "https://sentry.io" },
  { entity_key: "mongodb.com", entity_type: "vendor", display_name: "MongoDB", domain: "mongodb.com", endpoint_url: "https://www.mongodb.com" },
  { entity_key: "planetscale.com", entity_type: "vendor", display_name: "PlanetScale", domain: "planetscale.com", endpoint_url: "https://planetscale.com" },
  { entity_key: "snowflake.com", entity_type: "vendor", display_name: "Snowflake", domain: "snowflake.com", endpoint_url: "https://www.snowflake.com" },
  { entity_key: "notion.so", entity_type: "vendor", display_name: "Notion", domain: "notion.so", endpoint_url: "https://www.notion.so" },
];

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SEED_ENTITIES?: string;
  COLLECTOR_STATE: KVNamespace;
}

interface CollectorState {
  offset: number;
  last_run_at?: string;
}

interface SourceRef {
  id: string;
  source_key: string;
}

interface ObservationInput {
  entityId: string;
  source: SourceRef;
  observation_type: string;
  payload: Record<string, unknown>;
  confidence?: number;
}

const DEFAULT_STATE: CollectorState = { offset: 0 };

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCollectionBatch(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      const state = await loadState(env);
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      const { count } = await supabase
        .from("entities")
        .select("*", { count: "exact", head: true });
      return Response.json({
        cursor: state,
        indexed_entities: count ?? 0,
        batch_size: BATCH_SIZE,
        schedule: "every 4 hours (cron)",
        tip: "POST /reset to restart from offset 0",
      });
    }

    if (request.method === "POST" && url.pathname === "/reset") {
      await env.COLLECTOR_STATE.put("state", JSON.stringify(DEFAULT_STATE));
      return Response.json({ ok: true, message: "Collector cursor reset to offset 0." });
    }

    ctx.waitUntil(runCollectionBatch(env));
    return new Response(
      `Collector batch triggered (size=${BATCH_SIZE}). Check /status for progress.`,
      { status: 202, headers: { "Content-Type": "text/plain" } }
    );
  },
};

async function runCollectionBatch(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials");
    return;
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const state = await loadState(env);

  console.log(`=== Collector batch start | state=${JSON.stringify(state)} ===`);

  const entities = await loadEntities(env);
  const batch = sliceCircular(entities, state.offset, BATCH_SIZE);
  let processed = 0;

  for (const entity of batch) {
    const parsed = EntitySchema.safeParse(entity);
    if (!parsed.success) {
      console.warn("Entity validation failed, skipping", parsed.error.flatten());
      continue;
    }

    await collectVendorApiRiskSignals(supabase, parsed.data);
    processed++;
  }

  state.offset = entities.length === 0 ? 0 : (state.offset + processed) % entities.length;
  state.last_run_at = new Date().toISOString();
  await saveState(env, state);

  console.log(`=== Collector batch done: ${processed} entities processed | next=${JSON.stringify(state)} ===`);
}

async function loadEntities(env: Env): Promise<EntityInput[]> {
  if (!env.SEED_ENTITIES) return DEFAULT_ENTITIES;
  try {
    const parsed = JSON.parse(env.SEED_ENTITIES) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_ENTITIES;
    return parsed.map((item) => EntitySchema.parse(item));
  } catch (err) {
    console.warn("Invalid SEED_ENTITIES JSON, using defaults", err);
    return DEFAULT_ENTITIES;
  }
}

function sliceCircular<T>(items: T[], offset: number, limit: number): T[] {
  if (items.length === 0) return [];
  const result: T[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    result.push(items[(offset + i) % items.length]);
  }
  return result;
}

async function collectVendorApiRiskSignals(
  supabase: any,
  entity: Entity
): Promise<void> {
  const now = new Date().toISOString();
  const domain = entity.domain ?? deriveDomain(entity.endpoint_url ?? entity.entity_key);
  const endpointUrl = entity.endpoint_url ?? (domain ? `https://${domain}` : undefined);

  const domainVerified = domain && entity.owner_key
    ? await verifyDomainControl(domain, entity.owner_key)
    : false;

  const { data: entityRecord, error: entityError } = await supabase
    .from("entities")
    .upsert(
      {
        entity_key: entity.entity_key,
        entity_type: entity.entity_type,
        display_name: entity.display_name ?? entity.entity_key,
        domain,
        endpoint_url: endpointUrl,
        owner_key: entity.owner_key ?? null,
        metadata: entity.metadata ?? {},
        is_verified: domainVerified,
        updated_at: now,
      },
      { onConflict: "entity_key" }
    )
    .select()
    .single();

  if (entityError || !entityRecord) {
    console.error(`Entity upsert failed for ${entity.entity_key}:`, entityError?.message);
    return;
  }

  const observations: ObservationInput[] = [];
  if (domain) {
    observations.push(await collectDnsObservation(entityRecord.id, entity.entity_key, domain));
    observations.push(await collectSecurityTxtObservation(entityRecord.id, entity.entity_key, domain));
  }
  if (endpointUrl) {
    observations.push(await collectHttpObservation(entityRecord.id, entity.entity_key, endpointUrl));
  }

  const storedObservations = [];
  for (const observation of observations) {
    const { data: source, error: sourceError } = await supabase
      .from("sources")
      .upsert(
        {
          source_key: observation.source.source_key,
          source_type: observation.source.source_key.split(":")[0],
          entity_id: observation.entityId,
          url: sourceUrlFromObservation(observation),
          is_enabled: true,
        },
        { onConflict: "source_key" }
      )
      .select()
      .single();

    if (sourceError || !source) {
      console.warn(`Source upsert failed for ${observation.source.source_key}:`, sourceError?.message);
      continue;
    }

    const payloadHash = await hashPayload(observation.payload);
    const { data, error } = await supabase
      .from("observations")
      .insert({
        entity_id: observation.entityId,
        source_id: source.id,
        observation_type: observation.observation_type,
        payload: observation.payload,
        confidence: observation.confidence ?? 1,
        payload_hash: payloadHash,
        observed_at: now,
      })
      .select()
      .single();

    if (error) {
      console.warn(`Observation insert failed for ${entity.entity_key}:`, error.message);
      continue;
    }
    storedObservations.push(data);
  }

  const riskSignal = computeVendorApiRiskSignal(entity.entity_key, observations);
  await supabase.from("signals").upsert(
    {
      entity_id: entityRecord.id,
      signal_key: "vendor_api_risk",
      signal_type: "risk",
      score: riskSignal.score,
      recommendation: riskSignal.recommendation,
      payload: riskSignal.payload,
      computed_at: now,
    },
    { onConflict: "entity_id,signal_key" }
  );

  console.log(`Collected ${storedObservations.length} observations for ${entity.entity_key}`);
}

async function collectDnsObservation(entityId: string, entityKey: string, domain: string): Promise<ObservationInput> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`;
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { Accept: "application/dns-json" } }).catch(() => null);
  const payload = response
    ? { ok: response.ok, status: response.status, latency_ms: Date.now() - startedAt }
    : { ok: false, error: "dns_fetch_failed", latency_ms: Date.now() - startedAt };

  return {
    entityId,
    source: { id: "", source_key: `dns:${entityKey}` },
    observation_type: "dns_resolution",
    payload: { domain, ...payload },
  };
}

async function collectHttpObservation(entityId: string, entityKey: string, endpointUrl: string): Promise<ObservationInput> {
  const startedAt = Date.now();
  const response = await fetch(endpointUrl, { method: "GET", redirect: "follow" }).catch(() => null);
  const payload = response
    ? {
        ok: response.ok,
        status: response.status,
        latency_ms: Date.now() - startedAt,
        final_url: response.url,
      }
    : { ok: false, error: "http_fetch_failed", latency_ms: Date.now() - startedAt };

  return {
    entityId,
    source: { id: "", source_key: `http:${entityKey}` },
    observation_type: "http_health",
    payload: { endpoint_url: endpointUrl, ...payload },
  };
}

async function collectSecurityTxtObservation(entityId: string, entityKey: string, domain: string): Promise<ObservationInput> {
  const urls = [`https://${domain}/.well-known/security.txt`, `https://${domain}/security.txt`];
  for (const url of urls) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) {
      const body = await response.text();
      return {
        entityId,
        source: { id: "", source_key: `security_txt:${entityKey}` },
        observation_type: "security_txt",
        payload: {
          url,
          found: true,
          has_contact: /(^|\n)Contact:/i.test(body),
          has_expires: /(^|\n)Expires:/i.test(body),
          bytes: body.length,
        },
      };
    }
  }

  return {
    entityId,
    source: { id: "", source_key: `security_txt:${entityKey}` },
    observation_type: "security_txt",
    payload: { domain, found: false },
    confidence: 0.8,
  };
}

function computeVendorApiRiskSignal(entityKey: string, observations: ObservationInput[]) {
  let score = 100;
  const reasons: string[] = [];

  for (const observation of observations) {
    if (observation.observation_type === "dns_resolution" && observation.payload.ok === false) {
      score -= 30;
      reasons.push("DNS resolution failed");
    }
    if (observation.observation_type === "http_health" && observation.payload.ok === false) {
      score -= 35;
      reasons.push("HTTP endpoint is unhealthy");
    }
    if (observation.observation_type === "security_txt" && observation.payload.found === false) {
      score -= 10;
      reasons.push("security.txt was not found");
    }
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    recommendation: boundedScore >= 80 ? "monitor" : boundedScore >= 50 ? "review" : "block_or_escalate",
    payload: {
      entity_key: entityKey,
      reasons,
      observation_count: observations.length,
    },
  };
}

function sourceUrlFromObservation(observation: ObservationInput): string | null {
  const payload = observation.payload;
  if (typeof payload.url === "string") return payload.url;
  if (typeof payload.endpoint_url === "string") return payload.endpoint_url;
  if (typeof payload.domain === "string") return `https://${payload.domain}`;
  return null;
}

function deriveDomain(value: string): string | undefined {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return undefined;
  }
}

async function hashPayload(payload: Record<string, unknown>): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadState(env: Env): Promise<CollectorState> {
  try {
    const raw = await env.COLLECTOR_STATE.get("state");
    return raw ? (JSON.parse(raw) as CollectorState) : { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(env: Env, state: CollectorState): Promise<void> {
  await env.COLLECTOR_STATE.put("state", JSON.stringify(state));
}
