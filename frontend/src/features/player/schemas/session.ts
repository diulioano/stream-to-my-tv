import { z } from "zod";

export const sessionSchema = z.object({
  mediaId: z.string().nullable(),
  audioStreamIndex: z.number().int().nullable(),
  subtitleId: z.string().nullable(),
  positionSec: z.number(),
  playing: z.boolean(),
  selectedTvId: z.string().nullable(),
  updatedAt: z.number()
});

export type Session = z.infer<typeof sessionSchema>;

export type SessionPatch = Partial<Omit<Session, "updatedAt">>;

export const sessionResponseSchema = z.object({ session: sessionSchema });

export const SUBTITLE_EXTENSIONS = [".srt", ".vtt"] as const;

export const subtitleUploadFormSchema = z.object({
  files: z
    .custom<FileList>((value) => typeof FileList !== "undefined" && value instanceof FileList, {
      message: "Selecione um arquivo de legenda."
    })
    .refine((files) => files.length === 1, "Selecione um arquivo de legenda.")
    .refine((files) => {
      const name = files.item(0)?.name.toLowerCase() ?? "";
      return SUBTITLE_EXTENSIONS.some((ext) => name.endsWith(ext));
    }, "A legenda precisa ser .srt ou .vtt."),
  language: z
    .string()
    .trim()
    .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/, "Use um código de idioma como pt-BR ou en.")
});

export type SubtitleUploadFormInput = z.input<typeof subtitleUploadFormSchema>;
export type SubtitleUploadFormOutput = z.output<typeof subtitleUploadFormSchema>;
