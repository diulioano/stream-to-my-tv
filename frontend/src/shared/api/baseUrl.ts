export const TAURI_SIDECAR_BASE_URL = "http://127.0.0.1:4321";

declare global {
  interface Window {
    __STTV_BACKEND_URL__?: string;
  }
}

export interface BaseUrlEnvironment {
  readonly configuredBaseUrl: string | undefined;
  readonly runtimeBaseUrl?: string | undefined;
  readonly isTauri: boolean;
}

/**
 * Resolution order: explicit `VITE_API_BASE_URL`, then Tauri-injected `__STTV_BACKEND_URL__`,
 * then the default Tauri sidecar on loopback, then same-origin (`""`) when served by the Node server.
 */
export function resolveApiBaseUrl({
  configuredBaseUrl,
  runtimeBaseUrl,
  isTauri
}: BaseUrlEnvironment): string {
  const configured = configuredBaseUrl?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const runtime = runtimeBaseUrl?.trim();
  if (runtime) return runtime.replace(/\/+$/, "");
  return isTauri ? TAURI_SIDECAR_BASE_URL : "";
}

export function detectEnvironment(): BaseUrlEnvironment {
  const hasWindow = typeof window !== "undefined";
  return {
    configuredBaseUrl: import.meta.env.VITE_API_BASE_URL,
    runtimeBaseUrl: hasWindow ? window.__STTV_BACKEND_URL__ : undefined,
    isTauri: hasWindow && "__TAURI_INTERNALS__" in window
  };
}

export const API_BASE_URL = resolveApiBaseUrl(detectEnvironment());

export function apiUrl(path: string, baseUrl?: string): string {
  const effectiveBase = baseUrl ?? resolveApiBaseUrl(detectEnvironment());
  return `${effectiveBase}${path}`;
}

export function webSocketUrl(baseUrl: string, location: Pick<Location, "protocol" | "host">): string {
  if (baseUrl) return `${baseUrl.replace(/^http/, "ws")}/ws`;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}
