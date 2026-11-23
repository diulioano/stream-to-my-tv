import fs from "node:fs";
import fsp from "node:fs/promises";
import http, { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  castToGoogleCastTv,
  controlGoogleCastTv,
  discoverLanTvs,
  launchRokuApp,
  pushToDlnaRenderer,
  sendRokuKeypress
} from "./discovery";
import {
  buildConnectionManagerScpdXml,
  buildContentDirectoryScpdXml,
  buildDlnaDeviceXml,
  handleConnectionManagerSoap,
  handleContentDirectorySoap,
  startSsdpMediaServerAnnouncer
} from "./dlna";
import {
  buildHlsPlaylist,
  extractSubtitleToSrt,
  extractSubtitleToWebVtt,
  generateSampleMediaFile,
  getActiveMediaProcessCount,
  killActiveMediaProcesses,
  probeMediaFile,
  resolvePlaybackPlan,
  scanMediaInputs,
  serveDirectPlay,
  serveHlsSegment,
  serveRemuxStream
} from "./media";
import { isIpInLanSubnet, normalizeRemoteAddress, selectPrimaryLanInterface } from "./network";
import { QrErrorCorrectionLevel, renderQrSvg } from "./qr";
import { ActiveSessionState, DiscoveredTv, LanInterface, MediaId, MediaItem } from "./types";
import { renderControllerHtml, renderReceiverHtml } from "./ui";

export interface StreamServerOptions {
  readonly lan?: LanInterface;
  readonly bindHost?: string;
  readonly port?: number;
  readonly initialMediaPaths?: readonly string[];
  readonly allowedScanRoots?: readonly string[];
  readonly sampleDir?: string;
  readonly allowLoopback?: boolean;
  readonly enableSsdpAnnouncer?: boolean;
  readonly frontendDistDir?: string;
  readonly clientIpExtractor?: (req: IncomingMessage) => string | undefined;
}

export interface StreamServerInstance {
  readonly server: http.Server;
  readonly lan: LanInterface;
  readonly bindHost: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly getCatalog: () => readonly MediaItem[];
  readonly setCatalog: (items: readonly MediaItem[]) => void;
  readonly getSession: () => ActiveSessionState;
  readonly getDiscoveredTvs: () => readonly DiscoveredTv[];
  readonly setDiscoveredTvs: (tvs: readonly DiscoveredTv[]) => void;
  readonly close: () => Promise<void>;
}

const BLOCKED_SYSTEM_PREFIXES = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/boot"
];

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function readRequestBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy(new BadRequestError("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new BadRequestError("Content-Type must be application/json");
  }
  const raw = await readRequestBody(req);
  if (!raw.trim()) return {} as T;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadRequestError("JSON body must be an object");
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError("Invalid JSON payload");
  }
}

function safeDecodeUri(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new BadRequestError("Malformed URI component");
  }
}

function isAllowedHostHeader(
  hostHeader: string | undefined,
  lan: LanInterface,
  bindHost: string,
  allowLoopback: boolean
): boolean {
  if (!hostHeader) return true;
  const hostOnly = hostHeader.trim().split(":")[0]?.toLowerCase() ?? "";
  if (!hostOnly) return false;
  if (hostOnly === lan.address || hostOnly === bindHost) return true;
  if (allowLoopback && (hostOnly === "127.0.0.1" || hostOnly === "localhost")) return true;
  return isIpInLanSubnet(hostOnly, lan, allowLoopback);
}

function isAllowedOriginHeader(
  originHeader: string | undefined,
  lan: LanInterface,
  bindHost: string,
  allowLoopback: boolean
): boolean {
  if (!originHeader) return true;
  try {
    const u = new URL(originHeader);
    const hostname = u.hostname.toLowerCase();
    if (hostname === lan.address || hostname === bindHost) return true;
    if (
      allowLoopback &&
      (hostname === "127.0.0.1" ||
        hostname === "localhost" ||
        hostname === "tauri.localhost" ||
        u.protocol === "tauri:")
    ) {
      return true;
    }
    return isIpInLanSubnet(hostname, lan, allowLoopback);
  } catch {
    return false;
  }
}

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2"
};

