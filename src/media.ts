import { ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AudioTrack, MediaId, MediaItem, PlaybackPlan, SubtitleTrack, VideoTrack } from "./types";

const MEDIA_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi"]);
const TEXT_SUBTITLE_CODECS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text"]);
const NATIVE_AUDIO_CODECS = ["aac", "mp3"];
const AUDIO_ARGS = ["-c:a", "aac", "-ac", "2", "-b:a", "192k"];
const DLNA_HEADERS: Record<string, string> = {
  "Accept-Ranges": "bytes",
  "transferMode.dlna.org": "Streaming",
  "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
  "Cache-Control": "no-store",
};

export interface MediaBinaryConfig {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
}

let configuredBinaries: MediaBinaryConfig = {};
const activeMediaProcesses = new Set<ChildProcess>();

export function configureMediaBinaries(config: MediaBinaryConfig): void {
  configuredBinaries = { ...config };
}

export function trackMediaProcess<T extends ChildProcess>(child: T): T {
  activeMediaProcesses.add(child);
  const cleanup = (): void => {
    activeMediaProcesses.delete(child);
  };
  child.once("close", cleanup);
  child.once("error", cleanup);
  return child;
}

export function getActiveMediaProcessCount(): number {
  return activeMediaProcesses.size;
}

export function killActiveMediaProcesses(): number {
  let terminated = 0;
  for (const child of activeMediaProcesses) {
    activeMediaProcesses.delete(child);
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGKILL");
        terminated++;
      } catch {
        // Ignore already-exited child processes
      }
    }
  }
  return terminated;
}

function resolveSiblingBinary(binaryName: string): string | null {
  const exeName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
  const candidate = path.join(path.dirname(process.execPath), exeName);
  return fs.existsSync(candidate) ? candidate : null;
}

export function getFfmpegPath(): string {
  const override = configuredBinaries.ffmpegPath ?? process.env.FFMPEG_PATH;
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  const sibling = resolveSiblingBinary("ffmpeg");
  if (sibling) return sibling;
  const p = require("ffmpeg-static") as string | null;
  if (!p) throw new Error("ffmpeg-static binary not available for this platform");
  return p;
}

export function getFfprobePath(): string {
  const override = configuredBinaries.ffprobePath ?? process.env.FFPROBE_PATH;
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  const sibling = resolveSiblingBinary("ffprobe");
  if (sibling) return sibling;
  return (require("ffprobe-static") as { path: string }).path;
}

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  tags?: Record<string, string>;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string; format_name?: string; probe_score?: number };
}

function formatMatchesContainer(
  container: MediaItem["container"],
  formatName: string | undefined
): boolean {
  if (!formatName) return false;
  const names = formatName.toLowerCase().split(",");
  switch (container) {
    case "mp4":
    case "mov":
      return names.includes("mp4") || names.includes("mov");
    case "mkv":
    case "webm":
      return names.includes("matroska") || names.includes("webm");
    case "avi":
      return names.includes("avi");
  }
}

