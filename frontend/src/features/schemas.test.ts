import { describe, expect, it } from "vitest";
import { directMedia, downloadingMedia } from "../test/fixtures";
import { discoveredTvSchema } from "./discovery/schemas/tv";
import {
  defaultTrackChoice,
  describeAudioTrack,
  describeSubtitleTrack,
  mediaItemSchema,
  playbackModeFor,
  scanFormSchema
} from "./library/schemas/media";
import { isRfc1918Cidr } from "./network/schemas/network";
import { receiverUrlFor } from "./receiver/api/receiver";

describe("playbackModeFor", () => {
  it("direct-plays the default audio of a TV-native file", () => {
    expect(playbackModeFor(directMedia, null)).toBe("direct-play");
    expect(playbackModeFor(directMedia, 1)).toBe("direct-play");
  });

  it("remuxes to AAC when the chosen audio is not TV-native", () => {
    expect(playbackModeFor(directMedia, 2)).toBe("remux-aac");
    expect(playbackModeFor(downloadingMedia, null)).toBe("remux-aac");
  });

  it("remuxes with stream copy when audio is native but the container is not", () => {
    const mkvWithAac = { ...directMedia, container: "mkv" as const, canDirectPlayDefault: false };
    expect(playbackModeFor(mkvWithAac, 1)).toBe("remux-copy");
  });
});

describe("defaultTrackChoice", () => {
  it("picks the first audio track and a Portuguese subtitle", () => {
    expect(defaultTrackChoice(directMedia)).toEqual({ audioStreamIndex: 1, subtitleId: "sub-pt" });
  });

  it("leaves subtitles off when there is no Portuguese track", () => {
    expect(defaultTrackChoice(downloadingMedia)).toEqual({ audioStreamIndex: 1, subtitleId: null });
    expect(defaultTrackChoice({ ...downloadingMedia, audioTracks: [] })).toEqual({ audioStreamIndex: null, subtitleId: null });
  });
});

describe("track descriptions", () => {
  it("falls back to language and order when titles are empty", () => {
    const [track] = downloadingMedia.audioTracks;
    expect(track && describeAudioTrack(track)).toBe("eng · DTS 6ch");
    expect(track && describeAudioTrack({ ...track, language: "" })).toBe("Faixa 1 · DTS 6ch");
    expect(
      describeSubtitleTrack({ id: "e1", kind: "external", filePath: "a.vtt", format: "vtt", language: "en", title: "" })
    ).toBe("en (VTT externo)");
  });
});

describe("scanFormSchema", () => {
  it("splits several paths on semicolons and new lines", () => {
    expect(scanFormSchema.parse({ paths: " D:/Filmes ; E:/Series\nF:/x " })).toEqual({ paths: ["D:/Filmes", "E:/Series", "F:/x"] });
  });

  it("rejects blank input", () => {
    expect(scanFormSchema.safeParse({ paths: " ; " }).success).toBe(false);
  });
});

describe("API response schemas", () => {
  it("rejects a media item with an unknown container", () => {
    expect(mediaItemSchema.safeParse({ ...directMedia, container: "flv" }).success).toBe(false);
  });

  it("rejects a TV with an unknown protocol", () => {
    expect(discoveredTvSchema.safeParse({ id: "x", protocol: "airplay", name: "x" }).success).toBe(false);
  });
});

describe("isRfc1918Cidr", () => {
  it.each([
    ["192.168.1.0/24", true],
    ["10.0.0.0/8", true],
    ["172.20.0.0/16", true],
    ["172.32.0.0/16", false],
    ["8.8.8.0/24", false],
    ["10.0.0.0/7", false],
    ["192.168.1.0", false],
    ["300.1.1.0/24", false]
  ])("%s → %s", (cidr, expected) => {
    expect(isRfc1918Cidr(cidr)).toBe(expected);
  });
});

describe("receiverUrlFor", () => {
  it("resolves /receiver against the LAN panel URL", () => {
    expect(receiverUrlFor("http://192.168.1.20:4321/")).toBe("http://192.168.1.20:4321/receiver");
  });
});
