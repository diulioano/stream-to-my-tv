import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import jsQR from "jsqr";
import { WebSocket } from "ws";
import {
  generateSampleMediaFile,
  getFfprobePath,
  parseByteRange,
  probeMediaFile,
  resolvePlaybackPlan
} from "../src/media";
import {
  buildLanInterface,
  detectLanInterfaces,
  isIpInLanSubnet,
  isRfc1918PrivateIp
} from "../src/network";
import { createStreamServer, StreamServerInstance } from "../src/server";

function httpRequestBuffer(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method ?? "GET",
        headers: options.headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          })
        );
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function probeBufferViaTempFile(tmpDir: string, name: string, buf: Buffer): {
  format?: { format_name?: string; duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; channels?: number; start_time?: string }>;
} {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, buf);
  const res = spawnSync(
    getFfprobePath(),
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", p],
    { encoding: "utf8" }
  );
  assert.equal(res.status, 0, `ffprobe failed on ${name}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test("LAN detection filters out WSL/Hyper-V/Docker/APIPA and enforces RFC 1918 CIDR boundaries", () => {
  const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
    "vEthernet (WSL (Hyper-V firewall))": [
      {
        address: "172.24.192.1",
        netmask: "255.255.240.0",
        family: "IPv4",
        mac: "00:15:5d:1c:03:f0",
        internal: false,
        cidr: "172.24.192.1/20"
      }
    ],
    "Local Area Connection* 1": [
      {
        address: "169.254.221.175",
        netmask: "255.255.0.0",
        family: "IPv4",
        mac: "52:bb:b5:18:94:da",
        internal: false,
        cidr: "169.254.221.175/16"
      }
    ],
    WiFi: [
      {
        address: "192.168.100.36",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "50:bb:b5:18:94:da",
        internal: false,
        cidr: "192.168.100.36/24"
      }
    ]
  };

  const detected = detectLanInterfaces(mockInterfaces);
  assert.equal(detected.length, 1);
  const lan = detected[0]!;
  assert.equal(lan.name, "WiFi");
  assert.equal(lan.address, "192.168.100.36");
  assert.equal(lan.cidr, "192.168.100.36/24");

  assert.equal(isIpInLanSubnet("192.168.100.31", lan, false), true);
  assert.equal(isIpInLanSubnet("::ffff:192.168.100.1", lan, false), true);
  assert.equal(isIpInLanSubnet("192.168.101.5", lan, false), false);
  assert.equal(isIpInLanSubnet("172.24.192.1", lan, false), false);
  assert.equal(isIpInLanSubnet("10.0.0.1", lan, false), false);
  assert.equal(isIpInLanSubnet("8.8.8.8", lan, false), false);
  assert.equal(isIpInLanSubnet("127.0.0.1", lan, false), false);
  assert.equal(isIpInLanSubnet("127.0.0.1", lan, true), true);
  assert.equal(isRfc1918PrivateIp("192.168.100.36"), true);
  assert.equal(isRfc1918PrivateIp("8.8.4.4"), false);
});

test("Byte-Range parser adheres to RFC 9110 for partial, open-ended, suffix, and unsatisfiable ranges", () => {
  assert.deepEqual(parseByteRange(undefined, 1000), { kind: "full", totalSize: 1000 });
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), {
    kind: "partial",
    start: 0,
    end: 99,
    contentLength: 100,
    totalSize: 1000
  });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), {
    kind: "partial",
    start: 900,
    end: 999,
    contentLength: 100,
    totalSize: 1000
  });
  assert.deepEqual(parseByteRange("bytes=-250", 1000), {
    kind: "partial",
    start: 750,
    end: 999,
    contentLength: 250,
    totalSize: 1000
  });
  assert.deepEqual(parseByteRange("bytes=1000-1050", 1000), {
    kind: "unsatisfiable",
    totalSize: 1000
  });
  assert.deepEqual(parseByteRange("bytes=500-400", 1000), {
    kind: "unsatisfiable",
    totalSize: 1000
  });
});

test("Full Streaming Server Suite: Subnet isolation, HTTP 206 SHA-256 slice verification, FFmpeg Remux & Seek verified via ffprobe, WebVTT subtitles, DLNA MediaServer, and WebSocket relay", async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "stream-to-my-tv-test-"));
  let simulatedClientIp = "192.168.100.31";
  let instance: StreamServerInstance | null = null;

  try {
    const { mkvPath, mp4Path } = await generateSampleMediaFile(tmpDir);
    const externalSrtPath = path.join(tmpDir, "sample-multi-audio.en.srt");
    await fsp.writeFile(
      externalSrtPath,
      "1\r\n00:00:01,000 --> 00:00:04,000\r\nExternal English subtitle line\r\n",
      "utf8"
    );

    const mkvItem = await probeMediaFile(mkvPath);
    const mp4Item = await probeMediaFile(mp4Path);

    assert.equal(mp4Item.canDirectPlayDefault, true);
    assert.equal(mkvItem.canDirectPlayDefault, false);
    assert.equal(mkvItem.audioTracks.length, 2);
    assert.equal(mkvItem.audioTracks[0]?.codec, "ac3");
    assert.equal(mkvItem.audioTracks[0]?.isNativeTvCompatible, false);
    assert.equal(mkvItem.audioTracks[1]?.codec, "aac");
    assert.equal(mkvItem.audioTracks[1]?.isNativeTvCompatible, true);
    assert.equal(mkvItem.subtitleTracks.length, 2);

    const directPlan = resolvePlaybackPlan(mp4Item);
    assert.equal(directPlan.mode, "direct-play");
    const remuxPlan = resolvePlaybackPlan(mkvItem, { audioStreamIndex: mkvItem.audioTracks[0]!.streamIndex });
    assert.equal(remuxPlan.mode, "remux-stream");

    const lan = buildLanInterface("WiFi", "192.168.100.36", "255.255.255.0", "50:bb:b5:18:94:da");
    instance = await createStreamServer({
      lan,
      bindHost: "127.0.0.1",
      port: 0,
      initialMediaPaths: [tmpDir],
      sampleDir: tmpDir,
      allowLoopback: false,
      enableSsdpAnnouncer: false,
      clientIpExtractor: () => simulatedClientIp
    });

    const serverOrigin = `http://127.0.0.1:${instance.port}`;

    simulatedClientIp = "8.8.8.8";
    const blockedPublic = await httpRequestBuffer(`${serverOrigin}/api/library`);
    assert.equal(blockedPublic.status, 403);

    simulatedClientIp = "172.24.192.1";
    const blockedWsl = await httpRequestBuffer(`${serverOrigin}/api/library`);
    assert.equal(blockedWsl.status, 403);

    simulatedClientIp = "192.168.100.31";
    const allowedLan = await httpRequestBuffer(`${serverOrigin}/api/library`);
    assert.equal(allowedLan.status, 200);

    const badHost = await httpRequestBuffer(`${serverOrigin}/api/library`, {
      headers: { Host: "evil.example.com:4321" }
    });
    assert.equal(badHost.status, 403);

    const badOrigin = await httpRequestBuffer(`${serverOrigin}/api/library/scan`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: tmpDir })
    });
    assert.equal(badOrigin.status, 403);

    const badContentType = await httpRequestBuffer(`${serverOrigin}/api/library/scan`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ path: tmpDir })
    });
    assert.equal(badContentType.status, 400);

    const badJson = await httpRequestBuffer(`${serverOrigin}/api/library/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad-json"
    });
    assert.equal(badJson.status, 400);

    const rawMp4Disk = await fsp.readFile(mp4Path);
    const totalSize = rawMp4Disk.length;

    const slices: Array<[number, number]> = [
      [0, 65535],
      [Math.floor(totalSize / 3), Math.floor(totalSize / 3) + 131071],
      [totalSize - 8192, totalSize - 1]
    ];

    for (const [start, end] of slices) {
      const res = await httpRequestBuffer(`${serverOrigin}/media/${mp4Item.id}/direct.mp4`, {
        headers: { Range: `bytes=${start}-${end}` }
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers["accept-ranges"], "bytes");
      assert.equal(res.headers["content-range"], `bytes ${start}-${end}/${totalSize}`);
      assert.equal(res.body.length, end - start + 1);

      const expectedHash = sha256Hex(rawMp4Disk.subarray(start, end + 1));
      const actualHash = sha256Hex(res.body);
      assert.equal(actualHash, expectedHash, `SHA-256 mismatch for range ${start}-${end}`);
    }

    const invalidRange = await httpRequestBuffer(`${serverOrigin}/media/${mp4Item.id}/direct.mp4`, {
      headers: { Range: `bytes=${totalSize + 100}-${totalSize + 500}` }
    });
    assert.equal(invalidRange.status, 416);

    const ac3StreamIdx = mkvItem.audioTracks[0]!.streamIndex;
    const seekSec = 4;
    const remuxRes = await httpRequestBuffer(
      `${serverOrigin}/media/${mkvItem.id}/remux.mp4?audio=${ac3StreamIdx}&start=${seekSec}`
    );
    assert.equal(remuxRes.status, 200);
    assert.ok(remuxRes.body.length > 50_000, "Expected non-empty fMP4 remux stream");

    const remuxProbe = probeBufferViaTempFile(tmpDir, "remux-seek-output.mp4", remuxRes.body);
    const remuxVideo = remuxProbe.streams?.find((s) => s.codec_type === "video");
    const remuxAudio = remuxProbe.streams?.find((s) => s.codec_type === "audio");
    assert.equal(remuxVideo?.codec_name, "h264");
    assert.equal(remuxAudio?.codec_name, "aac");
    assert.equal(remuxAudio?.channels, 2);
    const remuxDuration = Number(remuxProbe.format?.duration ?? 0);
    assert.ok(
      remuxDuration >= 6.5 && remuxDuration <= 9.5,
      `Expected seeked duration ~8s after start=4s on 12s video, got ${remuxDuration}s`
    );

    const hlsPlaylistRes = await httpRequestBuffer(
      `${serverOrigin}/media/${mkvItem.id}/hls/master.m3u8?audio=${ac3StreamIdx}`
    );
    assert.equal(hlsPlaylistRes.status, 200);
    const playlistText = hlsPlaylistRes.body.toString("utf8");
    assert.ok(playlistText.includes("#EXTM3U"));
    assert.ok(playlistText.includes("#EXT-X-PLAYLIST-TYPE:VOD"));
    assert.ok(playlistText.includes(`/media/${mkvItem.id}/hls/1.ts?audio=${ac3StreamIdx}`));

    const hlsSegRes = await httpRequestBuffer(
      `${serverOrigin}/media/${mkvItem.id}/hls/1.ts?audio=${ac3StreamIdx}`
    );
    assert.equal(hlsSegRes.status, 200);
    const segProbe = probeBufferViaTempFile(tmpDir, "hls-seg-1.ts", hlsSegRes.body);
    assert.equal(segProbe.streams?.find((s) => s.codec_type === "video")?.codec_name, "h264");
    assert.equal(segProbe.streams?.find((s) => s.codec_type === "audio")?.codec_name, "aac");

    const embSub = mkvItem.subtitleTracks.find((s) => s.kind === "embedded")!;
    const extSub = mkvItem.subtitleTracks.find((s) => s.kind === "external")!;

    const embVttRes = await httpRequestBuffer(
      `${serverOrigin}/subtitles/${mkvItem.id}/${embSub.id}.vtt`
    );
    assert.equal(embVttRes.status, 200);
    assert.ok(String(embVttRes.headers["content-type"]).includes("text/vtt"));
    const embVttText = embVttRes.body.toString("utf8");
    assert.ok(embVttText.startsWith("WEBVTT"));
    assert.ok(embVttText.includes("Legenda em português embutida"));

    const extVttRes = await httpRequestBuffer(
      `${serverOrigin}/subtitles/${mkvItem.id}/${extSub.id}.vtt`
    );
    assert.equal(extVttRes.status, 200);
    assert.ok(extVttRes.body.toString("utf8").includes("External English subtitle line"));

    await httpRequestBuffer(`${serverOrigin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId: mkvItem.id,
        audioStreamIndex: ac3StreamIdx,
        subtitleId: embSub.id
      })
    });

    const browseSoap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>0</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>0</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

    const dlnaBrowseRes = await httpRequestBuffer(
      `${serverOrigin}/dlna/content-directory/control`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
        },
        body: browseSoap
      }
    );
    assert.equal(dlnaBrowseRes.status, 200);
    const browseXml = dlnaBrowseRes.body.toString("utf8");
    assert.ok(browseXml.includes("[Selecionado no Painel]"));
    assert.ok(browseXml.includes("[Direct Play]"));
    assert.ok(browseXml.includes("[Remux AAC - Faixa ENG"));
    assert.ok(browseXml.includes("CaptionInfoEx"));

    const controllerWs = new WebSocket(`ws://127.0.0.1:${instance.port}/ws`);
    const receiverWs = new WebSocket(`ws://127.0.0.1:${instance.port}/ws`);
    await Promise.all([
      new Promise<void>((r) => controllerWs.once("open", () => r())),
      new Promise<void>((r) => receiverWs.once("open", () => r()))
    ]);

    const receivedCommandPromise = new Promise<Record<string, unknown>>((resolve) => {
      receiverWs.once("message", (data) => resolve(JSON.parse(String(data))));
    });

    controllerWs.send(
      JSON.stringify({
        type: "command",
        command: "seek",
        mediaId: mkvItem.id,
        positionSec: 7
      })
    );

    const receivedCmd = await receivedCommandPromise;
    assert.equal(receivedCmd.command, "seek");
    assert.equal(receivedCmd.positionSec, 7);
    assert.equal(instance.getSession().positionSec, 7);

    const statusReceivedPromise = new Promise<Record<string, unknown>>((resolve) => {
      controllerWs.once("message", (data) => resolve(JSON.parse(String(data))));
    });
    receiverWs.send(
      JSON.stringify({
        type: "status",
        state: "playing",
        positionSec: 9
      })
    );
    const statusMsg = await statusReceivedPromise;
    assert.equal(statusMsg.state, "playing");
    assert.equal(instance.getSession().positionSec, 9);
    assert.equal(instance.getSession().playing, true);

    controllerWs.close();
    receiverWs.close();

    simulatedClientIp = "8.8.8.8";
    const blockedWs = new WebSocket(`ws://127.0.0.1:${instance.port}/ws`);
    const wsErrorCode = await new Promise<string>((resolve) => {
      blockedWs.once("unexpected-response", (_req, res) => {
        resolve(`HTTP_${res.statusCode}`);
        blockedWs.terminate();
      });
      blockedWs.once("error", () => resolve("ERROR"));
    });
    assert.equal(wsErrorCode, "HTTP_403");
  } finally {
    if (instance) await instance.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

function parseAndDecodeQrSvg(svg: string): {
  decoded: string | null;
  totalModules: number;
  minQuietZone: number;
  ecc: string | null;
} {
  const vbMatch = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(vbMatch, "QR SVG must declare a square viewBox");
  const total = Number(vbMatch[1]);
  assert.equal(total, Number(vbMatch[2]), "QR SVG viewBox must be square");
  assert.ok(/<rect[^>]*fill="#ffffff"/i.test(svg), "QR SVG must include a white background rect");

  const pathMatch = /<path[^>]*fill="#000000"[^>]*d="([^"]+)"/i.exec(svg);
  assert.ok(pathMatch, "QR SVG must include a high-contrast #000000 module path");
  const d = pathMatch[1]!;

  const grid: boolean[][] = Array.from({ length: total }, () => Array<boolean>(total).fill(false));
  const tokens = d.match(/[a-zA-Z]|-?\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++]!;
    if (cmd === "M") {
      cx = Number(tokens[i++]);
      cy = Number(tokens[i++]);
    } else if (cmd === "h") {
      const dx = Number(tokens[i++]);
      if (dx > 0) {
        const y = Math.floor(cy);
        const startX = Math.floor(cx);
        for (let k = 0; k < Math.round(dx); k++) {
          grid[y]![startX + k] = true;
        }
      }
      cx += dx;
    } else if (cmd === "v") {
      cy += Number(tokens[i++]);
    }
  }

  let top = total;
  let bottom = total;
  let left = total;
  let right = total;
  for (let r = 0; r < total; r++) {
    for (let c = 0; c < total; c++) {
      if (grid[r]![c]) {
        if (r < top) top = r;
        if (total - 1 - r < bottom) bottom = total - 1 - r;
        if (c < left) left = c;
        if (total - 1 - c < right) right = total - 1 - c;
      }
    }
  }

  const scale = 8;
  const imgSize = total * scale;
  const rgba = new Uint8ClampedArray(imgSize * imgSize * 4);
  for (let y = 0; y < imgSize; y++) {
    const r = Math.floor(y / scale);
    for (let x = 0; x < imgSize; x++) {
      const c = Math.floor(x / scale);
      const val = grid[r]![c] ? 0 : 255;
      const off = (y * imgSize + x) * 4;
      rgba[off] = val;
      rgba[off + 1] = val;
      rgba[off + 2] = val;
      rgba[off + 3] = 255;
    }
  }

  const decoded = jsQR(rgba, imgSize, imgSize)?.data ?? null;
  const ecc = /data-qr-ecc="([MQ])"/.exec(svg)?.[1] ?? null;
  return { decoded, totalModules: total, minQuietZone: Math.min(top, bottom, left, right), ecc };
}

