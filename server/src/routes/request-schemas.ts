import { z } from 'zod';

/**
 * Body schemas for handlers that previously cast `request.body` without
 * validation. Kept dependency-free (zod only) so they can be unit tested in
 * isolation. Unknown keys are stripped by default, preserving compatibility.
 */

export const systemSettingsSchema = z.object({
  autoUpdate: z.boolean().optional(),
  domainSuffix: z.string().max(255).optional(),
  extraHostname: z.string().max(255).optional(),
  updateCheckInterval: z.number().int().optional(),
  certLifetime: z.number().int().optional(),
  homerDisableHttp: z.boolean().optional(),
});
export type SystemSettingsBody = z.infer<typeof systemSettingsSchema>;

export const addToNetworkSchema = z.object({
  services: z.array(z.string()).optional(),
});
