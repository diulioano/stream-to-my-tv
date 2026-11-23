import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { cp, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import jsQR from "jsqr";
import { isRfc1918PrivateIp } from "../src/network";
import { buildSidecar } from "./build-sidecar";

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "scratch", "sidecar-dist");
const seaName = "stream-to-my-tv-sea.exe";
const bundleName = "server-bundle.cjs";
const samples = path.join(root, "media-samples");
const options = ["A", "B", "Baseline"] as const;
type Option = typeof options[number];

export async function ensureSidecarBuilt(): Promise<void> {
  const required = [
    path.join(dist, bundleName),
    path.join(dist, seaName),
    path.join(dist, "node.exe"),
    path.join(dist, "bin", "ffmpeg.exe"),
    path.join(dist, "bin", "ffprobe.exe")
  ];
  if (required.some((p) => !fs.existsSync(p))) {
    await buildSidecar();
  }
}

export async function withSidecarStage<T>(run: (stage: string) => Promise<T>): Promise<T> {
  await ensureSidecarBuilt();
  const stage = await mkdtemp(path.join(tmpdir(), "stream-sidecar-"));
  try {
    assert.ok(path.relative(root, stage).startsWith(".."), "The stage must be outside the repository");
    await Promise.all(["bin", bundleName, seaName, "node.exe"].map((file) =>
      cp(path.join(dist, file), path.join(stage, file), { recursive: true })
    ));
    return await run(stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export function startSidecar(stage: string, option: Option, args: string[]) {
  const [command, ...entry] = {
    A: [path.join(stage, "node.exe"), path.join(stage, bundleName)],
    B: [path.join(stage, seaName)],
    Baseline: [process.execPath, require.resolve("tsx/cli"), path.join(root, "src", "index.ts")]
  }[option];
  assert.ok(command);
  const env = {
    ...process.env,
    NODE_PATH: undefined,
    NODE_OPTIONS: undefined,
    FRONTEND_DIST_DIR: undefined,
    LAN_IP: undefined,
    FFMPEG_PATH: path.join(stage, "bin", "ffmpeg.exe"),
    FFPROBE_PATH: path.join(stage, "bin", "ffprobe.exe")
  };
  const started = performance.now();
  const child = spawn(command, [...entry, "--port", "0", "--watch-stdin", "--bind", "0.0.0.0",
    "--allow-loopback", ...args], { cwd: stage, env, windowsHide: true });
  const exited = once(child, "exit").then(([code]) => code);
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const listening = new Promise<{ origin: string; listeningMs: number }>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const port = /^Painel Local\s+: http:\/\/localhost:(\d+)\/$/.exec(line)?.[1];
      if (port) resolve({ origin: `http://127.0.0.1:${port}`, listeningMs: performance.now() - started });
    });
    exited.then(
      (code) => reject(new Error(`${option} exited before listening (${code}): ${stderr}`)),
      reject
    );
  });
  const ready = async () => {
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const { origin, listeningMs } = await listening;
      const response = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(5_000) });
      const coldStartMs = performance.now() - started;
      assert.equal(response.status, 200, "GET /api/status");
      const status: unknown = await response.json();
      assert.ok(status && typeof status === "object" && "ok" in status && status.ok === true &&
        "pid" in status && typeof status.pid === "number" && Number.isSafeInteger(status.pid) &&
        "baseUrl" in status && typeof status.baseUrl === "string" &&
        "port" in status && typeof status.port === "number" &&
        "catalogCount" in status && typeof status.catalogCount === "number");
      return { origin, listeningMs, coldStartMs, status: {
        pid: status.pid, port: status.port, baseUrl: status.baseUrl, catalogCount: status.catalogCount
      } };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    ready,
    async close() {
      const timeout = setTimeout(() => child.kill(), 5_000);
      const started = performance.now();
      child.stdin.end();
      try {
        assert.equal(await exited, 0, stderr);
        return performance.now() - started;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function decodeQrSvg(svg: string): string | undefined {
  const side = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  assert.ok(side >= 21 && side <= 200, "Expected a valid QR SVG viewBox");
  const pathData = /<path[^>]* d="([^"]+)"/.exec(svg)?.[1];
  assert.ok(pathData, "QR SVG module path is missing");
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, start, row, width] of pathData.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let x = Number(start); x < Number(start) + Number(width); x++) {
      const index = 4 * (Number(row) * side + x);
      pixels.fill(0, index, index + 3);
    }
  }
  return jsQR(pixels, side, side, { inversionAttempts: "dontInvert" })?.data;
}

