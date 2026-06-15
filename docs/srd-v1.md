# Service Readiness Descriptor (SRD) v1

SRD v1 is the registration standard for the x402 Readiness Oracle (`intel.pr402.org`).
It complements pr402 resource discovery (`GET /resources`) with probe metadata agents need for `/ready`.

**Canonical schema (code):** `@miraland/intel-core` → `ServiceDescriptorSchema`, `EntityRegistrationSchema`

**Version:** `2026.06-srd-v1`

---

## Registration endpoint

```http
POST https://intel.pr402.org/v1/entities/register
Content-Type: application/json
```

## Minimal example (monitored x402 API)

```json
{
  "entity_key": "acme-search",
  "entity_type": "api",
  "display_name": "Acme Search API",
  "domain": "api.acme.com",
  "endpoint_url": "https://api.acme.com",
  "request_monitoring": true,
  "sds": {
    "capabilities": ["search", "retrieval"],
    "payment_model": "x402",
    "auth_type": "none",
    "probe_url": "https://api.acme.com/health",
    "probe_tier": 2
  }
}
```

## Field reference

### Top-level (entity)

| Field | Required | Description |
|-------|----------|-------------|
| `entity_key` | yes | Stable id (usually domain or slug) |
| `entity_type` | yes | `api` recommended for x402 services |
| `display_name` | no | Human label |
| `domain` | no | DNS domain for verification + DNS checks |
| `endpoint_url` | yes* | Public API base URL |
| `owner_key` | no | Ed25519 public key for DNS TXT verification |
| `request_monitoring` | no | When `true`, collector probes this service |
| `monitor_tier` | no | `1` (frequent) / `2` / `3` (default `2`) |
| `sds` | yes* | Service Readiness Descriptor (below) |

\*Required when `request_monitoring` is `true`: at least one of `endpoint_url` or `sds.probe_url`.

### `sds` object

| Field | Required | Description |
|-------|----------|-------------|
| `capabilities` | no | Tags for `GET /v1/services?capability=` |
| `payment_model` | no | e.g. `"x402"` |
| `auth_type` | no | `none` \| `x402-token` \| `bearer` \| `signed` |
| `probe_url` | yes* | Unauthenticated health URL (preferred probe target) |
| `declared_sla` | no | `{ latency_p95_ms, uptime }` — informational |
| `probe_tier` | no | Probe cadence tier `1`–`3` |

### Paid / authenticated probes

If `auth_type` is `x402-token`, `bearer`, or `signed`, HTTP probes require opt-in credentials via watchlist import (`probe_auth`). Do not probe billable endpoints without seller consent.

## DNS verification (optional badge)

Publish TXT at `_intel.{domain}`:

```text
v=intel-gateway1; k=ed25519; p=YOUR_OWNER_KEY
```

Include `owner_key` in registration. Verified entities receive `is_verified: true`.

## Agent-facing APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/services?capability=&payment_model=` | Discover services + cached readiness |
| `GET /v1/services/{entity_key}/ready` | **Core primitive** — usable right now? |
| `GET /v1/entities/{entity_key}` | Full profile + signals |

## `/ready` response (v1)

```json
{
  "entity_key": "acme-search",
  "usable": true,
  "confidence": 0.96,
  "latency_ms": 42,
  "success_rate_1h": 1,
  "last_verified": "2026-06-15T14:25:37.366Z",
  "max_staleness_minutes": 90,
  "state": "healthy",
  "payment_model": "x402",
  "scoring_version": "2026.06-ready-v1"
}
```

## Relationship to pr402

| pr402 | Readiness Oracle |
|-------|------------------|
| What exists, how to pay | Whether it is usable right now |
| `GET /resources` | `GET /v1/services`, `/ready` |
| Seller onboarding on ipay.sh | Seller registers probe metadata here |
