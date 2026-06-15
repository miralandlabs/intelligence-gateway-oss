-- Intelligence Gateway — fresh database bootstrap
-- Run this on a new Supabase project after dropping the old agent-registry schema.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. entities — canonical monitored things
-- ---------------------------------------------------------------------------

CREATE TABLE public.entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'domain',
  display_name VARCHAR(255),
  domain VARCHAR(255),
  endpoint_url TEXT,
  owner_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT entities_entity_key_unique UNIQUE (entity_key),
  CONSTRAINT entities_entity_type_check CHECK (
    entity_type IN ('domain', 'api', 'vendor', 'dataset', 'market', 'filing', 'protocol', 'other')
  )
);

CREATE TRIGGER entities_set_updated_at
  BEFORE UPDATE ON public.entities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. sources — connectors that produce observations
-- ---------------------------------------------------------------------------

CREATE TABLE public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key VARCHAR(255) NOT NULL,
  source_type VARCHAR(80) NOT NULL,
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  url TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT sources_source_key_unique UNIQUE (source_key)
);

CREATE INDEX idx_sources_entity_id ON public.sources(entity_id);
CREATE INDEX idx_sources_type ON public.sources(source_type);

CREATE TRIGGER sources_set_updated_at
  BEFORE UPDATE ON public.sources
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. observations — immutable evidence snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE public.observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  observation_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.000,
  payload_hash VARCHAR(128),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT observations_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX idx_observations_entity_observed_at
  ON public.observations(entity_id, observed_at DESC);

CREATE INDEX idx_observations_source_observed_at
  ON public.observations(source_id, observed_at DESC)
  WHERE source_id IS NOT NULL;

CREATE INDEX idx_observations_type
  ON public.observations(observation_type);

CREATE INDEX idx_observations_payload_hash
  ON public.observations(entity_id, payload_hash)
  WHERE payload_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. signals — derived scores and recommendations
-- ---------------------------------------------------------------------------

CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  signal_key VARCHAR(255) NOT NULL,
  signal_type VARCHAR(100) NOT NULL,
  score NUMERIC(10, 4),
  recommendation TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT signals_entity_signal_unique UNIQUE (entity_id, signal_key)
);

CREATE INDEX idx_signals_entity_id ON public.signals(entity_id);
CREATE INDEX idx_signals_signal_key ON public.signals(signal_key);
CREATE INDEX idx_signals_type_score ON public.signals(signal_type, score DESC);
CREATE INDEX idx_signals_computed_at ON public.signals(computed_at DESC);

-- ---------------------------------------------------------------------------
-- 5. feeds — packaged API products
-- ---------------------------------------------------------------------------

CREATE TABLE public.feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key VARCHAR(255) NOT NULL,
  feed_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  schema_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  access_mode VARCHAR(20) NOT NULL DEFAULT 'public',
  pricing JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT feeds_feed_key_unique UNIQUE (feed_key),
  CONSTRAINT feeds_access_mode_check CHECK (access_mode IN ('public', 'jwt', 'x402'))
);

CREATE INDEX idx_feeds_active ON public.feeds(is_active) WHERE is_active = TRUE;

CREATE TRIGGER feeds_set_updated_at
  BEFORE UPDATE ON public.feeds
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. entitlements — JWT / x402 / API-key grants
-- ---------------------------------------------------------------------------

CREATE TABLE public.entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_key VARCHAR(255) NOT NULL,
  feed_id UUID NOT NULL REFERENCES public.feeds(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  proof_type VARCHAR(20) NOT NULL,
  proof_ref TEXT,
  expires_at TIMESTAMPTZ,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT entitlements_entitlement_key_unique UNIQUE (entitlement_key),
  CONSTRAINT entitlements_proof_type_check CHECK (proof_type IN ('jwt', 'x402', 'api_key'))
);

CREATE INDEX idx_entitlements_feed_subject
  ON public.entitlements(feed_id, subject);

CREATE INDEX idx_entitlements_active
  ON public.entitlements(feed_id, expires_at)
  WHERE is_revoked = FALSE;

-- ---------------------------------------------------------------------------
-- 7. audit_events — access, payment, and recompute history
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL,
  feed_id UUID REFERENCES public.feeds(id) ON DELETE SET NULL,
  subject TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX idx_audit_events_created_at ON public.audit_events(created_at DESC);
CREATE INDEX idx_audit_events_event_type ON public.audit_events(event_type);
CREATE INDEX idx_audit_events_entity_id ON public.audit_events(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_audit_events_feed_id ON public.audit_events(feed_id) WHERE feed_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Search indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_entities_domain ON public.entities(domain) WHERE domain IS NOT NULL;
CREATE INDEX idx_entities_type ON public.entities(entity_type);
CREATE INDEX idx_entities_verified ON public.entities(is_verified) WHERE is_verified = TRUE;

CREATE INDEX idx_entities_search ON public.entities
  USING gin(
    to_tsvector(
      'english',
      entity_key || ' ' || COALESCE(display_name, '') || ' ' || COALESCE(domain, '')
    )
  );

-- ---------------------------------------------------------------------------
-- Seed catalog feeds (vertical plugins register additional feeds later)
-- ---------------------------------------------------------------------------

INSERT INTO public.feeds (
  feed_key,
  feed_name,
  description,
  schema_definition,
  access_mode,
  pricing,
  is_active
) VALUES (
  'vendor_api_risk',
  'Vendor/API Risk Monitor',
  'Continuous DNS, HTTP, security.txt, and endpoint health evidence for vendors and APIs.',
  '{
    "entity_key": "string",
    "score": "number",
    "recommendation": "string",
    "reasons": "string[]",
    "observation_count": "number"
  }'::jsonb,
  'public',
  '{
    "public_profile": 0,
    "history_usdc_monthly": 29
  }'::jsonb,
  TRUE
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- service_role bypasses RLS automatically.
-- Gateway/collector write with service role; public reads use anon key.

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Public catalog reads
CREATE POLICY entities_public_read
  ON public.entities
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY signals_public_read
  ON public.signals
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY feeds_public_read
  ON public.feeds
  FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

-- Evidence reads are intentionally closed by default.
-- Open later if a feed/product requires public observation history.
CREATE POLICY sources_service_only
  ON public.sources
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY observations_service_only
  ON public.observations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY entitlements_service_only
  ON public.entitlements
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY audit_events_service_only
  ON public.audit_events
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON public.entities TO anon, authenticated;
GRANT SELECT ON public.signals TO anon, authenticated;
GRANT SELECT ON public.feeds TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
