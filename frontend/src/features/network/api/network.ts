import { apiUrl } from "../../../shared/api/baseUrl";
import { getJson } from "../../../shared/api/client";
import { networkResponseSchema, serverStatusSchema, type QrEcc } from "../schemas/network";

export function fetchNetwork() {
  return getJson("/api/network", networkResponseSchema);
}

export function fetchServerStatus() {
  return getJson("/api/status", serverStatusSchema);
}

export function qrSvgUrl(ecc: QrEcc): string {
  return apiUrl(`/api/network/qr.svg?ecc=${ecc}`);
}
