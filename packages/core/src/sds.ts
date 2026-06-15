import { z } from "zod";

export const SRD_VERSION = "2026.06-srd-v1";

export const AuthTypeSchema = z.enum(["x402-token", "bearer", "signed", "none"]);

export const ServiceDescriptorSchema = z.object({
  capabilities: z.array(z.string()).default([]),
  payment_model: z.string().optional(),
  auth_type: AuthTypeSchema.optional(),
  probe_url: z.string().url().optional(),
  declared_sla: z
    .object({
      latency_p95_ms: z.number().positive().optional(),
      uptime: z.number().min(0).max(1).optional(),
    })
    .optional(),
  probe_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

export type ServiceDescriptor = z.infer<typeof ServiceDescriptorSchema>;

export interface EntityMetadata {
  sds?: ServiceDescriptor;
  request_monitoring?: boolean;
  [key: string]: unknown;
}

export function parseSds(metadata: Record<string, unknown> | undefined): ServiceDescriptor {
  const raw = metadata?.sds;
  if (!raw || typeof raw !== "object") {
    return ServiceDescriptorSchema.parse({});
  }
  return ServiceDescriptorSchema.parse(raw);
}

export function getProbeUrl(
  metadata: Record<string, unknown> | undefined,
  endpointUrl: string | null | undefined,
  domain: string | undefined
): string | undefined {
  const sds = parseSds(metadata);
  if (sds.probe_url) return sds.probe_url;
  if (endpointUrl) return endpointUrl;
  if (domain) return `https://${domain}`;
  return undefined;
}

export function getPaymentModel(metadata: Record<string, unknown> | undefined): string | null {
  const sds = parseSds(metadata);
  return sds.payment_model ?? null;
}

export function getCapabilities(metadata: Record<string, unknown> | undefined): string[] {
  return parseSds(metadata).capabilities;
}

export function requiresPaidProbe(metadata: Record<string, unknown> | undefined): boolean {
  const sds = parseSds(metadata);
  // payment_model alone does not block probes — many x402 services expose a free /health URL.
  // Skip only when auth implies a paid/tokenized call and credentials must be supplied.
  return sds.auth_type === "x402-token" || sds.auth_type === "bearer" || sds.auth_type === "signed";
}
