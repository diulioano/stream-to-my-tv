import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { discoverLanTvs } from "../src/discovery";
import { generateSampleMediaFile, getFfprobePath } from "../src/media";
import { selectPrimaryLanInterface } from "../src/network";
import { createStreamServer } from "../src/server";

function fetchBuffer(
  urlStr: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks)
        })
      );
    });
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const lan = selectPrimaryLanInterface();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "stream-verify-e2e-"));

  try {
    const { mkvPath, mp4Path } = await generateSampleMediaFile(tmpDir);
    const server = await createStreamServer({
      lan,
      bindHost: lan.address,
      port: 0,
      initialMediaPaths: [mkvPath, mp4Path],
      sampleDir: tmpDir,
      allowLoopback: false,
      enableSsdpAnnouncer: true
    });

    try {
      const addr = server.server.address();
      assert.ok(addr && typeof addr === "object");
      assert.equal(addr.address, lan.address);

      const catalog = server.getCatalog();
      const mp4 = catalog.find((i) => i.container === "mp4")!;
      const mkv = catalog.find((i) => i.container === "mkv")!;

      const diskMp4 = await fsp.readFile(mp4Path);
      const mid = Math.floor(diskMp4.length / 2);
      const rangeEnd = mid + 65535;
      const rangeRes = await fetchBuffer(`${server.baseUrl}/media/${mp4.id}/direct.mp4`, {
        Range: `bytes=${mid}-${rangeEnd}`
      });
      assert.equal(rangeRes.status, 206);
      const diskHash = crypto
        .createHash("sha256")
        .update(diskMp4.subarray(mid, rangeEnd + 1))
        .digest("hex");
      const httpHash = crypto.createHash("sha256").update(rangeRes.body).digest("hex");
      assert.equal(httpHash, diskHash);

      const ac3Track = mkv.audioTracks.find((a) => a.codec === "ac3")!;
      const remuxRes = await fetchBuffer(
        `${server.baseUrl}/media/${mkv.id}/remux.mp4?audio=${ac3Track.streamIndex}&start=3`
      );
      assert.equal(remuxRes.status, 200);
      const remuxFile = path.join(tmpDir, "e2e-remux.mp4");
      fs.writeFileSync(remuxFile, remuxRes.body);
      const probe = spawnSync(
        getFfprobePath(),
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", remuxFile],
        { encoding: "utf8" }
      );
      assert.equal(probe.status, 0);
      const probeJson = JSON.parse(probe.stdout);
      const outStreams = (probeJson.streams ?? []) as Array<{
        codec_type: string;
        codec_name: string;
        channels?: number;
      }>;
      const outVideo = outStreams.find((s) => s.codec_type === "video");
      const outAudio = outStreams.find((s) => s.codec_type === "audio");
      const outDuration = Number(probeJson.format?.duration ?? 0);
      assert.equal(outVideo?.codec_name, "h264");
      assert.equal(outAudio?.codec_name, "aac");
      assert.equal(outAudio?.channels, 2);
      assert.ok(outDuration >= 7.0 && outDuration <= 10.5);

      const subTrack = mkv.subtitleTracks[0]!;
      const vttRes = await fetchBuffer(
        `${server.baseUrl}/subtitles/${mkv.id}/${subTrack.id}.vtt`
      );
      assert.equal(vttRes.status, 200);
      assert.ok(vttRes.body.toString("utf8").startsWith("WEBVTT"));

      const tvs = await discoverLanTvs(lan, 2000);

      console.log(
        JSON.stringify(
          {
            verdict: "PASS",
            lanBind: `${addr.address}:${addr.port} (${lan.cidr})`,
            byteRange206: {
              range: `bytes=${mid}-${rangeEnd}/${diskMp4.length}`,
              sha256Match: httpHash === diskHash,
              sha256: httpHash
            },
            remuxSeekProbe: {
              seekStartSec: 3,
              outputDurationSec: Number(probeJson.format?.duration ?? 0),
              streams: (probeJson.streams ?? []).map(
                (s: { codec_type: string; codec_name: string; channels?: number }) => ({
                  type: s.codec_type,
                  codec: s.codec_name,
                  channels: s.channels
                })
              )
            },
            subtitleWebVtt: {
              status: vttRes.status,
              bytes: vttRes.body.length
            },
            discoveredLanTvs: tvs.map((t) => ({
              name: t.name,
              protocol: t.protocol,
              ip: t.ip,
              port: t.port,
              model: `${t.manufacturer} ${t.modelName}`
            }))
          },
          null,
          2
        )
      );
    } finally {
      await server.close();
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
