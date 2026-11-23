import { http, HttpResponse } from "msw";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { API, server } from "../test/server";
import { TAURI_SIDECAR_BASE_URL, resolveApiBaseUrl, webSocketUrl } from "./api/baseUrl";
import { ApiError, describeError, getJson } from "./api/client";
import { formatBytes, formatTime } from "./lib/format";
import { parseServerMessage } from "./realtime/messages";

describe("resolveApiBaseUrl", () => {
  it("prefers VITE_API_BASE_URL and strips trailing slashes", () => {
    expect(resolveApiBaseUrl({ configuredBaseUrl: " http://10.0.0.5:4321/ ", isTauri: true })).toBe("http://10.0.0.5:4321");
  });

  it("targets the loopback sidecar inside Tauri", () => {
    expect(resolveApiBaseUrl({ configuredBaseUrl: undefined, isTauri: true })).toBe(TAURI_SIDECAR_BASE_URL);
    expect(TAURI_SIDECAR_BASE_URL).toBe("http://127.0.0.1:4321");
  });

  it("uses same-origin when served by the Node server", () => {
    expect(resolveApiBaseUrl({ configuredBaseUrl: "", isTauri: false })).toBe("");
  });
});

describe("webSocketUrl", () => {
  it("derives ws:// from an absolute API base", () => {
    expect(webSocketUrl("http://127.0.0.1:4321", { protocol: "tauri:", host: "localhost" })).toBe("ws://127.0.0.1:4321/ws");
  });

  it("follows the page origin when same-origin", () => {
    expect(webSocketUrl("", { protocol: "http:", host: "192.168.1.20:4321" })).toBe("ws://192.168.1.20:4321/ws");
    expect(webSocketUrl("", { protocol: "https:", host: "tv.lan" })).toBe("wss://tv.lan/ws");
  });
});

describe("API client", () => {
  const schema = z.object({ value: z.number() });

  it("surfaces the server error message and status", async () => {
    server.use(http.get(`${API}/api/thing`, () => HttpResponse.json({ error: "Scan path is restricted" }, { status: 403 })));
    const error = await getJson("/api/thing", schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "Scan path is restricted" });
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    server.use(http.get(`${API}/api/thing`, () => new HttpResponse("boom", { status: 500 })));
    await expect(getJson("/api/thing", schema)).rejects.toMatchObject({ status: 500, message: "HTTP 500" });
  });

  it("rejects 2xx responses that do not match the schema", async () => {
    server.use(http.get(`${API}/api/thing`, () => HttpResponse.json({ value: "nope" })));
    await expect(getJson("/api/thing", schema)).rejects.toThrow(/Resposta inválida de \/api\/thing/);
  });

  it("describes non-Error rejections", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError(new Error("x"))).toBe("x");
  });
});

describe("parseServerMessage", () => {
  it("parses receiver status frames and defaults missing numbers", () => {
    expect(parseServerMessage(JSON.stringify({ type: "status", state: "paused", mediaId: "m1" }))).toEqual({
      type: "status",
      state: "paused",
      mediaId: "m1",
      positionSec: 0,
      durationSec: 0
    });
  });

  it("maps unknown receiver states to idle", () => {
    expect(parseServerMessage(JSON.stringify({ type: "status", state: "buffering" }))).toMatchObject({ state: "idle" });
  });

  it("parses command frames relayed from other controllers", () => {
    expect(parseServerMessage(JSON.stringify({ type: "command", command: "seek", positionSec: 30 }))).toEqual({
      type: "command",
      command: "seek",
      positionSec: 30
    });
  });

  it("ignores malformed, unknown and non-text frames", () => {
    expect(parseServerMessage("{not json")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "command", command: "selfDestruct" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "register", role: "receiver" }))).toBeNull();
    expect(parseServerMessage(new ArrayBuffer(4))).toBeNull();
  });
});

describe("format", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
  });

  it("formats playback time", () => {
    expect(formatTime(-3)).toBe("00:00");
    expect(formatTime(65.9)).toBe("01:05");
    expect(formatTime(5400)).toBe("1:30:00");
    expect(formatTime(Number.NaN)).toBe("00:00");
  });
});
