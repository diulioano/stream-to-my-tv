import { execFileSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { getFfmpegPath, getFfprobePath } from "../src/media";

export async function buildSidecar(): Promise<void> {
  if (process.platform !== "win32" || Number(process.versions.node.split(".")[0]) < 26) {
    throw new Error("The Windows sidecar prototype requires Node.js 26 or newer on Windows");
  }

  const root = path.resolve(__dirname, "..");
  const dist = path.join(root, "scratch", "sidecar-dist");
  const bin = path.join(dist, "bin");
  await mkdir(bin, { recursive: true });

  const bundle = path.join(dist, "server-bundle.cjs");
  await Promise.all([
    build({
      absWorkingDir: root,
      entryPoints: ["src/index.ts"],
      outfile: bundle,
      platform: "node",
      format: "cjs",
      bundle: true,
      target: "node26",
      external: ["ffmpeg-static", "ffprobe-static"],
      banner: { js: 'if (require("node:sea").isSea()) require.main = module;' }
    }),
    cp(process.execPath, path.join(dist, "node.exe")),
    cp(getFfmpegPath(), path.join(bin, "ffmpeg.exe")),
    cp(getFfprobePath(), path.join(bin, "ffprobe.exe"))
  ]);

  const config = path.join(dist, "sea-config.json");
  await writeFile(config, JSON.stringify({
    main: bundle,
    output: path.join(dist, "stream-to-my-tv-sea.exe"),
    useCodeCache: false,
    disableExperimentalSEAWarning: true
  }, null, 2) + "\n");
  execFileSync(process.execPath, ["--build-sea", config], { stdio: "inherit", windowsHide: true });
}

if (require.main === module) {
  buildSidecar().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
