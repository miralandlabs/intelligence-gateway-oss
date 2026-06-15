export const READINESS_SCORING_VERSION = "2026.06-ready-v1";

export const TIER_STALENESS_MINUTES: Record<1 | 2 | 3, number> = {
  1: 30,
  2: 90,
  3: 1440,
};

export type ReadinessState = "healthy" | "degraded" | "down" | "unknown";

export interface ReadinessSnapshot {
  entity_key: string;
  usable: boolean | null;
  confidence: number;
  latency_ms: number | null;
  success_rate_1h: number | null;
  last_verified: string;
  max_staleness_minutes: number;
  state: ReadinessState;
  payment_model: string | null;
  scoring_version: string;
}

export interface ProbeObservation {
  observation_type: string;
  payload: Record<string, unknown>;
  confidence?: number;
}

export interface ReadinessInput {
  entity_key: string;
  monitor_tier: 1 | 2 | 3;
  payment_model: string | null;
  observations: ProbeObservation[];
  recent_success_rate_1h?: number | null;
  no_active_incident?: boolean;
}

export function readinessCacheKey(entityKey: string): string {
  return `service:${entityKey}:readiness`;
}

function normalizeLatencyScore(latencyMs: number | null): number {
  if (latencyMs === null) return 50;
  if (latencyMs <= 300) return 100;
  if (latencyMs <= 800) return 85;
  if (latencyMs <= 2000) return 60;
  if (latencyMs <= 5000) return 30;
  return 10;
}

function httpStateFromObservations(observations: ProbeObservation[]): {
  state: ReadinessState;
  latency_ms: number | null;
  http_ok: boolean | null;
} {
  const http = observations.find((o) => o.observation_type === "http_health");
  if (!http) {
    return { state: "unknown", latency_ms: null, http_ok: null };
  }

  const latency =
    typeof http.payload.latency_ms === "number" ? (http.payload.latency_ms as number) : null;
  const ok = http.payload.ok === true;
  const status = typeof http.payload.status === "number" ? (http.payload.status as number) : 0;

  if (!ok && (http.payload.error || status >= 500 || status === 0)) {
    return { state: "down", latency_ms: latency, http_ok: false };
  }
  if (!ok || status >= 400) {
    return { state: "degraded", latency_ms: latency, http_ok: false };
  }
  return { state: "healthy", latency_ms: latency, http_ok: true };
}

export function computeReadiness(input: ReadinessInput): ReadinessSnapshot {
  const maxStaleness = TIER_STALENESS_MINUTES[input.monitor_tier];
  const now = new Date().toISOString();
  const { state, latency_ms, http_ok } = httpStateFromObservations(input.observations);

  const successRate =
    input.recent_success_rate_1h ??
    (http_ok === true ? 1 : http_ok === false ? 0 : null);

  const uptimeScore =
    successRate === null ? 50 : Math.round(Math.max(0, Math.min(100, successRate * 100)));
  const latencyScore = normalizeLatencyScore(latency_ms);
  const freshnessScore = 100;

  const confidenceRaw = 0.6 * uptimeScore + 0.3 * latencyScore + 0.1 * freshnessScore;
  const confidence = Math.round(confidenceRaw) / 100;

  const hasIncident = input.no_active_incident === false;
  let usable: boolean | null = null;
  if (state !== "unknown") {
    usable = confidence >= 0.7 && !hasIncident && state !== "down";
  }

  return {
    entity_key: input.entity_key,
    usable,
    confidence,
    latency_ms,
    success_rate_1h: successRate,
    last_verified: now,
    max_staleness_minutes: maxStaleness,
    state: hasIncident ? "degraded" : state,
    payment_model: input.payment_model,
    scoring_version: READINESS_SCORING_VERSION,
  };
}

export function applyStalenessDecay(
  snapshot: ReadinessSnapshot,
  monitorTier: 1 | 2 | 3
): ReadinessSnapshot {
  const maxStaleness = TIER_STALENESS_MINUTES[monitorTier];
  const ageMs = Date.now() - new Date(snapshot.last_verified).getTime();
  const ageMinutes = ageMs / 60_000;

  if (ageMinutes <= maxStaleness) {
    return { ...snapshot, max_staleness_minutes: maxStaleness };
  }

  return {
    ...snapshot,
    usable: null,
    confidence: 0,
    state: "unknown",
    max_staleness_minutes: maxStaleness,
  };
}
