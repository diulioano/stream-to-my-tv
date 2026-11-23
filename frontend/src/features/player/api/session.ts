import { z } from "zod";
import { getJson, postJson } from "../../../shared/api/client";
import { mediaItemSchema } from "../../library/schemas/media";
import { sessionResponseSchema, type SessionPatch } from "../schemas/session";

export function fetchSession() {
  return getJson("/api/session", sessionResponseSchema);
}

export function updateSession(patch: SessionPatch) {
  return postJson("/api/session", sessionResponseSchema, patch);
}

export const subtitleUploadResponseSchema = z.object({
  item: mediaItemSchema,
  selectedSubtitleId: z.string().nullable()
});

export interface SubtitleUpload {
  readonly fileName: string;
  readonly content: string;
  readonly language: string;
}

export function uploadSubtitle(mediaId: string, upload: SubtitleUpload) {
  return postJson(
    `/api/media/${encodeURIComponent(mediaId)}/subtitles/upload`,
    subtitleUploadResponseSchema,
    upload
  );
}
