import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http, { type IncomingMessage } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { decodeQrSvg, startSidecar, windowsPowerShell, withSidecarStage } from "../scripts/benchmark-sidecar";
import { isRfc1918PrivateIp, selectPrimaryLanInterface } from "../src/network";
import { createStreamServer } from "../src/server";

const samples = path.resolve(__dirname, "..", "media-samples");
const directFile = path.join(samples, "sample-direct-play.mp4");
const remuxFile = path.join(samples, "sample-multi-audio.mkv");

async function loadMediaIds(origin: string) {
  const response = await fetch(`${origin}/api/library`);
  assert.equal(response.status, 200);
  const library: unknown = await response.json();
  assert.ok(library && typeof library === "object" && "items" in library && Array.isArray(library.items));
  const mediaIds = new Map<string, string>();
  const items: unknown[] = library.items;
  for (const item of items) {
    assert.ok(item && typeof item === "object" && "fileName" in item && typeof item.fileName === "string" &&
      "id" in item && typeof item.id === "string" && "video" in item && item.video &&
      "durationSec" in item && typeof item.durationSec === "number" && item.durationSec > 0);
    mediaIds.set(item.fileName, encodeURIComponent(item.id));
  }
  return mediaIds;
}

function pausedHttpResponse(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.on("error", reject);
      response.pause();
      resolve(response);
    });
    request.on("error", reject);
    request.setTimeout(5_000, () => request.destroy(new Error("Timed out waiting for remux")));
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

