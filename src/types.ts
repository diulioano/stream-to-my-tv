export type Brand<T, B extends string> = T & { readonly __brand: B };

export type IpV4Address = Brand<string, "IpV4Address">;
export type MediaId = Brand<string, "MediaId">;

export interface LanInterface {
  readonly name: string;
  readonly address: IpV4Address;
  readonly netmask: string;
  readonly cidr: string;
  readonly mac: string;
  readonly prefixLength: number;
  readonly subnetBaseInt: number;
  readonly subnetMaskInt: number;
}

export interface VideoTrack {
  readonly streamIndex: number;
  readonly codec: string;
  readonly profile: string;
  readonly width: number;
  readonly height: number;
  readonly pixFmt: string;
  readonly frameRate: string;
}

export interface AudioTrack {
  readonly streamIndex: number;
  readonly audioOrderIndex: number;
  readonly codec: string;
  readonly channels: number;
  readonly sampleRate: number;
  readonly language: string;
  readonly title: string;
  readonly isNativeTvCompatible: boolean;
}

export type SubtitleTrack =
  | {
      readonly id: string;
      readonly kind: "embedded";
      readonly streamIndex: number;
      readonly codec: string;
      readonly language: string;
      readonly title: string;
    }
  | {
      readonly id: string;
      readonly kind: "external";
      readonly filePath: string;
      readonly format: "srt" | "vtt";
      readonly language: string;
      readonly title: string;
    };

export interface MediaDownloadStatus {
  readonly ready: boolean;
  readonly estimatedProgressPct: number;
  readonly reason: string | null;
}

export interface MediaItem {
  readonly id: MediaId;
  readonly title: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly container: "mp4" | "mkv" | "webm" | "avi" | "mov";
  readonly fileSize: number;
  readonly durationSec: number;
  readonly video: VideoTrack | null;
  readonly audioTracks: readonly AudioTrack[];
  readonly subtitleTracks: readonly SubtitleTrack[];
  readonly canDirectPlayDefault: boolean;
  readonly downloadStatus?: MediaDownloadStatus;
}

export type PlaybackPlan =
  | {
      readonly mode: "direct-play";
      readonly media: MediaItem;
      readonly mimeType: "video/mp4" | "video/webm";
      readonly audioStreamIndex: number | null;
      readonly subtitleId: string | null;
    }
  | {
      readonly mode: "remux-stream";
      readonly media: MediaItem;
      readonly outputContainer: "fmp4" | "mpegts";
      readonly mimeType: "video/mp4" | "video/MP2T";
      readonly videoStreamIndex: number;
      readonly audioStreamIndex: number | null;
      readonly transcodeAudioToAac: boolean;
      readonly startSec: number;
      readonly subtitleId: string | null;
    };

export type DiscoveredTv =
  | {
      readonly id: string;
      readonly protocol: "google-cast";
      readonly name: string;
      readonly manufacturer: string;
      readonly modelName: string;
      readonly softwareVersion: string;
      readonly ip: IpV4Address;
      readonly port: number;
      readonly locationUrl: string;
      readonly supportedFormats: readonly string[];
    }
  | {
      readonly id: string;
      readonly protocol: "roku-ecp";
      readonly name: string;
      readonly manufacturer: string;
      readonly modelName: string;
      readonly modelNumber: string;
      readonly softwareVersion: string;
      readonly ip: IpV4Address;
      readonly port: number;
      readonly locationUrl: string;
      readonly ecpMode: "limited" | "permissive" | "unknown";
      readonly supportsAirPlay: boolean;
      readonly supportedFormats: readonly string[];
    }
  | {
      readonly id: string;
      readonly protocol: "dlna-dmr";
      readonly name: string;
      readonly manufacturer: string;
      readonly modelName: string;
      readonly ip: IpV4Address;
      readonly port: number;
      readonly locationUrl: string;
      readonly avTransportControlUrl: string | null;
      readonly connectionManagerControlUrl: string | null;
      readonly supportedProtocols: readonly string[];
    };

export interface ActiveSessionState {
  mediaId: MediaId | null;
  audioStreamIndex: number | null;
  subtitleId: string | null;
  positionSec: number;
  playing: boolean;
  selectedTvId: string | null;
  updatedAt: number;
}
