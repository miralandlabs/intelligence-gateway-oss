-- Add monitoring columns to existing intelligence gateway databases.
-- Safe to run on fresh init.sql deployments (uses IF NOT EXISTS guards).

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS is_monitored BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS monitor_tier SMALLINT NOT NULL DEFAULT 2;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS watchlist_owner TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entities_monitor_tier_check'
  ) THEN
    ALTER TABLE public.entities
      ADD CONSTRAINT entities_monitor_tier_check CHECK (monitor_tier IN (1, 2, 3));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_entities_monitored
  ON public.entities(is_monitored, monitor_tier)
  WHERE is_monitored = TRUE;

CREATE INDEX IF NOT EXISTS idx_entities_watchlist_owner
  ON public.entities(watchlist_owner)
  WHERE watchlist_owner IS NOT NULL;

INSERT INTO public.feeds (
  feed_key,
  feed_name,
  description,
  schema_definition,
  access_mode,
  pricing,
  is_active
)
SELECT
  'service_readiness',
  'Service Readiness Oracle',
  'Agent-facing readiness snapshots: usable, confidence, latency, and freshness for x402-paid services.',
  '{
    "entity_key": "string",
    "usable": "boolean|null",
    "confidence": "number",
    "latency_ms": "number|null",
    "state": "string",
    "last_verified": "string"
  }'::jsonb,
  'public',
  '{
    "public_ready_stale_24h": 0,
    "fresh_ready_usdc_monthly": 19
  }'::jsonb,
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.feeds WHERE feed_key = 'service_readiness'
);
