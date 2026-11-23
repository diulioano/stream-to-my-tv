import { z } from "zod";

export const receiverStateSchema = z.enum(["idle", "loading", "playing", "paused", "stopped", "ended", "error"]);
export type ReceiverState = z.infer<typeof receiverStateSchema>;

export const statusMessageSchema = z.object({
  type: z.literal("status"),
  state: receiverStateSchema.catch("idle"),
  mediaId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  positionSec: z.number().catch(0).default(0),
  durationSec: z.number().catch(0).default(0),
  audioStreamIndex: z.number().int().nullable().optional(),
  subtitleId: z.string().nullable().optional()
});

export const commandMessageSchema = z.discriminatedUnion("command", [
  z.object({
    type: z.literal("command"),
    command: z.literal("load"),
    mediaId: z.string(),
    title: z.string(),
    audioStreamIndex: z.number().int().nullable(),
    subtitleId: z.string().nullable(),
    startSec: z.number(),
    durationSec: z.number(),
    canDirectPlay: z.boolean()
  }),
  z.object({ type: z.literal("command"), command: z.literal("play") }),
  z.object({ type: z.literal("command"), command: z.literal("pause") }),
  z.object({ type: z.literal("command"), command: z.literal("seek"), positionSec: z.number() }),
  z.object({
    type: z.literal("command"),
    command: z.literal("setAudio"),
    mediaId: z.string(),
    audioStreamIndex: z.number().int().nullable(),
    positionSec: z.number().optional()
  }),
  z.object({
    type: z.literal("command"),
    command: z.literal("setSubtitle"),
    mediaId: z.string(),
    subtitleId: z.string().nullable()
  })
]);

export type StatusMessage = z.infer<typeof statusMessageSchema>;
export type CommandMessage = z.infer<typeof commandMessageSchema>;

export const serverMessageSchema = z.union([statusMessageSchema, commandMessageSchema]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Parses one `/ws` frame. Unknown or malformed frames return `null` and are ignored. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = serverMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
