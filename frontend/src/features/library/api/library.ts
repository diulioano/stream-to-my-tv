import { getJson, postJson } from "../../../shared/api/client";
import {
  libraryResponseSchema,
  refreshResponseSchema,
  sampleResponseSchema,
  scanResponseSchema
} from "../schemas/media";

export function fetchLibrary() {
  return getJson("/api/library", libraryResponseSchema);
}

export function scanLibrary(paths: readonly string[]) {
  const body = paths.length === 1 ? { path: paths[0] } : { paths };
  return postJson("/api/library/scan", scanResponseSchema, body);
}

export function refreshLibrary() {
  return postJson("/api/library/refresh", refreshResponseSchema);
}

export function generateSample() {
  return postJson("/api/library/sample", sampleResponseSchema);
}
