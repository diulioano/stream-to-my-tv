import { z } from "zod";
import { sessionSchema } from "../../player/schemas/session";

export const videoTrackSchema = z.object({
  streamIndex: z.number().int(),
  codec: z.string(),
  profile: z.string(),
  width: z.number(),
  height: z.number(),
  pixFmt: z.string(),
  frameRate: z.string()
});

export const audioTrackSchema = z.object({
  streamIndex: z.number().int(),
  audioOrderIndex: z.number().int(),
  codec: z.string(),
  channels: z.number(),
  sampleRate: z.number(),
  language: z.string(),
  title: z.string(),
  isNativeTvCompatible: z.boolean()
});

export const subtitleTrackSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("embedded"),
    streamIndex: z.number().int(),
    codec: z.string(),
    language: z.string(),
    title: z.string()
  }),
  z.object({
    id: z.string(),
    kind: z.literal("external"),
    filePath: z.string(),
    format: z.enum(["srt", "vtt"]),
    language: z.string(),
    title: z.string()
  })
]);

export const downloadStatusSchema = z.object({
  ready: z.boolean(),
  estimatedProgressPct: z.number(),
  reason: z.string().nullable()
});

export const mediaItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  container: z.enum(["mp4", "mkv", "webm", "avi", "mov"]),
  fileSize: z.number(),
  durationSec: z.number(),
  video: videoTrackSchema.nullable(),
  audioTracks: z.array(audioTrackSchema),
  subtitleTracks: z.array(subtitleTrackSchema),
  canDirectPlayDefault: z.boolean(),
  downloadStatus: downloadStatusSchema.optional()
});

export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;
export type MediaItem = z.infer<typeof mediaItemSchema>;

export const libraryResponseSchema = z.object({
  items: z.array(mediaItemSchema),
  session: sessionSchema,
  lastScannedPaths: z.array(z.string())
});

export const scanResponseSchema = libraryResponseSchema.extend({ scannedCount: z.number().int() });

export const refreshResponseSchema = libraryResponseSchema.extend({ refreshedAt: z.number() });

export const sampleResponseSchema = z.object({
  items: z.array(mediaItemSchema),
  item: mediaItemSchema.nullable()
});

export type LibraryResponse = z.infer<typeof libraryResponseSchema>;

/** Accepts one path, or several separated by `;` or new lines. */
export const scanFormSchema = z.object({
  paths: z
    .string()
    .transform((raw) =>
      raw
        .split(/[;\n]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    )
    .pipe(z.array(z.string()).min(1, "Informe ao menos uma pasta ou arquivo para escanear."))
});

export type ScanFormInput = z.input<typeof scanFormSchema>;
export type ScanFormOutput = z.output<typeof scanFormSchema>;

export type PlaybackMode = "direct-play" | "remux-aac" | "remux-copy";

export const PLAYBACK_MODE_LABEL: Record<PlaybackMode, string> = {
  "direct-play": "Direct Play",
  "remux-aac": "Remux AAC",
  "remux-copy": "Remux"
};

/** Mirrors `resolvePlaybackPlan` on the server for a stream that starts at 0. */
export function playbackModeFor(media: MediaItem, audioStreamIndex: number | null): PlaybackMode {
  const defaultAudio = media.audioTracks[0];
  const selectedAudio = media.audioTracks.find((track) => track.streamIndex === audioStreamIndex) ?? defaultAudio;
  const usesDefaultAudio = audioStreamIndex === null || selectedAudio?.streamIndex === defaultAudio?.streamIndex;
  if (media.canDirectPlayDefault && usesDefaultAudio) return "direct-play";
  return selectedAudio && !selectedAudio.isNativeTvCompatible ? "remux-aac" : "remux-copy";
}

export function isDownloadPending(media: MediaItem): boolean {
  return media.downloadStatus !== undefined && !media.downloadStatus.ready;
}

export function describeAudioTrack(track: AudioTrack): string {
  const name = track.title || track.language || `Faixa ${track.audioOrderIndex + 1}`;
  return `${name} · ${track.codec.toUpperCase()} ${track.channels}ch`;
}

export function describeSubtitleTrack(track: SubtitleTrack): string {
  const name = track.title || track.language || track.id;
  return track.kind === "external" ? `${name} (${track.format.toUpperCase()} externo)` : `${name} (embutida)`;
}

export interface TrackChoice {
  readonly audioStreamIndex: number | null;
  readonly subtitleId: string | null;
}

/** Choice applied when a media is selected: first audio track, first Portuguese subtitle or none. */
export function defaultTrackChoice(media: MediaItem): TrackChoice {
  const portuguese = media.subtitleTracks.find((track) => /^(pt|por|br)/i.test(track.language));
  return { audioStreamIndex: media.audioTracks[0]?.streamIndex ?? null, subtitleId: portuguese?.id ?? null };
}
