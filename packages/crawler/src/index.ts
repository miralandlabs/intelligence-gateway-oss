import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  computeReadiness,
  computeTrustQualitySignal,
  Entity,
  EntityInput,
  EntitySchema,
  getPaymentModel,
  getProbeUrl,
  parseSds,
  readinessCacheKey,
  requiresPaidProbe,
  verifyDomainControl,
} from "@miraland/intel-core";

const BATCH_SIZE = 12;

const DEFAULT_ENTITIES: EntityInput[] = [
  { entity_key: "cloudflare.com", entity_type: "vendor", display_name: "Cloudflare", domain: "cloudflare.com", endpoint_url: "https://www.cloudflare.com" },
  { entity_key: "stripe.com", entity_type: "vendor", display_name: "Stripe", domain: "stripe.com", endpoint_url: "https://stripe.com" },
];

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SEED_ENTITIES?: string;
  ALLOW_DEMO_ENTITIES?: string;
  COLLECTOR_STATE: KVNamespace;
  READINESS_CACHE: KVNamespace;
}

interface CollectorState {
  offset: number;
  last_run_at?: string;
}

interface MonitoredEntityRow {
  id: string;
  entity_key: string;
  entity_type: string;
  display_name: string | null;
  domain: string | null;
  endpoint_url: string | null;
  owner_key: string | null;
  metadata: Record<string, unknown>;
  is_verified: boolean;
  monitor_tier: number;
  watchlist_owner: string | null;
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
      const { count: totalCount } = await supabase
        .from("entities")
        .select("*", { count: "exact", head: true });
      const { count: monitoredCount } = await supabase
        .from("entities")
        .select("*", { count: "exact", head: true })
        .eq("is_monitored", true);
      return Response.json({
        cursor: state,
        indexed_entities: totalCount ?? 0,
        monitored_entities: monitoredCount ?? 0,
        batch_size: BATCH_SIZE,
        schedule: "every 5 minutes (cron)",
        demo_entities_enabled: env.ALLOW_DEMO_ENTITIES === "true",
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

  const entities = await loadMonitoredEntities(env, supabase);
  const rotationPool = expandByTier(entities);
  const batch = sliceCircular(rotationPool, state.offset, BATCH_SIZE);
  const seen = new Set<string>();
  let processed = 0;

  for (const row of batch) {
    if (seen.has(row.entity_key)) continue;
    seen.add(row.entity_key);

    const entity = rowToEntity(row);
    const parsed = EntitySchema.safeParse(entity);
    if (!parsed.success) {
      console.warn("Entity validation failed, skipping", parsed.error.flatten());
      continue;
    }

    await collectEntitySignals(supabase, env, row, parsed.data);
    processed++;
  }

  state.offset =
    rotationPool.length === 0 ? 0 : (state.offset + Math.max(processed, 1)) % rotationPool.length;
  state.last_run_at = new Date().toISOString();
  await saveState(env, state);

  console.log(`=== Collector batch done: ${processed} entities processed | next=${JSON.stringify(state)} ===`);
}

async function loadMonitoredEntities(
  env: Env,
  supabase: SupabaseClient
): Promise<MonitoredEntityRow[]> {
  const { data, error } = await supabase
    .from("entities")
    .select(
      "id, entity_key, entity_type, display_name, domain, endpoint_url, owner_key, metadata, is_verified, monitor_tier, watchlist_owner"
    )
    .eq("is_monitored", true)
    .order("monitor_tier", { ascending: true })
    .order("updated_at", { ascending: true });

  if (error) {
    console.error("Failed to load monitored entities:", error.message);
    return fallbackDevEntities(env, supabase);
  }

  if (!data || data.length === 0) {
    return fallbackDevEntities(env, supabase);
  }

  return data as MonitoredEntityRow[];
}

async function fallbackDevEntities(
  env: Env,
  supabase: SupabaseClient
): Promise<MonitoredEntityRow[]> {
  if (env.ALLOW_DEMO_ENTITIES !== "true") {
    console.warn("No monitored entities in Supabase and ALLOW_DEMO_ENTITIES is not enabled.");
    return [];
  }

  let seeds = DEFAULT_ENTITIES;
  if (env.SEED_ENTITIES) {
    try {
      const parsed = JSON.parse(env.SEED_ENTITIES) as unknown;
      if (Array.isArray(parsed)) {
        seeds = parsed.map((item) => EntitySchema.parse(item));
      }
    } catch (err) {
      console.warn("Invalid SEED_ENTITIES JSON, using minimal defaults", err);
    }
  }

  console.warn(`Using ${seeds.length} demo entities (dev-only). Set is_monitored in Supabase for production.`);

  const rows: MonitoredEntityRow[] = [];
  for (const seed of seeds) {
    const domain = seed.domain ?? deriveDomain(seed.endpoint_url ?? seed.entity_key);
    const { data } = await supabase
      .from("entities")
      .upsert(
        {
          entity_key: seed.entity_key,
          entity_type: seed.entity_type ?? "api",
          display_name: seed.display_name ?? seed.entity_key,
          domain,
          endpoint_url: seed.endpoint_url ?? null,
          owner_key: seed.owner_key ?? null,
          metadata: seed.metadata ?? {},
          is_monitored: true,
          monitor_tier: 2,
        },
        { onConflict: "entity_key" }
      )
      .select(
        "id, entity_key, entity_type, display_name, domain, endpoint_url, owner_key, metadata, is_verified, monitor_tier, watchlist_owner"
      )
      .single();

    if (data) rows.push(data as MonitoredEntityRow);
  }

  return rows;
}

function rowToEntity(row: MonitoredEntityRow): Entity {
  return {
    entity_key: row.entity_key,
    entity_type: row.entity_type as Entity["entity_type"],
    display_name: row.display_name ?? row.entity_key,
    domain: row.domain ?? undefined,
    endpoint_url: row.endpoint_url ?? undefined,
    owner_key: row.owner_key ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function expandByTier(rows: MonitoredEntityRow[]): MonitoredEntityRow[] {
  const expanded: MonitoredEntityRow[] = [];
  for (const row of rows) {
    const tier = row.monitor_tier === 1 ? 3 : row.monitor_tier === 3 ? 1 : 2;
    for (let i = 0; i < tier; i++) expanded.push(row);
  }
  return expanded;
}

function sliceCircular<T>(items: T[], offset: number, limit: number): T[] {
  if (items.length === 0) return [];
  const result: T[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    result.push(items[(offset + i) % items.length]);
  }
  return result;
}

async function collectEntitySignals(
  supabase: SupabaseClient,
  env: Env,
  row: MonitoredEntityRow,
  entity: Entity
): Promise<void> {
  const now = new Date().toISOString();
  const domain = entity.domain ?? deriveDomain(entity.endpoint_url ?? entity.entity_key);
  const probeUrl = getProbeUrl(entity.metadata, entity.endpoint_url ?? row.endpoint_url, domain);
  const monitorTier = normalizeTier(row.monitor_tier);
  const sds = parseSds(entity.metadata);
  const paidProbe = requiresPaidProbe(entity.metadata);

  let domainVerified = row.is_verified;
  if (domain && entity.owner_key && !row.is_verified) {
    domainVerified = await verifyDomainControl(domain, entity.owner_key);
  }

  const { data: entityRecord, error: entityError } = await supabase
    .from("entities")
    .update({
      is_verified: domainVerified,
      updated_at: now,
    })
    .eq("id", row.id)
    .select()
    .single();

  if (entityError || !entityRecord) {
    console.error(`Entity update failed for ${entity.entity_key}:`, entityError?.message);
    return;
  }

  const probeCredentials = await loadProbeCredentials(supabase, row.id, paidProbe);
  const observations: ObservationInput[] = [];

  if (domain) {
    observations.push(await collectDnsObservation(row.id, entity.entity_key, domain));
    observations.push(await collectSecurityTxtObservation(row.id, entity.entity_key, domain));
    observations.push(await collectTlsObservation(row.id, entity.entity_key, probeUrl ?? `https://${domain}`));
  }

  if (probeUrl && (!paidProbe || probeCredentials)) {
    observations.push(
      await collectHttpObservation(row.id, entity.entity_key, probeUrl, probeCredentials)
    );
  }

  observations.push(await collectStatusPageObservation(row.id, entity.entity_key, domain));
  observations.push(await collectChangelogObservation(row.id, entity.entity_key, domain));

  const storedObservations = [];
  for (const observation of observations) {
    const stored = await persistObservation(supabase, observation, now);
    if (stored) storedObservations.push(stored);
  }

  const recentSuccessRate = await computeRecentSuccessRate(supabase, row.id);
  const statusObs = observations.find((o) => o.observation_type === "status_page");
  const noActiveIncident = statusObs?.payload.active_incident !== true;

  const readiness = computeReadiness({
    entity_key: entity.entity_key,
    monitor_tier: monitorTier,
    payment_model: getPaymentModel(entity.metadata) ?? sds.payment_model ?? null,
    observations,
    recent_success_rate_1h: recentSuccessRate,
    no_active_incident: noActiveIncident,
  });

  await env.READINESS_CACHE.put(readinessCacheKey(entity.entity_key), JSON.stringify(readiness), {
    expirationTtl: 60 * 60 * 48,
  });

  const trustSignal = computeTrustQualitySignal(entity.entity_key, observations);
  const previousSignal = await loadPreviousSignal(supabase, row.id);

  await supabase.from("signals").upsert(
    {
      entity_id: row.id,
      signal_key: "service_readiness",
      signal_type: "readiness",
      score: readiness.confidence * 100,
      recommendation: readiness.usable === true ? "usable" : readiness.usable === false ? "not_usable" : "unknown",
      payload: readiness,
      computed_at: now,
    },
    { onConflict: "entity_id,signal_key" }
  );

  await supabase.from("signals").upsert(
    {
      entity_id: row.id,
      signal_key: "vendor_api_risk",
      signal_type: "risk",
      score: trustSignal.composite_score,
      recommendation: trustSignal.recommendation,
      payload: {
        ...trustSignal,
        freshness: {
          latest_observation_at: now,
          collection_interval_minutes: monitorTier === 1 ? 5 : monitorTier === 2 ? 15 : 30,
          collection_sla_met: true,
        },
      },
      computed_at: now,
    },
    { onConflict: "entity_id,signal_key" }
  );

  if (previousSignal && previousSignal.recommendation !== trustSignal.recommendation) {
    await supabase.from("audit_events").insert({
      event_type: "recommendation_transition",
      entity_id: row.id,
      payload: {
        entity_key: entity.entity_key,
        from: previousSignal.recommendation,
        to: trustSignal.recommendation,
        trust_score: trustSignal.trust_score,
        quality_score: trustSignal.quality_score,
      },
    });
  }

  console.log(`Collected ${storedObservations.length} observations for ${entity.entity_key}`);
}

async function loadProbeCredentials(
  supabase: SupabaseClient,
  entityId: string,
  paidProbe: boolean
): Promise<Record<string, string> | null> {
  if (!paidProbe) return null;

  const { data } = await supabase
    .from("sources")
    .select("config")
    .eq("entity_id", entityId)
    .eq("source_type", "probe_auth")
    .eq("is_enabled", true)
    .limit(1)
    .maybeSingle();

  const config = data?.config as Record<string, unknown> | undefined;
  if (!config?.probe_enabled) return null;

  const headers: Record<string, string> = {};
  if (typeof config.authorization === "string") {
    headers.Authorization = config.authorization;
  }
  if (typeof config.api_key === "string" && typeof config.api_key_header === "string") {
    headers[config.api_key_header] = config.api_key;
  }
  return Object.keys(headers).length > 0 ? headers : null;
}

async function persistObservation(
  supabase: SupabaseClient,
  observation: ObservationInput,
  observedAt: string
): Promise<unknown | null> {
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
    return null;
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
      observed_at: observedAt,
    })
    .select()
    .single();

  if (error) {
    console.warn(`Observation insert failed:`, error.message);
    return null;
  }
  return data;
}

async function computeRecentSuccessRate(
  supabase: SupabaseClient,
  entityId: string
): Promise<number | null> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("observations")
    .select("payload")
    .eq("entity_id", entityId)
    .eq("observation_type", "http_health")
    .gte("observed_at", since)
    .order("observed_at", { ascending: false })
    .limit(50);

  if (!data || data.length === 0) return null;

  const successes = data.filter((row) => (row.payload as Record<string, unknown>).ok === true).length;
  return Math.round((successes / data.length) * 1000) / 1000;
}

async function loadPreviousSignal(
  supabase: SupabaseClient,
  entityId: string
): Promise<{ recommendation: string | null } | null> {
  const { data } = await supabase
    .from("signals")
    .select("recommendation")
    .eq("entity_id", entityId)
    .eq("signal_key", "vendor_api_risk")
    .maybeSingle();

  return data ?? null;
}

async function collectDnsObservation(
  entityId: string,
  entityKey: string,
  domain: string
): Promise<ObservationInput> {
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

async function collectHttpObservation(
  entityId: string,
  entityKey: string,
  endpointUrl: string,
  authHeaders: Record<string, string> | null
): Promise<ObservationInput> {
  const startedAt = Date.now();
  const response = await fetch(endpointUrl, {
    method: "GET",
    redirect: "follow",
    headers: authHeaders ?? undefined,
  }).catch(() => null);
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

async function collectSecurityTxtObservation(
  entityId: string,
  entityKey: string,
  domain: string
): Promise<ObservationInput> {
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

async function collectTlsObservation(
  entityId: string,
  entityKey: string,
  url: string
): Promise<ObservationInput> {
  const startedAt = Date.now();
  const response = await fetch(url, { method: "HEAD", redirect: "follow" }).catch(() => null);
  const ok = response?.ok === true || (response !== null && response.status > 0);
  return {
    entityId,
    source: { id: "", source_key: `tls:${entityKey}` },
    observation_type: "tls_expiry",
    payload: {
      url,
      valid: ok,
      days_to_expiry: ok ? 90 : 0,
      latency_ms: Date.now() - startedAt,
      note: "Workers cannot inspect cert expiry; HTTPS reachability used as proxy",
    },
    confidence: 0.6,
  };
}

async function collectStatusPageObservation(
  entityId: string,
  entityKey: string,
  domain: string | undefined
): Promise<ObservationInput> {
  if (!domain) {
    return {
      entityId,
      source: { id: "", source_key: `status_page:${entityKey}` },
      observation_type: "status_page",
      payload: { found: false },
      confidence: 0.5,
    };
  }

  const candidates = [
    `https://status.${domain}/api/v2/status.json`,
    `https://${domain}/status`,
    `https://status.${domain}/`,
  ];

  for (const url of candidates) {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) continue;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      try {
        const body = (await response.json()) as Record<string, unknown>;
        const status = body.status as Record<string, unknown> | undefined;
        const indicator = typeof status?.indicator === "string" ? status.indicator : "none";
        return {
          entityId,
          source: { id: "", source_key: `status_page:${entityKey}` },
          observation_type: "status_page",
          payload: {
            url,
            found: true,
            active_incident: indicator !== "none",
            severity: indicator === "major" ? "major" : indicator === "minor" ? "minor" : "none",
          },
        };
      } catch {
        continue;
      }
    }

    const text = await response.text();
    const major = /major outage|critical|incident/i.test(text);
    return {
      entityId,
      source: { id: "", source_key: `status_page:${entityKey}` },
      observation_type: "status_page",
      payload: {
        url,
        found: true,
        active_incident: major,
        severity: major ? "major" : "none",
      },
      confidence: 0.7,
    };
  }

  return {
    entityId,
    source: { id: "", source_key: `status_page:${entityKey}` },
    observation_type: "status_page",
    payload: { domain, found: false },
    confidence: 0.6,
  };
}

async function collectChangelogObservation(
  entityId: string,
  entityKey: string,
  domain: string | undefined
): Promise<ObservationInput> {
  if (!domain) {
    return {
      entityId,
      source: { id: "", source_key: `changelog:${entityKey}` },
      observation_type: "changelog_rss",
      payload: { found: false },
      confidence: 0.5,
    };
  }

  const urls = [
    `https://${domain}/changelog`,
    `https://${domain}/blog/changelog`,
    `https://${domain}/rss.xml`,
  ];

  for (const url of urls) {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) continue;
    const body = await response.text();
    const breaking = /breaking change|deprecated|removed api/i.test(body.slice(0, 5000));
    return {
      entityId,
      source: { id: "", source_key: `changelog:${entityKey}` },
      observation_type: "changelog_rss",
      payload: { url, found: true, breaking_change_detected: breaking, bytes: body.length },
      confidence: 0.65,
    };
  }

  return {
    entityId,
    source: { id: "", source_key: `changelog:${entityKey}` },
    observation_type: "changelog_rss",
    payload: { domain, found: false },
    confidence: 0.6,
  };
}

function sourceUrlFromObservation(observation: ObservationInput): string | null {
  const payload = observation.payload;
  if (typeof payload.url === "string") return payload.url;
  if (typeof payload.endpoint_url === "string") return payload.endpoint_url;
  if (typeof payload.domain === "string") return `https://${payload.domain}`;
  return null;
}

function normalizeTier(tier: number): 1 | 2 | 3 {
  if (tier === 1) return 1;
  if (tier === 3) return 3;
  return 2;
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
