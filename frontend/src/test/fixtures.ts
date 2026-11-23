import type { DiscoveredTv } from "../features/discovery/schemas/tv";
import type { MediaItem } from "../features/library/schemas/media";
import type { NetworkInfo } from "../features/network/schemas/network";
import type { Session } from "../features/player/schemas/session";

export const directMedia: MediaItem = {
  id: "m-direct",
  title: "Filme Direto",
  fileName: "filme-direto.mp4",
  filePath: "C:/Videos/filme-direto.mp4",
  container: "mp4",
  fileSize: 1_610_612_736,
  durationSec: 5400,
  video: { streamIndex: 0, codec: "h264", profile: "High", width: 1920, height: 1080, pixFmt: "yuv420p", frameRate: "24/1" },
  audioTracks: [
    { streamIndex: 1, audioOrderIndex: 0, codec: "aac", channels: 2, sampleRate: 48000, language: "por", title: "Português", isNativeTvCompatible: true },
    { streamIndex: 2, audioOrderIndex: 1, codec: "eac3", channels: 6, sampleRate: 48000, language: "eng", title: "English 5.1", isNativeTvCompatible: false }
  ],
  subtitleTracks: [{ id: "sub-pt", kind: "embedded", streamIndex: 3, codec: "subrip", language: "por", title: "Português" }],
  canDirectPlayDefault: true,
  downloadStatus: { ready: true, estimatedProgressPct: 100, reason: null }
};

export const downloadingMedia: MediaItem = {
  id: "m-remux",
  title: "Série Baixando",
  fileName: "serie.mkv",
  filePath: "C:/Downloads/serie.mkv",
  container: "mkv",
  fileSize: 734_003_200,
  durationSec: 2700,
  video: { streamIndex: 0, codec: "hevc", profile: "Main 10", width: 3840, height: 2160, pixFmt: "yuv420p10le", frameRate: "24/1" },
  audioTracks: [
    { streamIndex: 1, audioOrderIndex: 0, codec: "dts", channels: 6, sampleRate: 48000, language: "eng", title: "", isNativeTvCompatible: false }
  ],
  subtitleTracks: [],
  canDirectPlayDefault: false,
  downloadStatus: { ready: false, estimatedProgressPct: 42.4, reason: "Cabeçalho moov/ftyp ainda não gravado." }
};

export const castTv: DiscoveredTv = {
  id: "tv-cast",
  protocol: "google-cast",
  name: "Sala Chromecast",
  manufacturer: "Google",
  modelName: "Chromecast",
  softwareVersion: "1.56",
  ip: "192.168.1.40",
  port: 8009,
  locationUrl: "http://192.168.1.40:8008/ssdp/device-desc.xml",
  supportedFormats: ["video/mp4"]
};

export const dlnaTv: DiscoveredTv = {
  id: "tv-dlna",
  protocol: "dlna-dmr",
  name: "Quarto DLNA",
  manufacturer: "LG",
  modelName: "WebOS",
  ip: "192.168.1.41",
  port: 1400,
  locationUrl: "http://192.168.1.41:1400/desc.xml",
  avTransportControlUrl: "http://192.168.1.41:1400/AVTransport/control",
  connectionManagerControlUrl: null,
  supportedProtocols: ["http-get:*:video/mp4:*"]
};

export const rokuTv: DiscoveredTv = {
  id: "tv-roku",
  protocol: "roku-ecp",
  name: "Roku Cozinha",
  manufacturer: "Roku",
  modelName: "Express",
  modelNumber: "3930X",
  softwareVersion: "12.5",
  ip: "192.168.1.42",
  port: 8060,
  locationUrl: "http://192.168.1.42:8060/",
  ecpMode: "limited",
  supportsAirPlay: false,
  supportedFormats: []
};

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    mediaId: directMedia.id,
    audioStreamIndex: 1,
    subtitleId: null,
    positionSec: 120,
    playing: false,
    selectedTvId: castTv.id,
    updatedAt: 1_700_000_000,
    ...overrides
  };
}

export const network: NetworkInfo = {
  lan: { name: "Wi-Fi", address: "192.168.1.20", netmask: "255.255.255.0", cidr: "192.168.1.0/24", mac: "aa:bb:cc:dd:ee:ff", prefixLength: 24 },
  bindHost: "192.168.1.20",
  port: 4321,
  baseUrl: "http://192.168.1.20:4321",
  panelUrl: "http://192.168.1.20:4321/",
  qrSvgUrl: "http://192.168.1.20:4321/api/network/qr.svg",
  suggestedDownloadsDir: "C:/Users/me/Downloads",
  lastScannedPaths: ["D:/Filmes"]
};
