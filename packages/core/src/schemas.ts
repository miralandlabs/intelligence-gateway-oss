import { z } from "zod";
import { ServiceDescriptorSchema } from "./sds";

export const EntityTypeSchema = z.enum([
  "domain",
  "api",
  "vendor",
  "dataset",
  "market",
  "filing",
  "protocol",
  "other",
]);

export const AccessModeSchema = z.enum(["public", "jwt", "x402"]);

// Canonical thing tracked by the intelligence gateway.
export const EntitySchema = z.object({
  entity_key: z.string().min(1),
  entity_type: EntityTypeSchema.default("domain"),
  display_name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  endpoint_url: z.string().url().optional(),
  owner_key: z.string().min(10).optional(),
  metadata: z.record(z.unknown()).optional().default({}),
});

export const EntityRegistrationSchema = EntitySchema.extend({
  request_monitoring: z.boolean().optional(),
  watchlist_owner: z.string().min(1).optional(),
  monitor_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  sds: ServiceDescriptorSchema.optional(),
});

export const WatchlistImportSchema = z.object({
  watchlist_owner: z.string().min(1).optional(),
  monitor_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(2),
  entities: z
    .array(
      z.object({
        entity_key: z.string().min(1),
        entity_type: EntityTypeSchema.optional(),
        display_name: z.string().optional(),
        domain: z.string().optional(),
        endpoint_url: z.string().url().optional(),
        owner_key: z.string().optional(),
        sds: ServiceDescriptorSchema.optional(),
        metadata: z.record(z.unknown()).optional(),
        probe_auth: z
          .object({
            probe_enabled: z.boolean().default(true),
            authorization: z.string().optional(),
            api_key: z.string().optional(),
            api_key_header: z.string().optional(),
          })
          .optional(),
      })
    )
    .min(1)
    .max(500),
});

export const VendorBatchAuditSchema = z.object({
  entity_keys: z.array(z.string().min(1)).min(1).max(100),
});

export const Pr402SyncSchema = z.object({
  resources_url: z.string().url().optional(),
  dry_run: z.boolean().optional().default(false),
});

export const SourceDescriptorSchema = z.object({
  source_key: z.string().min(1),
  source_type: z.string().min(1),
  entity_key: z.string().min(1),
  url: z.string().url().optional(),
  config: z.record(z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
});

export const ObservationSchema = z.object({
  entity_key: z.string().min(1),
  source_key: z.string().min(1),
  observation_type: z.string().min(1),
  payload: z.record(z.unknown()),
  confidence: z.number().min(0).max(1).optional().default(1),
  observed_at: z.string().datetime().optional(),
});

export const SignalSchema = z.object({
  entity_key: z.string().min(1),
  signal_key: z.string().min(1),
  signal_type: z.string().min(1),
  score: z.number().optional(),
  recommendation: z.string().optional(),
  payload: z.record(z.unknown()).optional().default({}),
  computed_at: z.string().datetime().optional(),
});

export const FeedSchema = z.object({
  feed_key: z.string().min(1),
  feed_name: z.string().min(1),
  description: z.string().min(1),
  schema_definition: z.record(z.unknown()).optional().default({}),
  access_mode: AccessModeSchema.default("public"),
  pricing: z.record(z.unknown()).optional().default({}),
});

export const EntitlementSchema = z.object({
  entitlement_key: z.string().min(1),
  feed_key: z.string().min(1),
  subject: z.string().min(1),
  proof_type: z.enum(["jwt", "x402", "api_key"]),
  proof_ref: z.string().optional(),
  expires_at: z.string().datetime().optional(),
});

export type EntityType = z.infer<typeof EntityTypeSchema>;
export type AccessMode = z.infer<typeof AccessModeSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type EntityInput = z.input<typeof EntitySchema>;
export type EntityRegistration = z.infer<typeof EntityRegistrationSchema>;
export type WatchlistImport = z.infer<typeof WatchlistImportSchema>;
export type VendorBatchAudit = z.infer<typeof VendorBatchAuditSchema>;
export type Pr402SyncRequest = z.infer<typeof Pr402SyncSchema>;
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type Feed = z.infer<typeof FeedSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