test("Windows sidecar outside the repository", { timeout: 30_000 }, async (t) => {
  await withSidecarStage(async (stage) => {
    const longMedia = path.join(stage, "long-remux.mkv");
    const ffmpeg = path.join(stage, "bin", "ffmpeg.exe");
    const ffprobe = path.join(stage, "bin", "ffprobe.exe");
    execFileSync(ffmpeg, ["-v", "error", "-stream_loop", "31", "-i", remuxFile,
      "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", longMedia], {
      windowsHide: true, timeout: 10_000
    });
    const server = startSidecar(stage, "B", [directFile, remuxFile, longMedia]);
    let closed = false;
    try {
      const { origin, status } = await server.ready();
      assert.equal(status.catalogCount, 3);
      const mediaIds = await loadMediaIds(origin);
      const directId = mediaIds.get(path.basename(directFile));
      const remuxId = mediaIds.get(path.basename(remuxFile));
      const longId = mediaIds.get(path.basename(longMedia));
      assert.ok(directId && remuxId && longId);

      await t.test("external FFprobe catalogs media and external FFmpeg remuxes outside node_modules", async () => {
        const direct = await fetch(`${origin}/media/${directId}/direct.mp4`, {
          headers: { Range: "bytes=100-199" }, signal: AbortSignal.timeout(5_000)
        });
        assert.equal(direct.status, 206);
        assert.equal(direct.headers.get("content-range"), `bytes 100-199/${(await stat(directFile)).size}`);
        assert.deepEqual(Buffer.from(await direct.arrayBuffer()), (await readFile(directFile)).subarray(100, 200));

        const remux = await fetch(`${origin}/media/${remuxId}/remux.mp4`, { signal: AbortSignal.timeout(10_000) });
        assert.equal(remux.status, 200);
        assert.match(remux.headers.get("content-type") ?? "", /^video\/mp4/);
        const output = path.join(stage, "remux-output.mp4");
        await writeFile(output, Buffer.from(await remux.arrayBuffer()));
        const codecs = execFileSync(ffprobe, ["-v", "error", "-show_entries",
          "stream=codec_name,codec_type:format=format_name", "-of", "compact", output], {
          encoding: "utf8", windowsHide: true, timeout: 5_000
        });
        assert.match(codecs, /codec_type=video/);
        assert.match(codecs, /codec_name=aac\|codec_type=audio/);
        assert.match(codecs, /format_name=[^\r\n]*\bmp4\b/);
      });

      await t.test("Tauri WebView origins work and the QR code advertises the real LAN address", async () => {
        for (const cors of ["tauri://localhost", "http://tauri.localhost", "https://evil.example.com"]) {
          const allowed = cors !== "https://evil.example.com";
          const endpoint = `${origin}/api/session`;
          const preflight = await fetch(endpoint, { method: "OPTIONS", headers: { Origin: cors,
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
          assert.equal(preflight.status, allowed ? 204 : 403);
          assert.equal(preflight.headers.get("access-control-allow-origin"), allowed ? cors : null);
          if (allowed) {
            assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bPOST\b/);
            assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /\bcontent-type\b/i);
          }
          const post = await fetch(endpoint, { method: "POST",
            headers: { Origin: cors, "Content-Type": "application/json" }, body: "{}" });
          assert.equal(post.status, allowed ? 200 : 403);
          assert.equal(post.headers.get("access-control-allow-origin"), allowed ? cors : null);
        }

        const lan = selectPrimaryLanInterface();
        assert.ok(isRfc1918PrivateIp(lan.address));
        const lanUrl = `http://${lan.address}:${status.port}/`;
        const network = await fetch(`${origin}/api/network`);
        assert.equal(network.status, 200);
        const data: unknown = await network.json();
        assert.ok(data && typeof data === "object" && "panelUrl" in data && "qrSvgUrl" in data);
        assert.equal(data.panelUrl, lanUrl);
        assert.equal(data.qrSvgUrl, `${lanUrl}api/network/qr.svg`);
        const qr = await fetch(`${lanUrl}api/network/qr.svg`, { signal: AbortSignal.timeout(5_000) });
        assert.equal(qr.status, 200);
        assert.match(qr.headers.get("content-type") ?? "", /^image\/svg\+xml/);
        assert.equal(decodeQrSvg(await qr.text()), lanUrl);
      });

      await t.test("closing stdin terminates the active FFmpeg PID and releases the listening port", async (subtest) => {
        // Backpressure keeps the real FFmpeg process alive while Windows reports its PID.
        const response = await pausedHttpResponse(`${origin}/media/${longId}/remux.mp4`);
        try {
          assert.equal(response.statusCode, 200);
          const ffmpegPid = Number(windowsPowerShell(
            `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${status.pid} AND Name = 'ffmpeg.exe'" | Select-Object -ExpandProperty ProcessId`
          ));
          assert.ok(Number.isSafeInteger(ffmpegPid) && ffmpegPid > 0 && isProcessRunning(ffmpegPid));
          const shutdownMs = await server.close();
          closed = true;
          const deadline = performance.now() + 2_000;
          while (isProcessRunning(ffmpegPid) && performance.now() < deadline) await delay(10);
          assert.equal(isProcessRunning(ffmpegPid), false, `FFmpeg PID ${ffmpegPid} survived stdin EOF`);
          assert.equal(isProcessRunning(status.pid), false, "Sidecar PID survived stdin EOF");
          const listener = net.createServer();
          listener.listen(status.port, "0.0.0.0");
          await once(listener, "listening");
          await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
          subtest.diagnostic(`Sidecar exited in ${shutdownMs.toFixed(1)} ms with an active FFmpeg stream`);
        } finally {
          response.destroy();
        }
      });
    } finally {
      if (!closed) await server.close();
    }
  });
});

test("frontendDistDir serves SPA routes, the receiver and the API", { timeout: 15_000 }, async (t) => {
  const frontendDistDir = await mkdtemp(path.join(tmpdir(), "stream-spa-"));
  t.after(() => rm(frontendDistDir, { recursive: true, force: true }));
  const html = '<!doctype html><div id="root">Desktop SPA fixture</div>';
  await writeFile(path.join(frontendDistDir, "index.html"), html);
  const server = await createStreamServer({ frontendDistDir, lan: selectPrimaryLanInterface(),
    port: 0, bindHost: "127.0.0.1", allowLoopback: true, enableSsdpAnnouncer: false });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    for (const route of ["/", "/library/now-playing"]) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), html);
    }
    const receiver = await fetch(`${origin}/receiver`);
    assert.equal(receiver.status, 200);
    assert.match(await receiver.text(), /<title>[^<]+Web Receiver<\/title>/);
    const status = await fetch(`${origin}/api/status`);
    assert.equal(status.status, 200);
    assert.match(status.headers.get("content-type") ?? "", /^application\/json/);
    const data: unknown = await status.json();
    assert.ok(data && typeof data === "object" && "ok" in data && data.ok === true);
  } finally {
    await server.close();
  }
});