function runProcess(cmd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = trackMediaProcess(spawn(cmd, args, { windowsHide: true }));
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
      reject(new Error(`${path.basename(cmd)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(`${path.basename(cmd)} exited with ${code}: ${Buffer.concat(err).toString("utf8").slice(-2000)}`));
    });
  });
}

function containerOf(filePath: string): MediaItem["container"] {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (ext === "mp4" || ext === "mkv" || ext === "webm" || ext === "avi" || ext === "mov") return ext;
  if (ext === "m4v") return "mp4";
  throw new Error(`Unsupported container: ${filePath}`);
}

function tag(stream: ProbeStream, key: string): string {
  const tags = stream.tags ?? {};
  return tags[key] ?? tags[key.toUpperCase()] ?? "";
}

export function mediaIdFor(filePath: string): MediaId {
  return createHash("sha1").update(path.resolve(filePath)).digest("hex").slice(0, 12) as MediaId;
}

async function discoverExternalSubtitles(filePath: string): Promise<SubtitleTrack[]> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  return entries
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return (ext === ".srt" || ext === ".vtt") && name.startsWith(base);
    })
    .sort()
    .map((name, i): SubtitleTrack => {
      const ext = path.extname(name).toLowerCase();
      const middle = name.slice(base.length, name.length - ext.length).replace(/^[.\-_ ]+/, "");
      return {
        id: `ext-${i}`,
        kind: "external",
        filePath: path.join(dir, name),
        format: ext === ".vtt" ? "vtt" : "srt",
        language: middle.split(".")[0] || "und",
        title: middle || name,
      };
    });
}

async function estimateSparseFileProgressPct(filePath: string, fileSize: number): Promise<number> {
  if (fileSize <= 0) return 0;
  let fd: fsp.FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, "r");
    const samples = 50;
    const buf = Buffer.alloc(4096);
    let nonZero = 0;
    for (let i = 0; i < samples; i++) {
      const pos = Math.floor(((fileSize - Math.min(fileSize, 4096)) * i) / samples);
      const { bytesRead } = await fd.read(buf, 0, Math.min(4096, fileSize - pos), pos);
      for (let j = 0; j < bytesRead; j++) {
        if (buf[j] !== 0) {
          nonZero++;
          break;
        }
      }
    }
    return Math.round((nonZero / samples) * 100);
  } catch {
    return 0;
  } finally {
    await fd?.close().catch(() => {});
  }
}

export async function probeMediaFile(filePath: string): Promise<MediaItem> {
  const resolved = path.resolve(filePath);
  const container = containerOf(resolved);
  const stat = await fsp.stat(resolved);
  const buildIncompleteItem = async (detail: string): Promise<MediaItem> => {
    const pct = await estimateSparseFileProgressPct(resolved, stat.size);
    const externalSubs = await discoverExternalSubtitles(resolved);
    return {
      id: mediaIdFor(resolved),
      title: path.basename(resolved, path.extname(resolved)),
      fileName: path.basename(resolved),
      filePath: resolved,
      container,
      fileSize: stat.size,
      durationSec: 0,
      video: null,
      audioTracks: [],
      subtitleTracks: externalSubs,
      canDirectPlayDefault: false,
      downloadStatus: {
        ready: false,
        estimatedProgressPct: pct,
        reason:
          pct > 0 && pct < 100
            ? `Download incompleto (~${pct}% gravado em disco; cabeçalho moov/ftyp ainda não disponível). Ative o download sequencial (primeira e última partes primeiro) no seu cliente ou aguarde concluir.`
            : `Cabeçalho de mídia ausente ou arquivo em download (${detail.slice(0, 120)}).`
      }
    };
  };

  let json: string;
  try {
    json = await runProcess(getFfprobePath(), [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      resolved
    ]);
  } catch (err) {
    return buildIncompleteItem((err as Error).message);
  }
  const probe = JSON.parse(json) as ProbeOutput;
  if (!formatMatchesContainer(container, probe.format?.format_name)) {
    return buildIncompleteItem(
      `container .${container} sem cabeçalho válido (detectado: ${probe.format?.format_name ?? "desconhecido"})`
    );
  }
  const streams = probe.streams ?? [];

  const v = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  const video: VideoTrack | null = v
    ? {
        streamIndex: v.index,
        codec: v.codec_name ?? "unknown",
        profile: v.profile ?? "",
        width: v.width ?? 0,
        height: v.height ?? 0,
        pixFmt: v.pix_fmt ?? "",
        frameRate: v.r_frame_rate ?? "",
      }
    : null;

  const audioTracks: AudioTrack[] = streams
    .filter((s) => s.codec_type === "audio")
    .map((s, i) => {
      const codec = s.codec_name ?? "unknown";
      return {
        streamIndex: s.index,
        audioOrderIndex: i,
        codec,
        channels: s.channels ?? 0,
        sampleRate: Number(s.sample_rate ?? 0),
        language: tag(s, "language") || "und",
        title: tag(s, "title"),
        isNativeTvCompatible: NATIVE_AUDIO_CODECS.includes(codec),
      };
    });

  const embeddedSubs: SubtitleTrack[] = streams
    .filter((s) => s.codec_type === "subtitle" && TEXT_SUBTITLE_CODECS.has(s.codec_name ?? ""))
    .map((s) => ({
      id: `emb-${s.index}`,
      kind: "embedded",
      streamIndex: s.index,
      codec: s.codec_name ?? "unknown",
      language: tag(s, "language") || "und",
      title: tag(s, "title"),
    }));

  const externalSubs = await discoverExternalSubtitles(resolved);
  const firstAudio = audioTracks[0];
  const fileName = path.basename(resolved);

  return {
    id: mediaIdFor(resolved),
    title: path.basename(resolved, path.extname(resolved)),
    fileName,
    filePath: resolved,
    container,
    fileSize: stat.size,
    durationSec: Number(probe.format?.duration ?? 0) || 0,
    video,
    audioTracks,
    subtitleTracks: [...embeddedSubs, ...externalSubs],
    canDirectPlayDefault:
      (container === "mp4" || container === "webm") &&
      (video?.codec === "h264" || video?.codec === "vp9") &&
      (!firstAudio || firstAudio.isNativeTvCompatible),
    downloadStatus: {
      ready: true,
      estimatedProgressPct: 100,
      reason: null
    }
  };
}

async function collectMediaFiles(target: string, depth: number, out: Set<string>): Promise<void> {
  const stat = await fsp.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    const real = await fsp.realpath(target).catch(() => path.resolve(target));
    if (MEDIA_EXTENSIONS.has(path.extname(real).toLowerCase())) out.add(real);
    return;
  }
  if (!stat.isDirectory() || depth > 2) return;
  const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    await collectMediaFiles(path.join(target, entry.name), depth + 1, out);
  }
}

export async function scanMediaInputs(pathsOrDirs: readonly string[]): Promise<MediaItem[]> {
  const files = new Set<string>();
  for (const p of pathsOrDirs) await collectMediaFiles(path.resolve(p), 0, files);
  const items: MediaItem[] = [];
  for (const file of files) {
    try {
      items.push(await probeMediaFile(file));
    } catch (error) {
      console.warn(`Skipping ${file}: ${(error as Error).message}`);
    }
  }
  return items.sort((a, b) => a.title.localeCompare(b.title) || a.filePath.localeCompare(b.filePath));
}

export function resolvePlaybackPlan(
  media: MediaItem,
  options?: {
    audioStreamIndex?: number | null;
    subtitleId?: string | null;
    startSec?: number;
    forceRemux?: boolean;
    outputContainer?: "fmp4" | "mpegts";
  },
): PlaybackPlan {
  const requested = options?.audioStreamIndex;
  const selectedAudio =
    (requested !== undefined && requested !== null
      ? media.audioTracks.find((a) => a.streamIndex === requested)
      : undefined) ?? media.audioTracks[0];
  const subtitleId = options?.subtitleId ?? null;

  if (
    !options?.forceRemux &&
    (options?.startSec ?? 0) === 0 &&
    (media.container === "mp4" || media.container === "webm") &&
    media.video?.codec === "h264" &&
    (!selectedAudio || selectedAudio.isNativeTvCompatible) &&
    (requested === undefined || requested === null || selectedAudio?.streamIndex === media.audioTracks[0]?.streamIndex)
  ) {
    return {
      mode: "direct-play",
      media,
      mimeType: media.container === "webm" ? "video/webm" : "video/mp4",
      audioStreamIndex: selectedAudio?.streamIndex ?? null,
      subtitleId,
    };
  }

  const outputContainer = options?.outputContainer ?? "fmp4";
  return {
    mode: "remux-stream",
    media,
    outputContainer,
    mimeType: outputContainer === "mpegts" ? "video/MP2T" : "video/mp4",
    videoStreamIndex: media.video?.streamIndex ?? 0,
    audioStreamIndex: selectedAudio?.streamIndex ?? null,
    transcodeAudioToAac: selectedAudio ? !selectedAudio.isNativeTvCompatible : false,
    startSec: Math.max(0, options?.startSec ?? 0),
    subtitleId,
  };
}

export type ByteRangeResult =
  | { kind: "full"; totalSize: number }
  | { kind: "partial"; start: number; end: number; contentLength: number; totalSize: number }
  | { kind: "unsatisfiable"; totalSize: number };

export function parseByteRange(rangeHeader: string | undefined, totalSize: number): ByteRangeResult {
  if (rangeHeader === undefined || rangeHeader.trim() === "") return { kind: "full", totalSize };
  if (!/^\s*bytes\s*=/i.test(rangeHeader) || rangeHeader.includes(",")) {
    return { kind: "full", totalSize };
  }
  const unsatisfiable: ByteRangeResult = { kind: "unsatisfiable", totalSize };
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(rangeHeader);
  if (!match || totalSize <= 0) return unsatisfiable;
  const [, startStr = "", endStr = ""] = match;
  let start: number;
  let end: number;
  if (startStr === "") {
    if (endStr === "") return unsatisfiable;
    const suffix = Number(endStr);
    if (suffix <= 0) return unsatisfiable;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? totalSize - 1 : Math.min(Number(endStr), totalSize - 1);
    if (endStr !== "" && Number(endStr) < start) return unsatisfiable;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= totalSize || start > end) {
    return unsatisfiable;
  }
  return { kind: "partial", start, end, contentLength: end - start + 1, totalSize };
}

function mimeForContainer(container: MediaItem["container"]): string {
  switch (container) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    case "mov":
      return "video/quicktime";
    case "avi":
      return "video/x-msvideo";
  }
}

export function serveDirectPlay(req: IncomingMessage, res: ServerResponse, media: MediaItem): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let totalSize: number;
  try {
    totalSize = fs.statSync(media.filePath).size;
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  const headers: Record<string, string | number> = { ...DLNA_HEADERS, "Content-Type": mimeForContainer(media.container) };
  const range =
    req.method === "HEAD"
      ? ({ kind: "full", totalSize } as const)
      : parseByteRange(req.headers.range, totalSize);

  if (range.kind === "unsatisfiable") {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${totalSize}` });
    res.end();
    return;
  }

  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : totalSize - 1;
  if (range.kind === "partial") {
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Content-Length": range.contentLength,
    });
  } else {
    res.writeHead(200, { ...headers, "Content-Length": totalSize });
  }

  if (req.method === "HEAD" || totalSize === 0) {
    res.end();
    return;
  }

  const stream = fs.createReadStream(media.filePath, { start, end, highWaterMark: 256 * 1024 });
  const cleanup = (): void => {
    stream.destroy();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function pipeFfmpeg(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  args: readonly string[],
  contentType: string
): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Media file not found" }));
    return;
  }
  const responseHeaders = { ...DLNA_HEADERS, "Content-Type": contentType, "Accept-Ranges": "none" };
  if (req.method === "HEAD") {
    res.writeHead(200, responseHeaders);
    res.end();
    return;
  }
  const child = trackMediaProcess(
    spawn(getFfmpegPath(), args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
  );
  let started = false;
  const kill = (): void => {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
  };
  req.on("close", kill);
  res.on("close", kill);
  child.on("error", () => {
    if (!started && !res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "FFmpeg process failed to start" }));
    } else {
      res.destroy();
    }
  });
  child.stdout.on("error", () => kill());
  child.stdout.once("data", (firstChunk: Buffer) => {
    started = true;
    if (!res.headersSent) {
      res.writeHead(200, responseHeaders);
    }
    res.write(firstChunk);
    child.stdout.pipe(res);
  });
  child.on("close", (code) => {
    if (!started) {
      if (!res.headersSent) {
        res.writeHead(code === 0 ? 204 : 500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(code === 0 ? undefined : JSON.stringify({ error: "FFmpeg exited before producing stream output" }));
      } else {
        res.end();
      }
    }
  });
}

