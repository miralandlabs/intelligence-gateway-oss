import { z } from "zod";

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
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type Feed = z.infer<typeof FeedSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