async function tryServeFrontendStatic(
  frontendDistDir: string | undefined,
  pathname: string,
  res: ServerResponse
): Promise<boolean> {
  if (!frontendDistDir) return false;
  const rootDir = path.resolve(frontendDistDir);
  if (!fs.existsSync(rootDir)) return false;

  const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(rootDir, relPath);
  const relativeToRoot = path.relative(rootDir, candidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return false;
  }

  let fileToServe = candidate;
  try {
    const stat = await fsp.stat(fileToServe);
    if (stat.isDirectory()) {
      fileToServe = path.join(fileToServe, "index.html");
    }
  } catch {
    if (!path.extname(pathname)) {
      fileToServe = path.join(rootDir, "index.html");
    } else {
      return false;
    }
  }

  try {
    const content = await fsp.readFile(fileToServe);
    const ext = path.extname(fileToServe).toLowerCase();
    const contentType = STATIC_MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function resolveCanonicalScanPath(targetPath: string): string {
  const lexical = path.resolve(targetPath);
  try {
    return fs.realpathSync.native(lexical);
  } catch {
    return lexical;
  }
}

function isBlockedSystemPath(resolvedPath: string): boolean {
  const normalizedLower = resolvedPath.replace(/\//g, "\\").toLowerCase();
  const posixLower = resolvedPath.replace(/\\/g, "/").toLowerCase();
  for (const prefix of BLOCKED_SYSTEM_PREFIXES) {
    if (
      normalizedLower === prefix ||
      normalizedLower.startsWith(`${prefix}\\`) ||
      posixLower === prefix ||
      posixLower.startsWith(`${prefix}/`)
    ) {
      return true;
    }
  }
  return false;
}

function isAllowedScanPath(targetPath: string, allowedRoots?: readonly string[]): boolean {
  const lexical = path.resolve(targetPath);
  try {
    const lstat = fs.lstatSync(lexical);
    if (lstat.isSymbolicLink()) return false;
  } catch {
    // Allow non-existent path checks to fall through to canonical/lexical comparison
  }
  const canonical = resolveCanonicalScanPath(targetPath);
  if (isBlockedSystemPath(lexical) || isBlockedSystemPath(canonical)) {
    return false;
  }
  if (!allowedRoots || allowedRoots.length === 0) return true;
  return allowedRoots.some((root) => {
    const canonicalRoot = resolveCanonicalScanPath(root);
    const rel = path.relative(canonicalRoot, canonical);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendXml(res: ServerResponse, status: number, xml: string): void {
  res.writeHead(status, {
    "Content-Type": "text/xml; charset=utf-8",
    "Content-Length": Buffer.byteLength(xml),
    "Cache-Control": "no-store"
  });
  res.end(xml);
}

function parseOptionalInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function parseStartSec(raw: string | null | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function createStreamServer(
  options: StreamServerOptions = {}
): Promise<StreamServerInstance> {
  const lan = options.lan ?? selectPrimaryLanInterface();
  const bindHost = options.bindHost ?? lan.address;
  const allowLoopback = options.allowLoopback ?? true;
  const sampleDir = options.sampleDir ?? path.resolve(process.cwd(), "media-samples");
  const extractIp =
    options.clientIpExtractor ?? ((req: IncomingMessage) => req.socket.remoteAddress);

  const catalogMap = new Map<MediaId, MediaItem>();
  let discoveredTvs: DiscoveredTv[] = [];
  const lastScannedPaths: string[] = [];
  let inFlightRefresh: Promise<MediaItem[]> | null = null;

  function recordScannedPaths(inputs: readonly string[]): void {
    for (const raw of inputs) {
      const resolved = path.resolve(raw);
      const existingIdx = lastScannedPaths.indexOf(resolved);
      if (existingIdx !== -1) lastScannedPaths.splice(existingIdx, 1);
      lastScannedPaths.unshift(resolved);
    }
    if (lastScannedPaths.length > 6) {
      lastScannedPaths.length = 6;
    }
  }

  function getSuggestedDownloadsDir(): string | null {
    const downloadsDir = path.join(os.homedir(), "Downloads");
    if (!isAllowedScanPath(downloadsDir, options.allowedScanRoots)) return null;
    try {
      return fs.statSync(downloadsDir).isDirectory() ? downloadsDir : null;
    } catch {
      return null;
    }
  }

  if (options.initialMediaPaths && options.initialMediaPaths.length > 0) {
    recordScannedPaths(options.initialMediaPaths);
    const scanned = await scanMediaInputs(options.initialMediaPaths);
    for (const item of scanned) catalogMap.set(item.id, item);
  }

  const firstItem = [...catalogMap.values()][0] ?? null;
  const session: ActiveSessionState = {
    mediaId: firstItem?.id ?? null,
    audioStreamIndex: firstItem?.audioTracks[0]?.streamIndex ?? null,
    subtitleId: firstItem?.subtitleTracks[0]?.id ?? null,
    positionSec: 0,
    playing: false,
    selectedTvId: null,
    updatedAt: Math.floor(Date.now() / 1000)
  };

  let activePort = options.port ?? 0;
  const getBaseUrl = (): string => `http://${lan.address}:${activePort}`;
  const getCatalog = (): MediaItem[] => [...catalogMap.values()];

  function applyValidatedSessionPatch(patch: Record<string, unknown>): void {
    if (patch.mediaId === null) {
      session.mediaId = null;
    } else if (typeof patch.mediaId === "string" && catalogMap.has(patch.mediaId as MediaId)) {
      session.mediaId = patch.mediaId as MediaId;
    }
    const activeMedia = session.mediaId ? catalogMap.get(session.mediaId) : undefined;
    if (patch.audioStreamIndex === null) {
      session.audioStreamIndex = null;
    } else if (
      typeof patch.audioStreamIndex === "number" &&
      Number.isInteger(patch.audioStreamIndex) &&
      (!activeMedia || activeMedia.audioTracks.some((a) => a.streamIndex === patch.audioStreamIndex))
    ) {
      session.audioStreamIndex = patch.audioStreamIndex;
    }
    if (patch.subtitleId === null) {
      session.subtitleId = null;
    } else if (
      typeof patch.subtitleId === "string" &&
      (!activeMedia || activeMedia.subtitleTracks.some((s) => s.id === patch.subtitleId))
    ) {
      session.subtitleId = patch.subtitleId;
    }
    if (patch.selectedTvId === null || typeof patch.selectedTvId === "string") {
      session.selectedTvId = patch.selectedTvId;
    }
    if (typeof patch.positionSec === "number" && Number.isFinite(patch.positionSec)) {
      session.positionSec = Math.max(0, patch.positionSec);
    }
    if (typeof patch.playing === "boolean") {
      session.playing = patch.playing;
    }
    session.updatedAt = Math.floor(Date.now() / 1000);
  }

  const wss = new WebSocketServer({ noServer: true });
  const wsClients = new Set<WebSocket>();

  function broadcastWs(payload: unknown, exclude?: WebSocket): void {
    const text = JSON.stringify(payload);
    for (const client of wsClients) {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    }
  }

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.type === "command") {
          applyValidatedSessionPatch(msg);
          broadcastWs(msg, ws);
        } else if (msg.type === "status") {
          applyValidatedSessionPatch({
            positionSec: msg.positionSec,
            playing:
              msg.state === "playing"
                ? true
                : msg.state === "paused" || msg.state === "idle"
                  ? false
                  : undefined
          });
          broadcastWs(msg, ws);
        }
      } catch {
        return;
      }
    });
    ws.on("close", () => wsClients.delete(ws));
  });

  const server = http.createServer(async (req, res) => {
    const clientIp = extractIp(req);
    if (!isIpInLanSubnet(clientIp, lan, allowLoopback)) {
      sendJson(res, 403, {
        error: `Forbidden: client IP ${normalizeRemoteAddress(clientIp) || "unknown"} is outside LAN subnet ${lan.cidr}`
      });
      return;
    }

    if (!isAllowedHostHeader(req.headers.host, lan, bindHost, allowLoopback)) {
      sendJson(res, 403, { error: "Forbidden: invalid Host header" });
      return;
    }

    try {
      const reqUrl = new URL(req.url ?? "/", getBaseUrl());
      const pathname = reqUrl.pathname;
      const method = req.method ?? "GET";

      const originHeader = req.headers.origin;
      const originAllowed = isAllowedOriginHeader(originHeader, lan, bindHost, allowLoopback);
      if (originHeader && originAllowed) {
        res.setHeader("Access-Control-Allow-Origin", originHeader);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }

      if (method === "OPTIONS" && pathname.startsWith("/api/")) {
        if (!originAllowed) {
          sendJson(res, 403, { error: "Forbidden: cross-origin preflight outside LAN" });
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }

      if (
        method === "POST" &&
        pathname.startsWith("/api/") &&
        !originAllowed
      ) {
        sendJson(res, 403, { error: "Forbidden: cross-origin request outside LAN" });
        return;
      }

      if (method === "GET" && pathname === "/api/status") {
        sendJson(res, 200, {
          ok: true,
          pid: process.pid,
          port: activePort,
          baseUrl: getBaseUrl(),
          lan,
          allowLoopback,
          activeMediaProcesses: getActiveMediaProcessCount(),
          catalogCount: catalogMap.size,
          session
        });
        return;
      }

      if (method === "GET" && ["/assets/camera.png", "/assets/clapper.png", "/assets/film.png"].includes(pathname)) {
        const photo = await fsp.readFile(path.join(__dirname, "..", pathname));
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
        res.end(photo);
        return;
      }

      if (method === "GET" && pathname === "/receiver") {
        const html = renderReceiverHtml(lan, activePort);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(html),
          "Cache-Control": "no-store"
        });
        res.end(html);
        return;
      }

      if (
        method === "GET" &&
        options.frontendDistDir &&
        !pathname.startsWith("/api/") &&
        !pathname.startsWith("/media/") &&
        !pathname.startsWith("/stream/") &&
        !pathname.startsWith("/subtitles/") &&
        !pathname.startsWith("/dlna/")
      ) {
        const served = await tryServeFrontendStatic(options.frontendDistDir, pathname, res);
        if (served) return;
      }

      if (method === "GET" && pathname === "/") {
        const html = renderControllerHtml(lan, activePort);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(html),
          "Cache-Control": "no-store"
        });
        res.end(html);
        return;
      }

      if (method === "GET" && pathname === "/api/network") {
        const baseUrl = getBaseUrl();
        sendJson(res, 200, {
          lan,
          bindHost,
          port: activePort,
          baseUrl,
          panelUrl: `${baseUrl}/`,
          qrSvgUrl: `${baseUrl}/api/network/qr.svg`,
          suggestedDownloadsDir: getSuggestedDownloadsDir(),
          lastScannedPaths: [...lastScannedPaths]
        });
        return;
      }

      if (method === "GET" && pathname === "/api/network/qr.svg") {
        const rawEcc = (reqUrl.searchParams.get("ecc") ?? "M").toUpperCase();
        const ecc: QrErrorCorrectionLevel = rawEcc === "Q" ? "Q" : "M";
        const svg = renderQrSvg(`${getBaseUrl()}/`, { ecc, quietZone: 4 });
        res.writeHead(200, {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(svg),
          "Cache-Control": "no-store"
        });
        res.end(svg);
        return;
      }

      if (method === "GET" && pathname === "/api/library") {
        sendJson(res, 200, { items: getCatalog(), session, lastScannedPaths: [...lastScannedPaths] });
        return;
      }

      if (method === "POST" && pathname === "/api/library/scan") {
        const body = await readJsonBody<{ path?: string; paths?: string[] }>(req);
        const rawInputs = (body.paths ?? (typeof body.path === "string" ? [body.path] : [])).filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0
        );
        if (rawInputs.length === 0) {
          sendJson(res, 400, { error: "Missing path to scan" });
          return;
        }
        for (const p of rawInputs) {
          if (!isAllowedScanPath(p, options.allowedScanRoots)) {
            sendJson(res, 403, { error: "Scan path is restricted" });
            return;
          }
        }
        recordScannedPaths(rawInputs);
        const scanned = await scanMediaInputs(rawInputs);
        for (const item of scanned) catalogMap.set(item.id, item);
        if (!session.mediaId && scanned[0]) {
          session.mediaId = scanned[0].id;
          session.audioStreamIndex = scanned[0].audioTracks[0]?.streamIndex ?? null;
          session.subtitleId = scanned[0].subtitleTracks[0]?.id ?? null;
          session.updatedAt = Math.floor(Date.now() / 1000);
        }
        sendJson(res, 200, {
          items: getCatalog(),
          scannedCount: scanned.length,
          lastScannedPaths: [...lastScannedPaths],
          session
        });
        return;
      }

      if (method === "POST" && pathname === "/api/library/refresh") {
        const runRefresh = async (): Promise<MediaItem[]> => {
          const snapshotIds = new Set(catalogMap.keys());
          const existingItems = getCatalog();
          const refreshedMap = new Map<MediaId, MediaItem>();

          for (const item of existingItems) {
            if (!fs.existsSync(item.filePath)) continue;
            try {
              const updated = await probeMediaFile(item.filePath);
              refreshedMap.set(updated.id, updated);
            } catch {
              refreshedMap.set(item.id, item);
            }
          }

          const allowedRecent = lastScannedPaths.filter((p) =>
            isAllowedScanPath(p, options.allowedScanRoots)
          );
          if (allowedRecent.length > 0) {
            const rescanned = await scanMediaInputs(allowedRecent);
            for (const item of rescanned) {
              refreshedMap.set(item.id, item);
            }
          }

          for (const id of snapshotIds) {
            if (!refreshedMap.has(id)) {
              catalogMap.delete(id);
            }
          }
          for (const [id, item] of refreshedMap) {
            catalogMap.set(id, item);
          }

          const nextCatalog = getCatalog();
          if (session.mediaId && catalogMap.has(session.mediaId)) {
            const active = catalogMap.get(session.mediaId)!;
            if (
              session.audioStreamIndex === null ||
              !active.audioTracks.some((a) => a.streamIndex === session.audioStreamIndex)
            ) {
              session.audioStreamIndex = active.audioTracks[0]?.streamIndex ?? null;
            }
            if (
              session.subtitleId !== null &&
              !active.subtitleTracks.some((s) => s.id === session.subtitleId)
            ) {
              session.subtitleId = active.subtitleTracks[0]?.id ?? null;
            }
          } else if (nextCatalog[0]) {
            session.mediaId = nextCatalog[0].id;
            session.audioStreamIndex = nextCatalog[0].audioTracks[0]?.streamIndex ?? null;
            session.subtitleId = nextCatalog[0].subtitleTracks[0]?.id ?? null;
          } else {
            session.mediaId = null;
            session.audioStreamIndex = null;
            session.subtitleId = null;
          }
          session.updatedAt = Math.floor(Date.now() / 1000);
          return nextCatalog;
        };

        if (!inFlightRefresh) {
          inFlightRefresh = runRefresh().finally(() => {
            inFlightRefresh = null;
          });
        }
        const nextCatalog = await inFlightRefresh;

        sendJson(res, 200, {
          items: nextCatalog,
          session,
          lastScannedPaths: [...lastScannedPaths],
          refreshedAt: session.updatedAt
        });
        return;
      }

      if (method === "POST" && pathname === "/api/library/sample") {
        const { mkvPath, mp4Path } = await generateSampleMediaFile(sampleDir);
        const scanned = await scanMediaInputs([mkvPath, mp4Path]);
        for (const item of scanned) catalogMap.set(item.id, item);
        const primary = scanned[0] ?? getCatalog()[0] ?? null;
        if (primary) {
          session.mediaId = primary.id;
          session.audioStreamIndex = primary.audioTracks[0]?.streamIndex ?? null;
          session.subtitleId = primary.subtitleTracks[0]?.id ?? null;
          session.updatedAt = Math.floor(Date.now() / 1000);
        }
        sendJson(res, 200, { items: getCatalog(), item: primary });
        return;
      }

      if (method === "GET" && pathname === "/api/session") {
        sendJson(res, 200, { session });
        return;
      }

      if (method === "POST" && pathname === "/api/session") {
        const body = await readJsonBody<Record<string, unknown>>(req);
        if (
          typeof body.mediaId === "string" &&
          !catalogMap.has(body.mediaId as MediaId)
        ) {
          sendJson(res, 400, { error: "Unknown mediaId" });
          return;
        }
        applyValidatedSessionPatch(body);
        sendJson(res, 200, { session });
        return;
      }

      if (method === "GET" && pathname === "/api/tvs") {
        sendJson(res, 200, { tvs: discoveredTvs });
        return;
      }

      if (method === "POST" && pathname === "/api/tvs/scan") {
        discoveredTvs = await discoverLanTvs(lan, 2500);
        if (!session.selectedTvId && discoveredTvs[0]) {
          session.selectedTvId = discoveredTvs[0].id;
        }
        sendJson(res, 200, { tvs: discoveredTvs });
        return;
      }

      if (method === "POST" && pathname === "/api/tv/cast/load") {
        const body = await readJsonBody<{
          tvId?: string | null;
          ip?: string;
          mediaId?: MediaId;
          audioStreamIndex?: number | null;
          subtitleId?: string | null;
          startSec?: number;
        }>(req);
        const media = body.mediaId ? catalogMap.get(body.mediaId) : undefined;
        if (!media) {
          sendJson(res, 404, { error: "Filme não encontrado no catálogo." });
          return;
        }
        if (media.downloadStatus && !media.downloadStatus.ready) {
          sendJson(res, 409, {
            error:
              media.downloadStatus.reason ??
              "O arquivo ainda está em download e não possui cabeçalho de mídia (moov/ftyp)."
          });
          return;
        }
        const tv =
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "google-cast" }> =>
              t.protocol === "google-cast" && t.id === (body.tvId ?? session.selectedTvId)
          ) ??
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "google-cast" }> =>
              t.protocol === "google-cast"
          );
        const targetIp = body.ip ?? tv?.ip;
        if (!targetIp) {
          sendJson(res, 404, { error: "Nenhuma TV Google Cast encontrada na LAN." });
          return;
        }
        const startSec = Math.max(0, Number(body.startSec ?? 0) || 0);
        const plan = resolvePlaybackPlan(media, {
          audioStreamIndex: body.audioStreamIndex,
          subtitleId: body.subtitleId,
          startSec
        });
        const streamUrl =
          plan.mode === "direct-play"
            ? `${getBaseUrl()}/media/${encodeURIComponent(media.id)}/direct.mp4`
            : `${getBaseUrl()}/media/${encodeURIComponent(media.id)}/remux.mp4?${new URLSearchParams(
                {
                  ...(plan.audioStreamIndex !== null
                    ? { audio: String(plan.audioStreamIndex) }
                    : {}),
                  ...(startSec > 0 ? { start: String(Math.floor(startSec)) } : {})
                }
              ).toString()}`;
        const subOffsetQuery =
          plan.mode === "remux-stream" && startSec > 0 ? `?start=${Math.floor(startSec)}` : "";
        const subUrl = body.subtitleId
          ? `${getBaseUrl()}/subtitles/${encodeURIComponent(media.id)}/${encodeURIComponent(
              body.subtitleId
            )}.vtt${subOffsetQuery}`
          : null;
        const result = await castToGoogleCastTv(
          targetIp,
          streamUrl,
          media.title,
          plan.mimeType,
          subUrl,
          plan.mode === "direct-play" ? startSec : 0,
          lan
        );
        sendJson(res, result.ok ? 200 : result.status || 502, {
          ...result,
          error: result.ok ? undefined : result.detail
        });
        return;
      }

      if (method === "POST" && pathname === "/api/tv/cast/control") {
        const body = await readJsonBody<{
          tvId?: string | null;
          ip?: string;
          action?:
            | "PLAY"
            | "PAUSE"
            | "STOP"
            | "SEEK"
            | "SUBTITLE_ON"
            | "SUBTITLE_OFF"
            | "VOLUME";
          value?: number;
        }>(req);
        if (!body.action) {
          sendJson(res, 400, { error: "Ação Cast ausente." });
          return;
        }
        const tv =
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "google-cast" }> =>
              t.protocol === "google-cast" && t.id === (body.tvId ?? session.selectedTvId)
          ) ??
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "google-cast" }> =>
              t.protocol === "google-cast"
          );
        const targetIp = body.ip ?? tv?.ip;
        if (!targetIp) {
          sendJson(res, 404, { error: "Nenhuma TV Google Cast encontrada na LAN." });
          return;
        }
        const result = await controlGoogleCastTv(targetIp, body.action, body.value, lan);
        sendJson(res, result.ok ? 200 : result.status || 502, {
          ...result,
          error: result.ok ? undefined : result.detail
        });
        return;
      }

      const uploadSubMatch = /^\/api\/media\/([^/]+)\/subtitles\/upload$/.exec(pathname);
      if (method === "POST" && uploadSubMatch) {
        const mediaId = safeDecodeUri(uploadSubMatch[1] ?? "") as MediaId;
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Filme não encontrado no catálogo." });
          return;
        }
        const body = await readJsonBody<{
          fileName?: string;
          content?: string;
          language?: string;
        }>(req);
        if (!body.content || typeof body.content !== "string") {
          sendJson(res, 400, { error: "Conteúdo da legenda ausente." });
          return;
        }
        const ext =
          typeof body.fileName === "string" && body.fileName.toLowerCase().endsWith(".vtt")
            ? ".vtt"
            : ".srt";
        const langSlug = (body.language ?? "pt-BR").replace(/[^a-zA-Z0-9_-]/g, "") || "pt-BR";
        const dir = path.dirname(media.filePath);
        const base = path.basename(media.filePath, path.extname(media.filePath));
        const targetSubPath = path.join(dir, `${base}.${langSlug}${ext}`);
        await fsp.writeFile(targetSubPath, body.content, "utf8");
        const updated = await probeMediaFile(media.filePath);
        catalogMap.set(updated.id, updated);
        const addedSub =
          updated.subtitleTracks.find(
            (s) => s.kind === "external" && s.filePath === targetSubPath
          ) ?? updated.subtitleTracks[updated.subtitleTracks.length - 1];
        if (addedSub) {
          session.subtitleId = addedSub.id;
          session.updatedAt = Math.floor(Date.now() / 1000);
        }
        sendJson(res, 200, {
          item: updated,
          selectedSubtitleId: addedSub?.id ?? null
        });
        return;
      }

      if (method === "POST" && pathname === "/api/tv/roku/launch") {
        const body = await readJsonBody<{
          tvId?: string | null;
          ip?: string;
          appId?: string;
          params?: Record<string, string>;
        }>(req);
        const tv =
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "roku-ecp" }> =>
              t.protocol === "roku-ecp" && t.id === (body.tvId ?? session.selectedTvId)
          ) ??
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "roku-ecp" }> => t.protocol === "roku-ecp"
          );
        const targetIp = body.ip ?? tv?.ip;
        if (!targetIp) {
          sendJson(res, 404, { error: "Nenhuma TV Roku selecionada ou descoberta na LAN." });
          return;
        }
        const result = await launchRokuApp(targetIp, body.appId ?? "2213", body.params ?? {}, lan);
        sendJson(res, result.ok ? 200 : result.status || 502, {
          ...result,
          error: result.ok ? undefined : result.detail
        });
        return;
      }

      if (method === "POST" && pathname === "/api/tv/roku/keypress") {
        const body = await readJsonBody<{
          tvId?: string | null;
          ip?: string;
          key?: string;
        }>(req);
        const tv =
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "roku-ecp" }> =>
              t.protocol === "roku-ecp" && t.id === (body.tvId ?? session.selectedTvId)
          ) ??
          discoveredTvs.find(
            (t): t is Extract<DiscoveredTv, { protocol: "roku-ecp" }> => t.protocol === "roku-ecp"
          );
        const targetIp = body.ip ?? tv?.ip;
        if (!targetIp || !body.key) {
          sendJson(res, 400, { error: "TV Roku ou tecla ausente." });
          return;
        }
        const result = await sendRokuKeypress(targetIp, body.key, lan);
        sendJson(res, result.ok ? 200 : result.status || 502, {
          ...result,
          error: result.ok ? undefined : result.detail
        });
        return;
      }

      if (method === "POST" && pathname === "/api/tv/dlna/push") {
        const body = await readJsonBody<{
          tvId?: string;
          controlUrl?: string;
          mediaId?: MediaId;
          audioStreamIndex?: number | null;
          subtitleId?: string | null;
        }>(req);
        const media = body.mediaId ? catalogMap.get(body.mediaId) : undefined;
        if (!media) {
          sendJson(res, 404, { error: "Filme não encontrado no catálogo." });
          return;
        }
        if (media.downloadStatus && !media.downloadStatus.ready) {
          sendJson(res, 409, {
            error:
              media.downloadStatus.reason ??
              "O arquivo ainda está em download e não possui cabeçalho de mídia (moov/ftyp)."
          });
          return;
        }
        const tv = discoveredTvs.find(
          (t): t is Extract<DiscoveredTv, { protocol: "dlna-dmr" }> =>
            t.protocol === "dlna-dmr" && t.id === (body.tvId ?? session.selectedTvId)
        );
        const controlUrl = body.controlUrl ?? tv?.avTransportControlUrl;
        if (!controlUrl) {
          sendJson(res, 400, { error: "Renderizador DLNA DMR sem AVTransport controlURL." });
          return;
        }
        const plan = resolvePlaybackPlan(media, {
          audioStreamIndex: body.audioStreamIndex,
          subtitleId: body.subtitleId
        });
        const streamUrl =
          plan.mode === "direct-play"
            ? `${getBaseUrl()}/media/${encodeURIComponent(media.id)}/direct.mp4`
            : `${getBaseUrl()}/media/${encodeURIComponent(media.id)}/remux.mp4${
                plan.audioStreamIndex !== null ? `?audio=${plan.audioStreamIndex}` : ""
              }`;
        const subUrl = body.subtitleId
          ? `${getBaseUrl()}/subtitles/${encodeURIComponent(media.id)}/${encodeURIComponent(body.subtitleId)}.srt`
          : null;
        const result = await pushToDlnaRenderer(
          controlUrl,
          streamUrl,
          media.title,
          plan.mimeType,
          subUrl,
          lan
        );
        sendJson(res, result.ok ? 200 : result.status || 502, {
          ...result,
          error: result.ok ? undefined : result.detail
        });
        return;
      }

      const streamMatch = /^\/stream\/([^/]+)$/.exec(pathname);
      if ((method === "GET" || method === "HEAD") && streamMatch) {
        const mediaId = safeDecodeUri(streamMatch[1] ?? "") as MediaId;
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Media not found" });
          return;
        }
        const audioStreamIndex = parseOptionalInt(reqUrl.searchParams.get("audio"));
        const startSec = parseStartSec(reqUrl.searchParams.get("start"));
        const forceRemux = reqUrl.searchParams.get("forceRemux") === "1";
        const outputContainer =
          reqUrl.searchParams.get("container") === "mpegts" ? "mpegts" : "fmp4";
        const plan = resolvePlaybackPlan(media, {
          audioStreamIndex,
          startSec,
          forceRemux,
          outputContainer
        });
        if (plan.mode === "direct-play") {
          serveDirectPlay(req, res, media);
        } else {
          serveRemuxStream(req, res, plan);
        }
        return;
      }

      const directMatch = /^\/media\/([^/]+)\/direct\.mp4$/.exec(pathname);
      if ((method === "GET" || method === "HEAD") && directMatch) {
        const mediaId = safeDecodeUri(directMatch[1] ?? "") as MediaId;
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Media not found" });
          return;
        }
        serveDirectPlay(req, res, media);
        return;
      }

      const remuxMatch = /^\/media\/([^/]+)\/remux\.mp4$/.exec(pathname);
      if ((method === "GET" || method === "HEAD") && remuxMatch) {
        const mediaId = safeDecodeUri(remuxMatch[1] ?? "") as MediaId;
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Media not found" });
          return;
        }
        const audioStreamIndex = parseOptionalInt(reqUrl.searchParams.get("audio"));
        const startSec = parseStartSec(reqUrl.searchParams.get("start"));
        const outputContainer =
          reqUrl.searchParams.get("container") === "mpegts" ? "mpegts" : "fmp4";
        const plan = resolvePlaybackPlan(media, {
          audioStreamIndex,
          startSec,
          forceRemux: true,
          outputContainer
        });
        if (plan.mode === "remux-stream") {
          serveRemuxStream(req, res, plan);
        } else {
          serveDirectPlay(req, res, media);
        }
        return;
      }

      const hlsMasterMatch = /^\/media\/([^/]+)\/hls\/master\.m3u8$/.exec(pathname);
      if ((method === "GET" || method === "HEAD") && hlsMasterMatch) {
        const mediaId = safeDecodeUri(hlsMasterMatch[1] ?? "") as MediaId;
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Media not found" });
          return;
        }
        const audioStreamIndex = parseOptionalInt(reqUrl.searchParams.get("audio"));
        const m3u8 = buildHlsPlaylist(
          media,
          `${getBaseUrl()}/media/${encodeURIComponent(media.id)}/hls`,
          audioStreamIndex
        );
        res.writeHead(200, {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Content-Length": Buffer.byteLength(m3u8),
          "Cache-Control": "no-store"
        });
        res.end(method === "HEAD" ? undefined : m3u8);
        return;
      }

      const hlsSegMatch = /^\/media\/([^/]+)\/hls\/(?:seg_)?(\d+)\.ts$/.exec(pathname);
      if ((method === "GET" || method === "HEAD") && hlsSegMatch) {
        const mediaId = safeDecodeUri(hlsSegMatch[1] ?? "") as MediaId;
        const segIdx = Number(hlsSegMatch[2]);
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Media not found" });
          return;
        }
        const audioStreamIndex = parseOptionalInt(reqUrl.searchParams.get("audio"));
        serveHlsSegment(req, res, media, segIdx, audioStreamIndex);
        return;
      }

      const subMatch =
        /^\/subtitles\/([^/]+)\/([^/]+)$/.exec(pathname) ??
        /^\/media\/([^/]+)\/subtitles\/([^/]+)$/.exec(pathname);
      if ((method === "GET" || method === "HEAD") && subMatch) {
        const mediaId = safeDecodeUri(subMatch[1] ?? "") as MediaId;
        const rawFile = safeDecodeUri(subMatch[2] ?? "");
        const media = catalogMap.get(mediaId);
        if (!media) {
          sendJson(res, 404, { error: "Media not found" });
          return;
        }
        const isSrt = rawFile.toLowerCase().endsWith(".srt");
        const subtitleId = rawFile.replace(/\.(vtt|srt)$/i, "");
        const startSec = parseStartSec(reqUrl.searchParams.get("start"));
        try {
          const content = isSrt
            ? await extractSubtitleToSrt(media, subtitleId, startSec)
            : await extractSubtitleToWebVtt(media, subtitleId, startSec);
          res.writeHead(200, {
            "Content-Type": isSrt
              ? "application/x-subrip; charset=utf-8"
              : "text/vtt; charset=utf-8",
            "Content-Length": Buffer.byteLength(content),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
          });
          res.end(method === "HEAD" ? undefined : content);
        } catch {
          sendJson(res, 404, { error: "Subtitle track not found" });
        }
        return;
      }

      if (method === "GET" && pathname === "/dlna/device.xml") {
        sendXml(res, 200, buildDlnaDeviceXml(getBaseUrl()));
        return;
      }

      if (
        method === "GET" &&
        (pathname === "/dlna/content-directory.xml" ||
          pathname === "/dlna/content-directory/scpd.xml")
      ) {
        sendXml(res, 200, buildContentDirectoryScpdXml());
        return;
      }

      if (
        method === "GET" &&
        (pathname === "/dlna/connection-manager.xml" ||
          pathname === "/dlna/connection-manager/scpd.xml")
      ) {
        sendXml(res, 200, buildConnectionManagerScpdXml());
        return;
      }

      if (method === "POST" && pathname === "/dlna/content-directory/control") {
        const body = await readRequestBody(req);
        const soapAction =
          typeof req.headers.soapaction === "string" ? req.headers.soapaction : undefined;
        const result = handleContentDirectorySoap(
          soapAction,
          body,
          getCatalog(),
          session,
          getBaseUrl()
        );
        sendXml(res, result.status, result.xml);
        return;
      }

      if (method === "POST" && pathname === "/dlna/connection-manager/control") {
        const body = await readRequestBody(req);
        const result = handleConnectionManagerSoap(body);
        sendXml(res, result.status, result.xml);
        return;
      }

      sendJson(res, 404, { error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      if (err instanceof BadRequestError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      sendJson(res, 500, { error: "Internal server error" });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const clientIp = extractIp(req);
    if (
      !isIpInLanSubnet(clientIp, lan, allowLoopback) ||
      !isAllowedHostHeader(req.headers.host, lan, bindHost, allowLoopback) ||
      !isAllowedOriginHeader(req.headers.origin, lan, bindHost, allowLoopback)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const reqUrl = new URL(req.url ?? "/", getBaseUrl());
    if (reqUrl.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, bindHost, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      if (addr && typeof addr === "object") {
        activePort = addr.port;
      }
      resolve();
    });
  });

  const ssdpAnnouncer =
    options.enableSsdpAnnouncer !== false
      ? startSsdpMediaServerAnnouncer(lan, activePort)
      : null;

  server.once("close", () => {
    ssdpAnnouncer?.stop();
  });

  return {
    server,
    lan,
    bindHost,
    port: activePort,
    get baseUrl() {
      return getBaseUrl();
    },
    getCatalog,
    setCatalog(items: readonly MediaItem[]) {
      catalogMap.clear();
      for (const item of items) catalogMap.set(item.id, item);
      if (items[0] && (!session.mediaId || !catalogMap.has(session.mediaId))) {
        session.mediaId = items[0].id;
        session.audioStreamIndex = items[0].audioTracks[0]?.streamIndex ?? null;
        session.subtitleId = items[0].subtitleTracks[0]?.id ?? null;
      }
      session.updatedAt = Math.floor(Date.now() / 1000);
    },
    getSession() {
      return session;
    },
    getDiscoveredTvs() {
      return discoveredTvs;
    },
    setDiscoveredTvs(tvs: readonly DiscoveredTv[]) {
      discoveredTvs = [...tvs];
    },
    async close() {
      ssdpAnnouncer?.stop();
      killActiveMediaProcesses();
      for (const client of wsClients) {
        try {
          client.terminate();
        } catch {
          continue;
        }
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
