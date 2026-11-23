/**
 * Contract between the controller shell (`controller.ts`) and the feature modules
 * (`library.ts`, `remote.ts`). Feature modules are server-side renderers that return
 * plain strings: CSS, HTML and a browser `clientScript`. The client scripts run in the
 * browser *after* the shell has created `window.__STTV` and *before* `STTV.init()`.
 *
 * Ownership (one module per file, no cross edits):
 *   - controller.ts → document skeleton, `#toast`, `window.__STTV` (state/utils/selectors/actions), boot order.
 *   - library.ts    → left/main column: scan drawer (`#scan-path`, starts empty), quick paths,
 *                     download monitor, movie list, per-media audio/subtitle pickers, subtitle upload.
 *   - remote.ts     → topbar (brand, TV quick-selector, "Parear celular" → QR modal, connection status),
 *                     right-hand remote column (TV list, cast + transport, secondary modes: Web Receiver
 *                     preview, DLNA, Roku ECP), mobile sticky Now Playing bar, mobile Remote bottom sheet,
 *                     and the QR modal (which MUST embed `ctx.qrSvg` inline, even while closed).
 *   - receiver.ts   → standalone `/receiver` page (does not use `window.__STTV`).
 *
 * Hard invariants (enforced by test/server.test.ts):
 *   - No `http://`/`https://` URL in rendered HTML except `http://www.w3.org/2000/svg` and the LAN panel origin.
 *   - No hardcoded media titles, TV names or download client names.
 *   - `<input id="scan-path" ... value="">` present in the controller HTML.
 *   - Client scripts must not contain the two-character sequence `${` (they live inside TS template literals)
 *     and must never close the script element.
 */

import type { DiscoveredTv, LanInterface, MediaItem } from "../types";
import type { IconName } from "./shared";

export interface ControllerRenderContext {
  readonly lan: LanInterface;
  readonly port: number;
  /** `http://<lan-ip>:<port>/` */
  readonly panelUrl: string;
  /** HTML-escaped `panelUrl`. */
  readonly escapedPanelUrl: string;
  /** HTML-escaped `LAN <cidr>` label. */
  readonly lanBadge: string;
  /** HTML-escaped `<iface> (<cidr>)` label. */
  readonly lanMeta: string;
  /** Inline, offline QR SVG for `panelUrl` (ECC M, quiet zone 4, #000 on #fff). */
  readonly qrSvg: string;
}

export interface UiFragment {
  readonly css: string;
  readonly html: string;
  readonly clientScript: string;
}

/** Returned by `renderLibraryFragment(ctx)`; `html` is placed in the main (left) column. */
export type LibraryFragment = UiFragment;

/** Returned by `renderRemoteFragments(ctx)`. */
export interface RemoteFragments {
  readonly css: string;
  /** Rendered as the first child of `.app` (above `.layout-grid`). */
  readonly topbarHtml: string;
  /** Rendered inside `.col-side` (right column on desktop, below the library on mobile). */
  readonly sideColumnHtml: string;
  /** Rendered after `.app`: sticky Now Playing bar, Remote bottom sheet, QR modal. */
  readonly overlaysHtml: string;
  readonly clientScript: string;
}

/* ------------------------------------------------------------------------------------------------
 * Browser runtime: `window.__STTV` (alias `STTV` inside client scripts).
 *
 * Client scripts are plain ES2017 strings; these types document the runtime shape exactly.
 * Each feature script should start with: `(function () { var STTV = window.__STTV; ... })();`
 * ---------------------------------------------------------------------------------------------- */

export interface ClientTrackChoice {
  audioStreamIndex: number | null;
  subtitleId: string | null;
}

export type ClientRemoteState = "idle" | "loading" | "playing" | "paused" | "stopped" | string;

export interface ClientNetworkState {
  panelUrl: string;
  suggestedDownloadsDir: string | null;
  lastScannedPaths: string[];
}

export interface ClientState {
  items: MediaItem[];
  libraryLoaded: boolean;
  tvs: DiscoveredTv[];
  network: ClientNetworkState;
  selectedMediaId: string | null;
  selectedTvId: string | null;
  /** Per-media audio/subtitle choice, keyed by media id. Read via `selectors.getTrackChoice`. */
  trackSelection: Record<string, ClientTrackChoice>;
  /** Start offset (s) of the currently loaded local preview stream (non-zero for remux seeks). */
  previewOffsetSec: number;
  previewLoadedMediaId: string | null;
  /** Last position/duration reported by the Web Receiver over WS (`status` messages). */
  remotePositionSec: number;
  remoteDurationSec: number;
  /** Last receiver state reported over WS, or set locally by cast controls. */
  remoteState: ClientRemoteState;
  remoteMediaId: string | null;
  remoteTitle: string | null;
  isPlaying: boolean;
  /** 0..1, last volume sent via `sendCastControl("VOLUME", v)`. */
  castVolume: number;
  isSeeking: boolean;
  ws: WebSocket | null;
  /** True while the controller WebSocket is OPEN. */
  wsConnected: boolean;
  wsReconnectTimer: number | null;
  downloadPollTimer: number | null;
  isRefreshing: boolean;
  /** Unix seconds of the last successful `/api/library/refresh` (or scan). */
  lastRefreshedAt: number | null;
}