export function serveRemuxStream(
  req: IncomingMessage,
  res: ServerResponse,
  plan: Extract<PlaybackPlan, { mode: "remux-stream" }>,
): void {
  const args: string[] = ["-hide_banner", "-loglevel", "error"];
  if (plan.startSec > 0) args.push("-ss", String(plan.startSec));
  args.push("-i", plan.media.filePath, "-map", `0:${plan.videoStreamIndex}`);
  if (plan.audioStreamIndex !== null) args.push("-map", `0:${plan.audioStreamIndex}`);
  args.push("-c:v", "copy");
  if (plan.media.video?.codec === "hevc" && plan.outputContainer === "fmp4") {
    args.push("-tag:v", "hvc1", "-strict", "unofficial");
  }
  args.push(...AUDIO_ARGS, "-sn", "-dn", "-avoid_negative_ts", "make_zero");
  if (plan.outputContainer === "fmp4") {
    args.push("-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1");
  } else {
    args.push("-f", "mpegts", "pipe:1");
  }
  pipeFfmpeg(req, res, plan.media.filePath, args, plan.mimeType);
}

function segmentCount(media: MediaItem, segmentDurationSec: number): number {
  return Math.max(1, Math.ceil(media.durationSec / segmentDurationSec));
}

export function buildHlsPlaylist(
  media: MediaItem,
  baseUrl: string,
  audioStreamIndex: number | null,
  segmentDurationSec = 6,
): string {
  const count = segmentCount(media, segmentDurationSec);
  const base = baseUrl.replace(/\/+$/, "");
  const query = audioStreamIndex === null ? "" : `?audio=${audioStreamIndex}`;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(segmentDurationSec)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];
  for (let i = 0; i < count; i++) {
    const remaining = media.durationSec - i * segmentDurationSec;
    const dur = i === count - 1 && remaining > 0 ? Math.min(segmentDurationSec, remaining) : segmentDurationSec;
    lines.push(`#EXTINF:${dur.toFixed(3)},`, `${base}/${i}.ts${query}`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

export function serveHlsSegment(
  req: IncomingMessage,
  res: ServerResponse,
  media: MediaItem,
  segmentIndex: number,
  audioStreamIndex: number | null,
  segmentDurationSec = 6,
): void {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= segmentCount(media, segmentDurationSec)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const start = segmentIndex * segmentDurationSec;
  const args: string[] = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(start),
    "-t",
    String(segmentDurationSec),
    "-i",
    media.filePath,
    "-map",
    `0:${media.video?.streamIndex ?? 0}`,
  ];
  const audio = audioStreamIndex ?? media.audioTracks[0]?.streamIndex ?? null;
  if (audio !== null) args.push("-map", `0:${audio}`);
  args.push("-c:v", "copy", ...AUDIO_ARGS, "-sn", "-dn", "-avoid_negative_ts", "make_zero", "-output_ts_offset", String(start), "-f", "mpegts", "pipe:1");
  pipeFfmpeg(req, res, media.filePath, args, "video/MP2T");
}

function findSubtitle(media: MediaItem, subtitleId: string): SubtitleTrack {
  const track = media.subtitleTracks.find((t) => t.id === subtitleId);
  if (!track) throw new Error(`Subtitle not found: ${subtitleId}`);
  return track;
}

async function convertSubtitle(
  media: MediaItem,
  subtitleId: string,
  format: "webvtt" | "srt",
  startSec = 0
): Promise<string> {
  const track = findSubtitle(media, subtitleId);
  const args = ["-hide_banner", "-loglevel", "error"];
  if (startSec > 0) {
    args.push("-ss", String(startSec));
  }
  if (track.kind === "external") {
    if (track.format === "srt") args.push("-sub_charenc", "UTF-8");
    args.push("-i", track.filePath, "-map", "0:s:0");
  } else {
    args.push("-i", media.filePath, "-map", `0:${track.streamIndex}`);
  }
  args.push("-c:s", format === "webvtt" ? "webvtt" : "srt", "-f", format, "pipe:1");
  return (await runProcess(getFfmpegPath(), args)).replace(/^\uFEFF/, "");
}

export async function extractSubtitleToWebVtt(
  media: MediaItem,
  subtitleId: string,
  startSec = 0
): Promise<string> {
  const vtt = await convertSubtitle(media, subtitleId, "webvtt", startSec);
  return vtt.startsWith("WEBVTT") ? vtt : `WEBVTT\n\n${vtt}`;
}

export async function extractSubtitleToSrt(
  media: MediaItem,
  subtitleId: string,
  startSec = 0
): Promise<string> {
  return convertSubtitle(media, subtitleId, "srt", startSec);
}

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
Olá! Este é um vídeo de teste.

2
00:00:05,000 --> 00:00:08,000
Legenda em português embutida.

3
00:00:09,000 --> 00:00:11,500
Fim do teste.
`;

async function exists(p: string): Promise<boolean> {
  return fsp.access(p).then(
    () => true,
    () => false,
  );
}

export async function generateSampleMediaFile(targetDir: string): Promise<{ mkvPath: string; mp4Path: string }> {
  const dir = path.resolve(targetDir);
  await fsp.mkdir(dir, { recursive: true });
  const mkvPath = path.join(dir, "sample-multi-audio.mkv");
  const mp4Path = path.join(dir, "sample-direct-play.mp4");
  const ffmpeg = getFfmpegPath();

  if (!(await exists(mkvPath))) {
    const srtPath = path.join(dir, ".sample-pt.srt.tmp");
    const tmpMkv = `${mkvPath}.tmp.mkv`;
    await fsp.writeFile(srtPath, SAMPLE_SRT, "utf8");
    try {
      await runProcess(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=12",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12",
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=12",
        "-sub_charenc", "UTF-8", "-i", srtPath,
        "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "30",
        "-c:a:0", "ac3", "-b:a:0", "192k", "-ac:a:0", "2",
        "-c:a:1", "aac", "-b:a:1", "128k", "-ac:a:1", "2",
        "-c:s", "srt",
        "-metadata:s:a:0", "language=eng", "-metadata:s:a:0", "title=English (AC3)",
        "-metadata:s:a:1", "language=por", "-metadata:s:a:1", "title=Português (AAC)",
        "-metadata:s:s:0", "language=por", "-metadata:s:s:0", "title=Português",
        "-disposition:a:0", "default",
        "-shortest", tmpMkv,
      ]);
      await fsp.rename(tmpMkv, mkvPath);
    } finally {
      await fsp.rm(srtPath, { force: true });
      await fsp.rm(tmpMkv, { force: true });
    }
  }

  if (!(await exists(mp4Path))) {
    const tmpMp4 = `${mp4Path}.tmp.mp4`;
    try {
      await runProcess(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", mkvPath,
        "-map", "0:v:0", "-map", "0:a:1",
        "-c:v", "copy", "-c:a", "copy",
        "-movflags", "+faststart",
        tmpMp4,
      ]);
      await fsp.rename(tmpMp4, mp4Path);
    } finally {
      await fsp.rm(tmpMp4, { force: true });
    }
  }

  return { mkvPath, mp4Path };
}
