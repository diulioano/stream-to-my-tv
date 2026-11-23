import { http, HttpResponse, ws } from "msw";
import { setupServer } from "msw/node";
import type { DiscoveredTv } from "../features/discovery/schemas/tv";
import type { MediaItem } from "../features/library/schemas/media";
import type { NetworkInfo } from "../features/network/schemas/network";
import type { Session } from "../features/player/schemas/session";
import { castTv, directMedia, dlnaTv, downloadingMedia, makeSession, network, rokuTv } from "./fixtures";

export const API = "http://localhost:3000";
export const liveSocket = ws.link("ws://localhost:3000/ws");

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** In-memory backend shared by every handler; reset before each test. */
export interface FakeBackend {
  items: MediaItem[];
  session: Session;
  tvs: DiscoveredTv[];
  scannedTvs: DiscoveredTv[];
  network: NetworkInfo;
  lastScannedPaths: string[];
  requests: RecordedRequest[];
  socketFrames: unknown[];
}

export const backend: FakeBackend = createBackend();

function createBackend(): FakeBackend {
  return {
    items: [directMedia, downloadingMedia],
    session: makeSession(),
    tvs: [castTv],
    scannedTvs: [castTv, dlnaTv, rokuTv],
    network: { ...network },
    lastScannedPaths: [...network.lastScannedPaths],
    requests: [],
    socketFrames: []
  };
}

export function resetBackend(): void {
  Object.assign(backend, createBackend());
}

export function requestsTo(path: string): RecordedRequest[] {
  return backend.requests.filter((r) => r.path === path);
}

async function record(request: Request): Promise<unknown> {
  const url = new URL(request.url);
  const text = request.method === "GET" ? "" : await request.text();
  const body: unknown = text ? JSON.parse(text) : null;
  backend.requests.push({ method: request.method, path: url.pathname, body });
  return body;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function library() {
  return { items: backend.items, session: backend.session, lastScannedPaths: backend.lastScannedPaths };
}

const ok = (detail: string) => HttpResponse.json({ ok: true, status: 200, detail });

export const handlers = [
  http.get(`${API}/api/status`, () =>
    HttpResponse.json({
      ok: true,
      pid: 4242,
      port: 4321,
      baseUrl: backend.network.baseUrl,
      lan: backend.network.lan,
      allowLoopback: true,
      activeMediaProcesses: 1,
      catalogCount: backend.items.length,
      session: backend.session
    })
  ),
  http.get(`${API}/api/network`, () =>
    HttpResponse.json({ ...backend.network, lastScannedPaths: backend.lastScannedPaths })
  ),
  http.get(`${API}/api/library`, () => HttpResponse.json(library())),
  http.post(`${API}/api/library/scan`, async ({ request }) => {
    const body = asRecord(await record(request));
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : [String(body.path)];
    backend.lastScannedPaths = [...paths, ...backend.lastScannedPaths];
    return HttpResponse.json({ ...library(), scannedCount: 1 });
  }),
  http.post(`${API}/api/library/refresh`, async ({ request }) => {
    await record(request);
    backend.items = backend.items.map((item) =>
      item.downloadStatus?.ready === false
        ? { ...item, downloadStatus: { ready: true, estimatedProgressPct: 100, reason: null } }
        : item
    );
    return HttpResponse.json({ ...library(), refreshedAt: 1_700_000_100 });
  }),
  http.post(`${API}/api/library/sample`, async ({ request }) => {
    await record(request);
    const sample: MediaItem = { ...directMedia, id: "m-sample", title: "Amostra Gerada", fileName: "sample.mp4" };
    backend.items = [...backend.items, sample];
    backend.session = { ...backend.session, mediaId: sample.id };
    return HttpResponse.json({ items: backend.items, item: sample });
  }),
  http.get(`${API}/api/session`, () => HttpResponse.json({ session: backend.session })),
  http.post(`${API}/api/session`, async ({ request }) => {
    const patch = asRecord(await record(request));
    backend.session = { ...backend.session, ...patch, updatedAt: backend.session.updatedAt + 1 };
    return HttpResponse.json({ session: backend.session });
  }),
  http.get(`${API}/api/tvs`, () => HttpResponse.json({ tvs: backend.tvs })),
  http.post(`${API}/api/tvs/scan`, async ({ request }) => {
    await record(request);
    backend.tvs = backend.scannedTvs;
    return HttpResponse.json({ tvs: backend.tvs });
  }),
  http.post(`${API}/api/tv/cast/load`, async ({ request }) => {
    await record(request);
    return ok("Stream carregado no Google Cast.");
  }),
  http.post(`${API}/api/tv/cast/control`, async ({ request }) => {
    const body = asRecord(await record(request));
    return ok(`Comando ${String(body.action)} aplicado na TV.`);
  }),
  http.post(`${API}/api/tv/dlna/push`, async ({ request }) => {
    await record(request);
    return ok(`<s:Envelope>${"x".repeat(300)}</s:Envelope>`);
  }),
  http.post(`${API}/api/tv/roku/launch`, async ({ request }) => {
    await record(request);
    return ok("");
  }),
  http.post(`${API}/api/tv/roku/keypress`, async ({ request }) => {
    await record(request);
    return ok("");
  }),
  http.post(`${API}/api/media/:id/subtitles/upload`, async ({ request, params }) => {
    await record(request);
    const id = String(params.id);
    const item = backend.items.find((m) => m.id === id);
    if (!item) return HttpResponse.json({ error: "Filme não encontrado no catálogo." }, { status: 404 });
    const updated: MediaItem = {
      ...item,
      subtitleTracks: [
        ...item.subtitleTracks,
        { id: "ext-pt", kind: "external", filePath: "C:/Videos/filme.pt-BR.srt", format: "srt", language: "pt-BR", title: "pt-BR" }
      ]
    };
    backend.items = backend.items.map((m) => (m.id === id ? updated : m));
    backend.session = { ...backend.session, subtitleId: "ext-pt" };
    return HttpResponse.json({ item: updated, selectedSubtitleId: "ext-pt" });
  }),
  liveSocket.addEventListener("connection", ({ client }) => {
    client.addEventListener("message", (event) => {
      if (typeof event.data === "string") backend.socketFrames.push(JSON.parse(event.data));
    });
  })
];

export const server = setupServer(...handlers);