test("Offline LAN QR Code SVG decodes exact server URL, keeps >= 4 module quiet zone, and controller HTML makes zero external calls or hardcoded movie/TV references", async () => {
  const lan = buildLanInterface("WiFi", "192.168.100.36", "255.255.255.0", "50:bb:b5:18:94:da");
  const instance = await createStreamServer({
    lan,
    bindHost: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    enableSsdpAnnouncer: false
  });

  try {
    const origin = `http://127.0.0.1:${instance.port}`;
    const expectedPanelUrl = `http://${lan.address}:${instance.port}/`;

    const netRes = await httpRequestBuffer(`${origin}/api/network`);
    assert.equal(netRes.status, 200);
    const netJson = JSON.parse(netRes.body.toString("utf8")) as {
      panelUrl: string;
      qrSvgUrl: string;
      lastScannedPaths: string[];
    };
    assert.equal(netJson.panelUrl, expectedPanelUrl);
    assert.equal(netJson.qrSvgUrl, `http://${lan.address}:${instance.port}/api/network/qr.svg`);
    assert.deepEqual(netJson.lastScannedPaths, []);

    const qrMRes = await httpRequestBuffer(`${origin}/api/network/qr.svg`);
    assert.equal(qrMRes.status, 200);
    assert.ok(String(qrMRes.headers["content-type"]).includes("image/svg+xml"));
    const parsedM = parseAndDecodeQrSvg(qrMRes.body.toString("utf8"));
    assert.equal(parsedM.decoded, expectedPanelUrl);
    assert.equal(parsedM.ecc, "M");
    assert.ok(parsedM.minQuietZone >= 4, `Expected quiet zone >= 4, got ${parsedM.minQuietZone}`);

    const qrQRes = await httpRequestBuffer(`${origin}/api/network/qr.svg?ecc=Q`);
    assert.equal(qrQRes.status, 200);
    const parsedQ = parseAndDecodeQrSvg(qrQRes.body.toString("utf8"));
    assert.equal(parsedQ.decoded, expectedPanelUrl);
    assert.equal(parsedQ.ecc, "Q");
    assert.ok(parsedQ.minQuietZone >= 4, `Expected quiet zone >= 4, got ${parsedQ.minQuietZone}`);

    const htmlRes = await httpRequestBuffer(`${origin}/`);
    assert.equal(htmlRes.status, 200);
    const html = htmlRes.body.toString("utf8");
    for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.ok(script);
      assert.doesNotThrow(() => new Script(script), "Controller scripts must parse in the browser");
    }
    for (const name of ["camera", "clapper", "film"]) {
      const photo = await httpRequestBuffer(`${origin}/assets/${name}.png`);
      assert.equal(photo.status, 200);
      assert.equal(photo.headers["content-type"], "image/png");
    }

    const inlineSvgMatch = /<svg[^>]*data-qr-version="\d+"[\s\S]*?<\/svg>/.exec(html);
    assert.ok(inlineSvgMatch, "Controller HTML must embed the offline QR SVG inline");
    const parsedInline = parseAndDecodeQrSvg(inlineSvgMatch[0]);
    assert.equal(parsedInline.decoded, expectedPanelUrl);
    assert.ok(parsedInline.minQuietZone >= 4);

    assert.equal(/Resident\.Evil/i.test(html), false, "Must not hardcode movie path or title");
    assert.equal(/TV Sala/i.test(html), false, "Must not hardcode TV Sala");
    assert.equal(/Philco 4K Smart TV/i.test(html), false, "Must not hardcode Philco 4K Smart TV");
    assert.equal(/qBittorrent/i.test(html), false, "Must not hardcode download client name");
    assert.ok(/id="scan-path"[^>]*value=""/.test(html), "Scan input must start empty");

    const urlsInHtml = html.match(/https?:\/\/[^\s"'<>\\)]+/gi) ?? [];
    for (const foundUrl of urlsInHtml) {
      if (foundUrl === "http://www.w3.org/2000/svg") continue;
      assert.ok(
        foundUrl.startsWith(`http://${lan.address}:${instance.port}`),
        `Unexpected external URL in controller HTML: ${foundUrl}`
      );
    }
  } finally {
    await instance.close();
  }
});

test("Downloading movie workflow: scan detects incomplete moov/ftyp, blocks Cast with 409, and POST /api/library/refresh transitions to ready", async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "stream-download-flow-"));
  const lan = buildLanInterface("WiFi", "192.168.100.36", "255.255.255.0", "50:bb:b5:18:94:da");
  const instance = await createStreamServer({
    lan,
    bindHost: "127.0.0.1",
    port: 0,
    sampleDir: tmpDir,
    allowLoopback: true,
    enableSsdpAnnouncer: false
  });

  try {
    const origin = `http://127.0.0.1:${instance.port}`;
    const downloadDir = path.join(tmpDir, "downloads");
    await fsp.mkdir(downloadDir, { recursive: true });
    const moviePath = path.join(downloadDir, "novo-filme.mp4");

    const partialSize = 256 * 1024;
    const partialBuf = Buffer.alloc(partialSize, 0);
    partialBuf.fill(0x5a, Math.floor(partialSize * 0.2), Math.floor(partialSize * 0.6));
    await fsp.writeFile(moviePath, partialBuf);

    const scanRes = await httpRequestBuffer(`${origin}/api/library/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: downloadDir })
    });
    assert.equal(scanRes.status, 200);
    const scanData = JSON.parse(scanRes.body.toString("utf8")) as {
      items: Array<{
        id: string;
        downloadStatus?: { ready: boolean; estimatedProgressPct: number; reason: string | null };
      }>;
      lastScannedPaths: string[];
    };
    assert.equal(scanData.items.length, 1);
    const partialItem = scanData.items[0]!;
    assert.equal(partialItem.downloadStatus?.ready, false);
    assert.ok(
      partialItem.downloadStatus!.estimatedProgressPct > 0 &&
        partialItem.downloadStatus!.estimatedProgressPct < 100
    );
    assert.ok(partialItem.downloadStatus?.reason?.includes("moov/ftyp"));
    assert.ok(scanData.lastScannedPaths.includes(path.resolve(downloadDir)));

    instance.setDiscoveredTvs([
      {
        id: "cast-1",
        protocol: "google-cast",
        name: "Living Room TV",
        manufacturer: "Google Cast",
        modelName: "Smart TV",
        softwareVersion: "1.0",
        ip: "192.168.100.40" as never,
        port: 8009,
        locationUrl: "http://192.168.100.40:8008/ssdp/device-desc.xml",
        supportedFormats: ["video/mp4"]
      }
    ]);

    const castBlocked = await httpRequestBuffer(`${origin}/api/tv/cast/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tvId: "cast-1", mediaId: partialItem.id })
    });
    assert.equal(castBlocked.status, 409);
    const castBlockedJson = JSON.parse(castBlocked.body.toString("utf8")) as { error: string };
    assert.ok(castBlockedJson.error.includes("moov/ftyp"));

    const { mp4Path } = await generateSampleMediaFile(path.join(tmpDir, "samples"));
    await fsp.copyFile(mp4Path, moviePath);

    const refreshRes = await httpRequestBuffer(`${origin}/api/library/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(refreshRes.status, 200);
    const refreshData = JSON.parse(refreshRes.body.toString("utf8")) as {
      items: Array<{
        id: string;
        video: { codec: string } | null;
        audioTracks: unknown[];
        downloadStatus?: { ready: boolean; estimatedProgressPct: number; reason: string | null };
      }>;
      refreshedAt: number;
    };
    assert.equal(refreshData.items.length, 1);
    const readyItem = refreshData.items[0]!;
    assert.equal(readyItem.id, partialItem.id);
    assert.equal(readyItem.downloadStatus?.ready, true);
    assert.equal(readyItem.downloadStatus?.estimatedProgressPct, 100);
    assert.equal(readyItem.video?.codec, "h264");
    assert.ok(readyItem.audioTracks.length > 0);
    assert.ok(refreshData.refreshedAt > 0);
  } finally {
    await instance.close();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