export function windowsPowerShell(script: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", timeout: 10_000, windowsHide: true
  }).trim();
}

function processSample(pid: number) {
  const [workingSetBytes, cpuMs] = windowsPowerShell(
    `$p = Get-Process -Id ${pid} -ErrorAction Stop; "$($p.WorkingSet64) $($p.TotalProcessorTime.TotalMilliseconds)"`
  ).split(" ").map(Number);
  assert.ok(workingSetBytes && Number.isFinite(workingSetBytes));
  assert.ok(typeof cpuMs === "number" && Number.isFinite(cpuMs));
  return { workingSetBytes, cpuMs };
}

async function bytes(file: string): Promise<number> {
  const info = await stat(file);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(file)) total += await bytes(path.join(file, entry));
  return total;
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
}

type Run = {
  option: Option;
  round: number;
  coldStartMs: number;
  listeningMs: number;
  shutdownMs: number;
  workingSetBytes: number;
  baseUrl: string;
  errors: string[];
};

async function benchmark(stage: string) {
  const mediaBinariesBytes = await bytes(path.join(stage, "bin"));
  const nodeBytes = await bytes(path.join(stage, "node.exe"));
  const bundleBytes = await bytes(path.join(stage, bundleName));
  const seaBytes = await bytes(path.join(stage, seaName));
  const sourceBytes = await bytes(path.join(root, "src"));
  const baselineTreeBytes = nodeBytes + sourceBytes +
    await bytes(path.join(root, "node_modules")) +
    await bytes(path.join(root, "package.json")) +
    await bytes(path.join(root, "package-lock.json"));
  const runs: Run[] = [];
  const launchFailures: { option: Option; round: number; error: string }[] = [];
  for (let round = 1; round <= 5; round++) {
    for (const option of options) {
      const server = startSidecar(stage, option, [samples]);
      const errors: string[] = [];
      const check = async (name: string, run: () => void | Promise<void>) => {
        try {
          await run();
        } catch (error) {
          errors.push(`${name}: ${String(error)}`);
        }
      };
      try {
        const { origin, coldStartMs, listeningMs, status } = await server.ready();
        const { workingSetBytes } = processSample(status.pid);
        await check("status and LAN URL", () => {
          const url = new URL(status.baseUrl);
          assert.equal(url.protocol, "http:");
          assert.ok(isRfc1918PrivateIp(url.hostname));
          assert.equal(Number(url.port), status.port);
          assert.equal(status.catalogCount, 2);
          assert.ok(status.pid > 0);
        });
        await check("QR SVG", async () => {
          const response = await fetch(`${origin}/api/network/qr.svg`, { signal: AbortSignal.timeout(5_000) });
          assert.equal(response.status, 200);
          assert.match(response.headers.get("content-type") ?? "", /^image\/svg\+xml/);
          assert.equal(decodeQrSvg(await response.text()), `${status.baseUrl}/`);
        });
        await check("Tauri WebView CORS", async () => {
          const webviewOrigin = "http://tauri.localhost";
          const response = await fetch(`${origin}/api/session`, {
            method: "OPTIONS",
            headers: { Origin: webviewOrigin, "Access-Control-Request-Method": "POST",
              "Access-Control-Request-Headers": "content-type" },
            signal: AbortSignal.timeout(5_000)
          });
          assert.equal(response.status, 204);
          assert.equal(response.headers.get("access-control-allow-origin"), webviewOrigin);
          assert.match(response.headers.get("access-control-allow-methods") ?? "", /\bPOST\b/);
          assert.match(response.headers.get("access-control-allow-headers") ?? "", /\bcontent-type\b/i);
        });
        runs.push({ option, round, coldStartMs, listeningMs, workingSetBytes,
          shutdownMs: await server.close(), baseUrl: status.baseUrl, errors });
      } catch (error) {
        await server.close().catch(() => {});
        launchFailures.push({ option, round, error: String(error) });
      }
    }
  }

  // Keep Windows process accounting and the empty-catalog comparison outside the five trials.
  const diagnostic = [];
  if (launchFailures.length === 0) {
    for (const option of options) {
      for (const args of [[], [samples]]) {
        const server = startSidecar(stage, option, args);
        try {
          const { listeningMs, coldStartMs, status } = await server.ready();
          diagnostic.push({ option, catalogCount: status.catalogCount, listeningMs, coldStartMs,
            ...processSample(status.pid) });
        } finally {
          await server.close();
        }
      }
    }
  }
  const totals = { A: nodeBytes + bundleBytes + mediaBinariesBytes,
    B: seaBytes + mediaBinariesBytes, Baseline: baselineTreeBytes };
  const load = windowsPowerShell(
    'Get-CimInstance Win32_Processor | Select-Object NumberOfLogicalProcessors,LoadPercentage | ConvertTo-Json -Compress'
  );
  const report = {
    environment: { platform: process.platform, arch: process.arch, node: process.version,
      processorSampleAfterTrials: JSON.parse(load) },
    methodology: "Fresh process per trial, OS file cache uncontrolled. A, B and tsx CLI launch in that order each round from the same isolated temporary directory with both sample files and staged media binaries. Measure spawn to HTTP 200 response headers and stdin EOF to launcher exit code 0. Sample only the serving process Working Set after readiness. Active FFmpeg cleanup is measured separately by the lifecycle test.",
    decision: "Compare startup, shutdown, memory and disk footprint. Treat overlapping observed ranges as inconclusive for a speed ranking.",
    artifactBytes: { totals, nodeBytes, bundleBytes, seaBytes, mediaBinariesBytes,
      AWithoutNode: bundleBytes + mediaBinariesBytes, sourceBytes,
      baselineScope: "Node, src, installed node_modules and package manifests. FFmpeg and FFprobe are already inside node_modules." },
    summary: Object.fromEntries(options.map((option) => {
      const trials = runs.filter((run) => run.option === option);
      return [option, { n: trials.length, artifactBytes: totals[option],
        coldStartMs: summary(trials.map((run) => run.coldStartMs)),
        workingSetBytes: summary(trials.map((run) => run.workingSetBytes)),
        shutdownMs: summary(trials.map((run) => run.shutdownMs)),
        errorCount: trials.flatMap((run) => run.errors).length +
          launchFailures.filter((run) => run.option === option).length }];
    })),
    limiter: {
      experiment: "Separate empty and populated starts. Compare time before and after the listen announcement, and sample serving-process CPU time via Get-Process after readiness. CPU sample excludes ffprobe children and the tsx launcher.",
      analysis: "Startup is bounded by pre-listen work. createStreamServer awaits scanMediaInputs, which probes the files sequentially with FFprobe before listening. Compare each populated diagnostic to its empty run to estimate that cost and compare empty launches to isolate the runtime and loader path. HTTP readiness contributes only the difference between coldStartMs and listeningMs. Process CPU counters cannot attribute the cause of individual slow launches.",
      diagnostic
    },
    launchFailures,
    runs
  };
  await writeFile(path.join(root, "scratch", "sidecar-benchmark-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary, null, 2));
  assert.deepEqual(launchFailures, []);
  assert.deepEqual(runs.flatMap((run) => run.errors), []);
}

if (require.main === module) {
  withSidecarStage(benchmark).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
