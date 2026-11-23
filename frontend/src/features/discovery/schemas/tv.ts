import { z } from "zod";

const tvBase = {
  id: z.string().min(1),
  name: z.string(),
  manufacturer: z.string(),
  modelName: z.string(),
  ip: z.string(),
  port: z.number().int(),
  locationUrl: z.string()
};

export const discoveredTvSchema = z.discriminatedUnion("protocol", [
  z.object({
    ...tvBase,
    protocol: z.literal("google-cast"),
    softwareVersion: z.string(),
    supportedFormats: z.array(z.string())
  }),
  z.object({
    ...tvBase,
    protocol: z.literal("roku-ecp"),
    modelNumber: z.string(),
    softwareVersion: z.string(),
    ecpMode: z.enum(["limited", "permissive", "unknown"]),
    supportsAirPlay: z.boolean(),
    supportedFormats: z.array(z.string())
  }),
  z.object({
    ...tvBase,
    protocol: z.literal("dlna-dmr"),
    avTransportControlUrl: z.string().nullable(),
    connectionManagerControlUrl: z.string().nullable(),
    supportedProtocols: z.array(z.string())
  })
]);

export type DiscoveredTv = z.infer<typeof discoveredTvSchema>;
export type TvProtocol = DiscoveredTv["protocol"];

export const tvsResponseSchema = z.object({ tvs: z.array(discoveredTvSchema) });

export const commandResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  detail: z.string()
});

export type CommandResult = z.infer<typeof commandResultSchema>;

export const PROTOCOL_LABEL: Record<TvProtocol, string> = {
  "google-cast": "Google Cast",
  "dlna-dmr": "DLNA DMR",
  "roku-ecp": "Roku ECP"
};

export const CAST_ACTIONS = ["PLAY", "PAUSE", "STOP", "SEEK", "SUBTITLE_ON", "SUBTITLE_OFF", "VOLUME"] as const;
export type CastAction = (typeof CAST_ACTIONS)[number];

export const ROKU_KEYS = ["Home", "Back", "Up", "Down", "Left", "Right", "Select", "Play", "Rev", "Fwd"] as const;
export type RokuKey = (typeof ROKU_KEYS)[number];
