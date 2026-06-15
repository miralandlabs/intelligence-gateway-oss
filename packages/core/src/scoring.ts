export const TRUST_SCORING_VERSION = "2026.06-v2";

export interface ScoringObservation {
  observation_type: string;
  payload: Record<string, unknown>;
  confidence?: number;
}

export interface ReasonCode {
  code: string;
  impact: number;
  confidence: number;
}

export interface TrustQualitySignal {
  scoring_version: string;
  trust_score: number;
  quality_score: number;
  composite_score: number;
  recommendation: string;
  reasons: ReasonCode[];
  entity_key: string;
  observation_count: number;
}

function subscoreDns(payload: Record<string, unknown>): number {
  return payload.ok === true ? 100 : 0;
}

function subscoreHttp(payload: Record<string, unknown>): number {
  const status = typeof payload.status === "number" ? payload.status : 0;
  if (payload.ok === true && status >= 200 && status < 400) return 100;
  if (status >= 400 && status < 500) return 40;
  return 0;
}

function subscoreSecurityTxt(payload: Record<string, unknown>): number {
  if (payload.found !== true) return 0;
  if (payload.has_contact && payload.has_expires) return 100;
  if (payload.has_contact) return 70;
  return 40;
}

function subscoreTls(payload: Record<string, unknown>): number {
  if (payload.valid !== true) return 0;
  const days = typeof payload.days_to_expiry === "number" ? payload.days_to_expiry : 0;
  if (days >= 30) return 100;
  if (days >= 7) return 60;
  if (days > 0) return 20;
  return 0;
}

function subscoreStatusPage(payload: Record<string, unknown>): number {
  if (payload.active_incident === true) {
    return payload.severity === "major" ? 0 : 50;
  }
  return payload.found === true ? 100 : 70;
}

function subscoreChangelog(payload: Record<string, unknown>): number {
  if (payload.breaking_change_detected === true) return 30;
  return payload.found === true ? 100 : 80;
}

function weightedAverage(items: { score: number; weight: number; confidence: number }[]): number {
  let totalWeight = 0;
  let total = 0;
  for (const item of items) {
    const w = item.weight * item.confidence;
    total += item.score * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 50;
  return Math.round((total / totalWeight) * 100) / 100;
}

export function computeTrustQualitySignal(
  entityKey: string,
  observations: ScoringObservation[]
): TrustQualitySignal {
  const reasons: ReasonCode[] = [];
  const trustItems: { score: number; weight: number; confidence: number }[] = [];
  const qualityItems: { score: number; weight: number; confidence: number }[] = [];

  for (const obs of observations) {
    const conf = obs.confidence ?? 1;
    const p = obs.payload;

    if (obs.observation_type === "dns_resolution") {
      const score = subscoreDns(p);
      trustItems.push({ score, weight: 25, confidence: conf });
      if (score < 100) reasons.push({ code: "DNS_RESOLUTION_FAILED", impact: -25, confidence: conf });
    }
    if (obs.observation_type === "security_txt") {
      const score = subscoreSecurityTxt(p);
      trustItems.push({ score, weight: 10, confidence: conf });
      if (score < 70) reasons.push({ code: "SECURITY_TXT_WEAK", impact: -10, confidence: conf });
    }
    if (obs.observation_type === "tls_expiry") {
      const score = subscoreTls(p);
      trustItems.push({ score, weight: 20, confidence: conf });
      if (score < 60) reasons.push({ code: "TLS_EXPIRY_RISK", impact: -20, confidence: conf });
    }
    if (obs.observation_type === "http_health") {
      const score = subscoreHttp(p);
      qualityItems.push({ score, weight: 30, confidence: conf });
      if (score < 100) reasons.push({ code: "HTTP_UNHEALTHY", impact: -30, confidence: conf });
    }
    if (obs.observation_type === "status_page") {
      const score = subscoreStatusPage(p);
      qualityItems.push({ score, weight: 20, confidence: conf });
      if (score < 100) reasons.push({ code: "STATUS_INCIDENT", impact: -20, confidence: conf });
    }
    if (obs.observation_type === "changelog_rss") {
      const score = subscoreChangelog(p);
      qualityItems.push({ score, weight: 10, confidence: conf });
      if (score < 80) reasons.push({ code: "CHANGELOG_RISK", impact: -10, confidence: conf });
    }
  }

  const trust = weightedAverage(trustItems);
  const quality = weightedAverage(qualityItems.length > 0 ? qualityItems : [{ score: 50, weight: 1, confidence: 0.5 }]);
  const composite = Math.round((0.45 * trust + 0.55 * quality) * 100) / 100;

  let recommendation: string;
  if (composite >= 85) recommendation = "monitor";
  else if (composite >= 65) recommendation = "review";
  else if (composite >= 40) recommendation = "restrict_new_usage";
  else recommendation = "block_or_escalate";

  return {
    scoring_version: TRUST_SCORING_VERSION,
    trust_score: trust,
    quality_score: quality,
    composite_score: composite,
    recommendation,
    reasons: reasons.slice(0, 10),
    entity_key: entityKey,
    observation_count: observations.length,
  };
}