export interface ClientUtils {
  esc(str: unknown): string;
  formatBytes(bytes: number): string;
  formatTime(sec: number): string;
  /** JSON fetch; throws `Error(data.error || data.message || "HTTP <status>")` on non-2xx. */
  apiJson<T = unknown>(url: string, options?: RequestInit): Promise<T>;
  showToast(message: string, isError?: boolean): void;
  copyText(text: string): Promise<void>;
}

export interface ClientSelectors {
  getSelectedMedia(): MediaItem | null;
  getSelectedTv(): DiscoveredTv | null;
  /** Selected TV if it is Google Cast, else the first Google Cast TV, else null. */
  getCastTargetTv(): DiscoveredTv | null;
  /** Lazily initialises a valid choice (default audio = first track, subtitle = first pt/por/br or first). */
  getTrackChoice(media: MediaItem | null): ClientTrackChoice;
  isDirectPlaySelected(media: MediaItem | null, audioStreamIndex: number | null): boolean;
  /** `/stream/<id>?audio=&start=` (relative URL). */
  buildStreamUrl(mediaId: string, audioStreamIndex: number | null, startSec?: number): string;
  /** `/subtitles/<id>/<subId>.vtt[?start=]` (relative URL), or "" when no subtitle. */
  buildSubtitleUrl(mediaId: string, subtitleId: string | null, startSec?: number): string;
}

export type ClientCastAction = "PLAY" | "PAUSE" | "STOP" | "SUBTITLE_ON" | "SUBTITLE_OFF" | "VOLUME";

export interface ClientActions {
  /** Sends JSON over the controller WS; toasts and returns false when disconnected. */
  sendWs(payload: Record<string, unknown>): boolean;
  /** GET /api/network → state.network, then hooks.renderQuickPaths() + hooks.updateRemoteUi(). */
  loadNetwork(): Promise<void>;
  /** GET /api/library → state.items (+ selection repair), then hooks.renderLibrary() + hooks.updateRemoteUi(). */
  loadLibrary(): Promise<void>;
  /** POST /api/library/refresh; toasts "pronto para transmitir" when a download finishes. */
  refreshLibrary(silent?: boolean): Promise<void>;
  /** Replaces `state.items` (e.g. after a scan), repairs selection (preferring `preferredId`), re-renders library + remote. */
  setLibraryItems(items: MediaItem[], preferredId?: string | null): void;
  /** GET /api/tvs or POST /api/tvs/scan → state.tvs (+ selection repair), then hooks.renderTvs() + hooks.updateRemoteUi(). */
  loadTvs(triggerScan?: boolean): Promise<void>;
  /** Sets the selected media, re-renders library + remote (and reloads preview if open). */
  selectMedia(mediaId: string): void;
  /** Sets the selected TV, re-renders TVs + remote. */
  selectTv(tvId: string): void;
  /** POST /api/tv/cast/load for the selected media + track choice to `getCastTargetTv()`. */
  castSelectedMedia(startSec?: number): Promise<void>;
  /** POST /api/tv/cast/control; updates isPlaying / castVolume / remoteState optimistically. */
  sendCastControl(action: ClientCastAction, value?: number): Promise<void>;
}

/** Feature modules overwrite these; every hook defaults to a no-op in the shell. */
export interface ClientHooks {
  /** library.ts */
  renderLibrary(): void;
  /** library.ts */
  renderQuickPaths(): void;
  /** library.ts */
  updateDownloadMonitor(): void;
  /** library.ts */
  openScanDrawer(): void;
  /** remote.ts */
  renderTvs(): void;
  /** remote.ts — refresh cast button, transport, Now Playing bar, connection status. */
  updateRemoteUi(): void;
  /** remote.ts — local `<video>` preview (Web Receiver section). */
  loadLocalPreview(media: MediaItem | null, startSec: number, autoplay: boolean): void;
  /** remote.ts */
  applyPreviewSubtitle(media: MediaItem | null, subtitleId: string | null): void;
  /** remote.ts — current preview position in seconds (0 when no preview is open). */
  getPreviewPositionSec(): number;
  /** remote.ts */
  openRemoteSheet(): void;
  /** remote.ts */
  closeRemoteSheet(): void;
  /** remote.ts */
  openQrModal(): void;
  /** remote.ts */
  closeQrModal(): void;
}

export interface ClientRuntime {
  readonly state: ClientState;
  readonly utils: ClientUtils;
  readonly selectors: ClientSelectors;
  readonly actions: ClientActions;
  readonly hooks: ClientHooks;
  /** The `ICONS` dictionary from `./shared.ts` (inline SVG strings) for client-side rendering. */
  readonly icons: Readonly<Record<IconName, string>>;
  /** Connects WS, then loads /api/network, /api/library and /api/tvs. Called once by the shell. */
  init(): void;
}
