import { getJson, postJson } from "../../../shared/api/client";
import { commandResultSchema, tvsResponseSchema, type CastAction, type RokuKey } from "../schemas/tv";

export function fetchTvs() {
  return getJson("/api/tvs", tvsResponseSchema);
}

export function scanTvs() {
  return postJson("/api/tvs/scan", tvsResponseSchema);
}

export interface MediaTarget {
  readonly tvId: string;
  readonly mediaId: string;
  readonly audioStreamIndex: number | null;
  readonly subtitleId: string | null;
}

export function castLoad(target: MediaTarget & { readonly startSec: number }) {
  return postJson("/api/tv/cast/load", commandResultSchema, target);
}

export function castControl(tvId: string, action: CastAction, value?: number) {
  return postJson("/api/tv/cast/control", commandResultSchema, { tvId, action, value });
}

export function dlnaPush(target: MediaTarget) {
  return postJson("/api/tv/dlna/push", commandResultSchema, target);
}

export function rokuLaunch(tvId: string) {
  return postJson("/api/tv/roku/launch", commandResultSchema, { tvId });
}

export function rokuKeypress(tvId: string, key: RokuKey) {
  return postJson("/api/tv/roku/keypress", commandResultSchema, { tvId, key });
}
