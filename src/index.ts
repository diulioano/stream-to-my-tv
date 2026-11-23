import fs from "node:fs";
import path from "node:path";
import { configureMediaBinaries, killActiveMediaProcesses } from "./media";
import { selectPrimaryLanInterface } from "./network";
import { createStreamServer, StreamServerInstance } from "./server";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let port = Number(process.env.PORT ?? 4321);
  let explicitIp = process.env.LAN_IP;
  let bindHost = process.env.BIND_HOST ?? "0.0.0.0";
  let ffmpegPath = process.env.FFMPEG_PATH;
  let ffprobePath = process.env.FFPROBE_PATH;
  let frontendDistDir = process.env.FRONTEND_DIST_DIR;
  const allowedScanRoots: string[] = (process.env.ALLOWED_SCAN_ROOTS ?? "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let watchStdin =
    process.env.TAURI_SIDECAR === "1" ||
    process.env.WATCH_STDIN === "1" ||
    args.includes("--watch-stdin");
  let allowLoopback =
    process.env.ALLOW_LOOPBACK !== undefined
      ? process.env.ALLOW_LOOPBACK === "true" || process.env.ALLOW_LOOPBACK === "1"
      : !args.includes("--strict") && !args.includes("--no-loopback");
  const mediaPaths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      port = Number(args[++i]);
    } else if (arg === "--ip" && args[i + 1]) {
      explicitIp = args[++i];
    } else if (arg === "--bind" && args[i + 1]) {
      bindHost = args[++i]!;
    } else if (arg === "--ffmpeg-path" && args[i + 1]) {
      ffmpegPath = args[++i];
    } else if (arg === "--ffprobe-path" && args[i + 1]) {
      ffprobePath = args[++i];
    } else if (arg === "--frontend-dist" && args[i + 1]) {
      frontendDistDir = args[++i];
    } else if (arg === "--allowed-root" && args[i + 1]) {
      allowedScanRoots.push(args[++i]!);
    } else if (arg === "--watch-stdin") {
      watchStdin = true;
    } else if (arg === "--strict" || arg === "--no-loopback") {
      allowLoopback = false;
    } else if (arg === "--allow-loopback") {
      allowLoopback = true;
    } else if (arg) {
      mediaPaths.push(arg);
    }
  }

  configureMediaBinaries({ ffmpegPath, ffprobePath });

  if (!frontendDistDir) {
    const defaultFrontendDist = path.resolve(process.cwd(), "frontend", "dist");
    if (fs.existsSync(path.join(defaultFrontendDist, "index.html"))) {
      frontendDistDir = defaultFrontendDist;
    }
  }

  if (mediaPaths.length === 0) {
    const defaultSampleDir = path.resolve(process.cwd(), "media-samples");
    if (fs.existsSync(defaultSampleDir)) {
      mediaPaths.push(defaultSampleDir);
    }
  }

  const lan = selectPrimaryLanInterface(explicitIp);
  if (args.includes("--strict")) {
    bindHost = lan.address;
  }

  let instance: StreamServerInstance | null = null;
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    killActiveMediaProcesses();
    if (instance) {
      await instance.close();
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (watchStdin) {
    process.stdin.resume();
    process.stdin.once("end", () => void shutdown());
    process.stdin.once("close", () => void shutdown());
    process.stdin.once("error", () => void shutdown());
  }

  instance = await createStreamServer({
    lan,
    bindHost,
    port,
    initialMediaPaths: mediaPaths,
    allowedScanRoots: allowedScanRoots.length > 0 ? allowedScanRoots : undefined,
    allowLoopback,
    enableSsdpAnnouncer: true,
    frontendDistDir
  });

  if (shuttingDown) {
    await instance.close();
    process.exit(0);
  }

  console.log(`=== Stream to My TV (${allowLoopback ? "LAN + Loopback" : "Strict LAN Mode"}) ===`);
  console.log(`Interface LAN : ${instance.lan.name} (${instance.lan.cidr})`);
  console.log(`Painel Web    : ${instance.baseUrl}/`);
  if (allowLoopback) {
    console.log(`Painel Local  : http://localhost:${instance.port}/`);
  }
  console.log(`QR Code SVG   : ${instance.baseUrl}/api/network/qr.svg`);
  console.log(`Web Receiver  : ${instance.baseUrl}/receiver`);
  console.log(`DLNA XML      : ${instance.baseUrl}/dlna/device.xml`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
