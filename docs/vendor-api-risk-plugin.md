# Vendor/API Risk Plugin

This is the first plugin for the continuous intelligence gateway. It should stay removable: the core framework must not depend on vendor-risk-specific tables, names, routes, or UI copy.

## Entity Types

- `vendor`: SaaS or infrastructure vendor
- `api`: public API or machine-facing endpoint
- `domain`: domain-only entity with no known API endpoint yet

## Connectors

The MVP collector writes observations from these sources:

- `dns`: Cloudflare DNS-over-HTTPS lookup for the entity domain
- `http`: GET request against the endpoint URL or domain homepage
- `security_txt`: lookup at `/.well-known/security.txt` and `/security.txt`

Future connectors:

- `status_page`: discovered or manually configured status page RSS/API
- `changelog`: product changelog RSS or Atom feed
- `github`: public org/repo freshness and archived-state checks
- `tls`: certificate expiry through a Worker-compatible certificate metadata service
- `adverse_media`: public news/breach mentions with source citations

## Signal

Primary signal key: `vendor_api_risk`

Initial score starts at 100 and subtracts:

- 30 when DNS resolution fails
- 35 when the HTTP endpoint is unhealthy
- 10 when `security.txt` is missing

Recommendations:

- `monitor`: score >= 80
- `review`: score >= 50 and < 80
- `block_or_escalate`: score < 50

This score is intentionally simple for validation. Do not overfit before users confirm which evidence matters.

## Gateway Routes

- `GET /v1/search?q=...`: search entities and latest signals
- `GET /v1/entities/:entity_key`: public entity profile
- `POST /v1/entities/register`: register or update an entity
- `GET /v1/feeds/vendor_api_risk`: query the packaged risk feed

## Console Views

- searchable entity catalog
- entity card with verification status
- latest signal score and recommendation
- expandable raw signal payload
- registration form for entity key, type, domain, endpoint URL, and optional owner key

## Access Model

- public profile: free
- latest risk feed: public during validation
- historical observations: paid JWT or x402 after validation
- batch checks: paid JWT or x402 after validation

## Validation Entities

Start with 20 entities across infrastructure, payments, data, auth, and AI tooling:

- cloudflare.com
- stripe.com
- github.com
- supabase.com
- vercel.com
- netlify.com
- auth0.com
- okta.com
- twilio.com
- sendgrid.com
- openai.com
- anthropic.com
- cursor.com
- linear.app
- datadoghq.com
- sentry.io
- mongodb.com
- planetscale.com
- snowflake.com
- notion.so
