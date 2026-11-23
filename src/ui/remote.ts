import type { ControllerRenderContext, RemoteFragments } from "./contract";
import { ICONS } from "./shared";
import { SEEK_QUEUE_JS, SKIP_BACK_SEC, SKIP_FORWARD_SEC } from "./seek-queue";

/**
 * Remote & TVs — P1 Cinema Obsidian.
 * Owner: Remote lane. Implements hooks: renderTvs, updateRemoteUi, loadLocalPreview, applyPreviewSubtitle,
 * getPreviewPositionSec, openRemoteSheet, closeRemoteSheet, openQrModal, closeQrModal.
 *
 * Protocol-specific controls are rendered twice (side panel + mobile sheet) and always stay mounted; the
 * client script toggles `[data-ctx]` containers by the selected TV's protocol. Only the side-panel copy
 * carries element ids, the sheet copy is driven by the same `data-*` attributes through event delegation.
 */

type ControlVariant = "panel" | "sheet";

const VOLUME_PRESETS: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
  { label: "Mudo", value: "0" },
  { label: "30%", value: "0.3" },
  { label: "60%", value: "0.6" },
  { label: "85%", value: "0.85" }
];

const ROKU_SETTINGS_PATH =
  "Configurações &gt; Sistema &gt; Configurações avançadas do sistema &gt; Controle por aplicativos móveis &gt; Acesso à rede &gt; Permissivo";

const REMOTE_CSS = `
    /* ---------- Topbar ---------- */
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 0 1 auto; }
    .brand-mark {
      width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: 0 0 auto;
      background: linear-gradient(145deg, var(--accent-hover), var(--accent)); color: var(--accent-fg);
      box-shadow: 0 6px 18px rgba(245, 158, 11, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.35);
    }
    .brand-text { min-width: 0; }
    .brand h1 { font-size: 17px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.25; }
    .brand-url { color: var(--muted); font-family: var(--mono); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .tv-pill-wrap { position: relative; display: flex; align-items: center; min-width: 0; }
    .tv-pill-wrap > .icon { position: absolute; left: 13px; width: 18px; height: 18px; color: var(--muted); pointer-events: none; }
    .tv-pill { width: auto; min-width: 170px; max-width: 260px; border-radius: 999px; padding-left: 40px; background-color: var(--surface); font-weight: 550; text-overflow: ellipsis; }
    .tv-pill:disabled { color: var(--muted); cursor: default; }
    .btn-pill { border-radius: 999px; }
    .conn { position: relative; }
    .conn > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); font-size: 13px; font-weight: 600; letter-spacing: 0.04em; }
    .conn > summary:hover { border-color: var(--border-strong); color: var(--text); }
    .conn > summary::-webkit-details-marker { display: none; }
    .conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; box-shadow: 0 0 0 3px var(--accent-soft); }
    .conn.is-online .conn-dot { background: var(--green); box-shadow: 0 0 0 3px var(--green-soft); }
    .conn.is-offline .conn-dot { background: var(--red); box-shadow: 0 0 0 3px var(--red-soft); }
    .conn-pop {
      position: absolute; right: 0; top: calc(100% + 8px); z-index: 40; width: 290px; max-width: calc(100vw - 32px);
      padding: 14px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border-strong);
      box-shadow: var(--shadow); font-size: 13px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 12px;
    }
    .conn-status-row { display: flex; align-items: flex-start; gap: 10px; color: var(--text); }
    .conn-status-row .conn-dot { margin-top: 6px; }
    .conn-meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; margin: 0; padding-top: 12px; border-top: 1px solid var(--border); }
    .conn-meta dt { color: var(--muted); font-size: 12px; }
    .conn-meta dd { margin: 0; font-family: var(--mono); font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; }

    /* ---------- Shared remote primitives ---------- */
    .rm-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .rm-mono { font-family: var(--mono); font-size: 12px; color: var(--muted); }
    .rm-hint { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .rm-cta { min-height: 52px; font-size: 15px; border-radius: 14px; box-shadow: 0 8px 24px rgba(245, 158, 11, 0.18); }
    .rm-cta:disabled { box-shadow: none; }
    .rm-cta .js-cast-label { overflow: hidden; text-overflow: ellipsis; }
    .rm-round { border-radius: 50%; padding: 0; width: 48px; height: 48px; min-width: 48px; }
    [aria-busy="true"] { opacity: 0.7; pointer-events: none; }
    .is-busy .icon { animation: rm-spin 0.9s linear infinite; }
    @keyframes rm-spin { to { transform: rotate(360deg); } }

    /* ---------- TV list ---------- */
    .rm-tv-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .rm-tv {
      appearance: none; width: 100%; text-align: left; font: inherit; color: var(--text);
      display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 12px;
      padding: 10px 12px; min-height: 60px; border-radius: 12px; border: 1px solid var(--border);
      background: var(--surface-2); cursor: pointer; -webkit-tap-highlight-color: transparent;
      transition: border-color 0.15s var(--ease), background 0.15s var(--ease), transform 0.1s var(--ease);
    }
    .rm-tv:hover { border-color: var(--border-strong); background: var(--surface-3); }
    .rm-tv:active { transform: scale(0.99); }
    .rm-tv.is-selected { border-color: var(--accent); background: linear-gradient(0deg, var(--accent-soft), var(--accent-soft)), var(--surface-2); box-shadow: inset 0 0 0 1px var(--accent); }
    .rm-tv-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; color: var(--blue); background: var(--blue-soft); }
    .rm-tv[data-proto="roku"] .rm-tv-icon { color: #c4b5fd; background: rgba(167, 139, 250, 0.14); }
    .rm-tv[data-proto="dlna"] .rm-tv-icon { color: var(--green); background: var(--green-soft); }
    .rm-tv-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .rm-tv-name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rm-tv-sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rm-tv-sub .rm-mono { font-size: 11.5px; }
    .rm-tv-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .rm-proto { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-secondary); padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-strong); white-space: nowrap; }
    .rm-tv.is-selected .rm-proto { color: var(--accent); border-color: rgba(245, 158, 11, 0.45); }
    .rm-tv-meta .badge { font-size: 11px; padding: 1px 7px; }

    /* ---------- Contextual control box ---------- */
    .rm-box { border-top: 1px solid var(--border); padding-top: 16px; }
    .rm-ctx { display: flex; flex-direction: column; gap: 14px; }
    .rm-ctx-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
    .rm-ctx-head strong { font-size: 15px; font-weight: 650; display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .rm-ctx-head .rm-mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .rm-transport { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 6px 0; }
    .rm-transport > :first-child { justify-self: start; }
    .rm-transport > :last-child { justify-self: end; }
    .rm-toggle {
      width: 68px; height: 68px; min-width: 68px; border-radius: 50%; padding: 0;
      background: var(--accent); border-color: var(--accent); color: var(--accent-fg);
      box-shadow: 0 10px 28px rgba(245, 158, 11, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }
    .rm-toggle:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .rm-toggle .icon { width: 28px; height: 28px; fill: currentColor; }
    .rm-state { font-size: 12px; font-weight: 600; color: var(--muted); padding: 4px 10px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); white-space: nowrap; }
    .rm-state[data-state="playing"] { color: var(--green); border-color: rgba(34, 197, 94, 0.35); background: var(--green-soft); }
    .rm-state[data-state="loading"] { color: var(--accent); border-color: rgba(245, 158, 11, 0.35); background: var(--accent-soft); }

    .rm-vol { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); }
    .rm-vol-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; gap: 10px; }
    .rm-vol-readout { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
    .rm-vol-value { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
    .rm-vol-meter { width: 100%; height: 4px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .rm-vol-meter > span { display: block; height: 100%; width: 50%; background: var(--accent); border-radius: inherit; transition: width 0.2s var(--ease); }
    .rm-presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .rm-preset { min-height: 36px; padding: 6px 4px; border-radius: 999px; font-size: 13px; font-variant-numeric: tabular-nums; }
    .rm-preset.is-active { border-color: var(--accent); color: var(--accent-fg); background: var(--accent); }

    .rm-seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); }
    .rm-seg-btn { min-height: 38px; border-color: transparent; background: transparent; color: var(--muted); border-radius: 9px; }
    .rm-seg-btn:hover { background: var(--surface-2); color: var(--text); }
    .rm-seg-btn[aria-pressed="true"] { background: var(--surface-3); color: var(--text); border-color: var(--border-strong); }

    .rm-alert { display: flex; gap: 10px; padding: 12px; border-radius: 12px; background: var(--accent-soft); border: 1px solid rgba(245, 158, 11, 0.35); font-size: 13px; color: var(--text-secondary); line-height: 1.45; }
    .rm-alert > .icon { color: var(--accent); margin-top: 1px; }
    .rm-alert strong { color: var(--text); display: block; margin-bottom: 2px; }
    .rm-path { display: block; margin-top: 6px; font-family: var(--mono); font-size: 12px; color: var(--accent); overflow-wrap: anywhere; }

    .rm-dpad {
      position: relative; width: 220px; height: 220px; margin: 4px auto 0; border-radius: 50%;
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); place-items: center;
      background: radial-gradient(circle at 50% 35%, var(--surface-3), var(--surface-2) 70%);
      border: 1px solid var(--border-strong); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 14px 32px rgba(0, 0, 0, 0.35);
    }
    .rm-dpad-btn { width: 56px; height: 56px; min-width: 56px; border-radius: 50%; padding: 0; background: transparent; border-color: transparent; color: var(--text-secondary); }
    .rm-dpad-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--text); }
    .rm-dpad-up { grid-area: 1 / 2; }
    .rm-dpad-left { grid-area: 2 / 1; }
    .rm-dpad-ok { grid-area: 2 / 2; width: 80px; height: 80px; min-width: 80px; border-radius: 50%; padding: 0; font-weight: 700; letter-spacing: 0.04em; background: var(--bg); border: 1px solid var(--border-strong); box-shadow: 0 0 0 3px var(--accent-soft); }
    .rm-dpad-ok:hover { background: var(--surface); border-color: var(--accent); }
    .rm-dpad-right { grid-area: 2 / 3; }
    .rm-dpad-down { grid-area: 3 / 2; }
    .rm-keys { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; justify-items: center; }

    /* ---------- Secondary drawer ---------- */
    .rm-secondary { display: flex; flex-direction: column; gap: 8px; padding: 14px; }
    .rm-secondary > .rm-eyebrow { padding: 2px 4px 4px; }
    .rm-acc { border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
    .rm-acc > summary { list-style: none; cursor: pointer; padding: 12px 14px; min-height: 48px; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .rm-acc > summary::-webkit-details-marker { display: none; }
    .rm-acc > summary > .icon { color: var(--muted); transition: transform 0.2s var(--ease); }
    .rm-acc[open] > summary > .icon { transform: rotate(180deg); }
    .rm-acc-title { display: inline-flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .rm-acc-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    .rm-preview { width: 100%; border-radius: var(--radius-xs); background: #000; aspect-ratio: 16 / 9; }
    .rm-seek { display: flex; align-items: center; gap: 10px; }
    .rm-seek input { flex: 1 1 auto; accent-color: var(--accent); min-width: 0; }
    .rm-time { font-family: var(--mono); font-size: 12px; color: var(--muted); white-space: nowrap; }
    .rm-roku-links { display: flex; flex-direction: column; gap: 6px; }

    /* ---------- Mobile Now Playing bar ---------- */
    .now-playing { display: none; }
    .np-info { appearance: none; flex: 1 1 auto; min-width: 0; min-height: 44px; display: flex; align-items: center; gap: 10px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .np-art { width: 44px; height: 44px; flex: 0 0 auto; border-radius: 10px; display: grid; place-items: center; background: var(--surface-3); color: var(--accent); border: 1px solid var(--border-strong); }
    .np-text { display: flex; flex-direction: column; min-width: 0; }
    .now-playing-title { font-weight: 650; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .now-playing-sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .np-progress { position: absolute; left: 0; right: 0; top: 0; height: 2px; background: transparent; overflow: hidden; }
    .np-progress > span { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.3s linear; }
    .np-btn { width: 48px; height: 48px; min-width: 48px; border-radius: 50%; padding: 0; }
    .np-toggle { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); box-shadow: 0 6px 18px rgba(245, 158, 11, 0.3); }
    .np-toggle:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .np-toggle .icon { fill: currentColor; }

    /* ---------- Remote bottom sheet ---------- */
    .sheet-panel:not([hidden]) { animation: rm-sheet-in 0.28s var(--ease); }
    .sheet-backdrop:not([hidden]) { animation: rm-fade-in 0.2s var(--ease); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
    @keyframes rm-sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes rm-fade-in { from { opacity: 0; } to { opacity: 1; } }
    .sheet-panel { max-width: 560px; margin: 0 auto; }
    .rm-sheet-body { display: flex; flex-direction: column; gap: 16px; }
    .rm-sheet-media { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); min-width: 0; }
    .rm-sheet-media .np-art { width: 52px; height: 52px; }
    .rm-sheet-media-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .rm-sheet-media-title { font-weight: 650; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rm-sheet-media-sub { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rm-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
    .rm-chips::-webkit-scrollbar { display: none; }
    .rm-chip { flex: 0 0 auto; max-width: 220px; border-radius: 999px; min-height: 44px; }
    .rm-chip span { overflow: hidden; text-overflow: ellipsis; }
    .rm-chip.is-selected { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

    /* ---------- QR modal ---------- */
    .qr-dialog { max-width: 400px; }
    .qr-frame { background: #ffffff; border-radius: 16px; padding: 12px; width: min(100%, 260px); margin: 0 auto; box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.04), 0 16px 40px rgba(0, 0, 0, 0.45); }
    .qr-frame svg { display: block; width: 100%; height: auto; }
    .qr-url { display: block; text-align: center; font-size: 13px; padding: 10px; border-radius: var(--radius-xs); background: var(--bg); border: 1px solid var(--border); overflow-wrap: anywhere; color: var(--text); }
    .qr-steps { margin: 0; padding-left: 20px; color: var(--text-secondary); font-size: 13px; display: flex; flex-direction: column; gap: 4px; }

    @media (max-width: 959px) {
      .topbar-actions { flex: 1 1 100%; }
      .tv-pill-wrap { flex: 1 1 auto; }
      .tv-pill { min-width: 0; max-width: none; width: 100%; }
      .conn > summary { min-height: 44px; }
      .rm-preset { min-height: 44px; }
      .rm-seg-btn { min-height: 44px; }
      .rm-tv { min-height: 64px; }
      #seek-slider { min-height: 44px; }
      .now-playing {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 45;
        display: flex; align-items: center; gap: 10px;
        padding: 10px 16px calc(10px + var(--safe-bottom));
        background: rgba(19, 19, 22, 0.78);
        backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.35);
      }
    }
    @media (max-width: 560px) {
      .brand-mark { width: 36px; height: 36px; }
      .btn-pair .btn-label { display: none; }
      .btn-pair { width: 44px; padding: 0; border-radius: 50%; }
      .rm-dpad { width: 208px; height: 208px; }
    }
`;

const REMOTE_SCRIPT = String.raw`
    (function () {
      var STTV = window.__STTV;
      var state = STTV.state;
      var u = STTV.utils;
      var sel = STTV.selectors;
      var act = STTV.actions;
      var hooks = STTV.hooks;
      var icons = STTV.icons;

      function $(id) { return document.getElementById(id); }
      function $all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
      function setText(selector, text) { $all(selector).forEach(function (el) { el.textContent = text; }); }

      var elTvList = $("tv-list");
      var elTvQuick = $("tv-quick-select");
      var elConn = $("conn-status");
      var elConnSummary = $("conn-summary");
      var elConnDetail = $("conn-detail");
      var elConnWs = $("conn-ws-state");
      var elConnPanelUrl = $("conn-panel-url");
      var elHeaderUrl = $("header-url");
      var elLanUrl = $("lan-url-text");
      var elCastBadge = $("cast-target-badge");
      var elSecReceiver = $("sec-receiver");
      var elSecDlna = $("sec-dlna");
      var elSecRoku = $("sec-roku");
      var elSecRokuList = $("sec-roku-list");
      var elReceiverState = $("receiver-state-label");
      var elPreview = $("local-preview");
      var elPreviewTrack = $("local-subtitle-track");
      var elSeek = $("seek-slider");
      var elTime = $("time-label");
      var elNpTitle = $("now-playing-title");
      var elNpSub = $("now-playing-sub");
      var scanning = false;
      var elNpProgress = $("np-progress-bar");
      var elSheet = $("remote-sheet");
      var elSheetBackdrop = $("remote-sheet-backdrop");
      var elSheetTitle = $("sheet-media-title");
      var elSheetSub = $("sheet-media-sub");
      var elSheetTvs = $("sheet-tv-list");
      var elQrModal = $("qr-modal");

      var PROTO = {
        cast: { label: "Google Cast", short: "Cast", icon: "cast" },
        roku: { label: "Roku ECP", short: "Roku", icon: "tv" },
        dlna: { label: "DLNA DMR", short: "DLNA", icon: "wifi" }
      };
      var STATE_LABELS = {
        idle: "Ocioso",
        loading: "Carregando…",
        playing: "Reproduzindo",
        paused: "Pausado",
        stopped: "Parado",
        ended: "Concluído",
        error: "Erro"
      };
      var ECP_LABELS = { limited: "Modo limitado", permissive: "Permissivo", unknown: "Modo desconhecido" };
      var OFFLINE_RED_AFTER_MS = 6000;

      var returnFocus = {};
      var subtitleMode = null;
      var everConnected = false;

      ${SEEK_QUEUE_JS}
      var SKIP_BACK_SEC = ${SKIP_BACK_SEC};
      var SKIP_FORWARD_SEC = ${SKIP_FORWARD_SEC};
      var skipMediaId = null;
      var skipQueue = createSeekQueue({ delayMs: 400, send: function (sec) {
        var session = playerSession();
        if (session && session.mediaId === skipMediaId) seekTo(session, sec);
      } });

      function hasTransport(session) {
        return Boolean(session) && (session.tv.protocol === "google-cast" || session.tv.protocol === "web-receiver");
      }

      function seekTo(session, sec) {
        if (session.tv.protocol === "web-receiver") act.sendWs({ type: "command", command: "seek", positionSec: sec });
        else if (session.tv.protocol === "google-cast" && session.seekable) act.sendCastControl("SEEK", sec, session.tv);
      }

      function skipBy(deltaSec) {
        var session = playerSession();
        if (!hasTransport(session) || !session.seekable || !session.duration) return;
        var current = session.tv.protocol === "google-cast" ? u.playbackPosition(session) : session.position;
        if (skipQueue.pending() !== null && skipMediaId !== session.mediaId) skipQueue.cancel();
        skipMediaId = session.mediaId;
        var target = skipQueue.nudge(deltaSec, current, session.duration);
        if (session.tv.protocol === "google-cast") { session.position = target; session.updated = Date.now(); }
        else state.remotePositionSec = target;
        updatePlayerClock();
      }

      function togglePlayback(session) {
        if (session.tv.protocol === "google-cast") act.sendCastControl(session.playing ? "PAUSE" : "PLAY", undefined, session.tv);
        if (session.tv.protocol === "web-receiver") act.sendWs({ type: "command", command: session.playing ? "pause" : "play" });
      }
      var offlineSince = null;

      /* ---------- helpers ---------- */
      function protoOf(tv) {
        if (!tv) return "cast";
        if (tv.protocol === "roku-ecp") return "roku";
        if (tv.protocol === "dlna-dmr") return "dlna";
        return "cast";
      }

      function contextMode() { return protoOf(sel.getSelectedTv()); }

      function rokuTarget() {
        var selected = sel.getSelectedTv();
        if (selected && selected.protocol === "roku-ecp") return selected;
        return state.tvs.find(function (t) { return t.protocol === "roku-ecp"; }) || null;
      }

      function stateLabel(value) { return STATE_LABELS[value] || String(value || ""); }

      function mediaTitle(media) { return media ? (media.title || media.fileName) : ""; }

      function isDownloading(media) { return Boolean(media && media.downloadStatus && media.downloadStatus.ready === false); }

      function volumeLabel() {
        var pct = Math.round(state.castVolume * 100);
        return pct <= 0 ? "Mudo" : pct + "%";
      }

      function connStatus() {
        if (state.wsConnected) {
          everConnected = true;
          offlineSince = null;
          return "online";
        }
        if (offlineSince === null) offlineSince = Date.now();
        return Date.now() - offlineSince > OFFLINE_RED_AFTER_MS ? "offline" : "pending";
      }

      /* ---------- TVs ---------- */
      function tvCardHtml(tv) {
        var proto = protoOf(tv);
        var meta = PROTO[proto];
        var selected = tv.id === state.selectedTvId;
        var model = [tv.manufacturer, tv.modelName].filter(Boolean).join(" ");
        var limited = tv.protocol === "roku-ecp" && tv.ecpMode === "limited";
        return '<button type="button" class="rm-tv' + (selected ? " is-selected" : "") + '" data-tv-id="' + u.esc(tv.id) + '" data-proto="' + proto + '" aria-pressed="' + selected + '">' +
          '<span class="rm-tv-icon">' + icons[meta.icon] + "</span>" +
          '<span class="rm-tv-body"><span class="rm-tv-name">' + u.esc(tv.name) + "</span>" +
          '<span class="rm-tv-sub"><span class="rm-mono">' + u.esc(tv.ip + ":" + tv.port) + "</span>" + (model ? " · " + u.esc(model) : "") + "</span></span>" +
          '<span class="rm-tv-meta"><span class="rm-proto">' + meta.label + "</span>" +
          (limited ? '<span class="badge badge-warn">' + ECP_LABELS.limited + "</span>" : "") + "</span></button>";
      }

      function tvChipHtml(tv) {
        var selected = tv.id === state.selectedTvId;
        return '<button type="button" class="btn rm-chip' + (selected ? " is-selected" : "") + '" data-tv-id="' + u.esc(tv.id) + '" aria-pressed="' + selected + '">' +
          icons[PROTO[protoOf(tv)].icon] + "<span>" + u.esc(tv.name) + "</span></button>";
      }

      function renderTvs() {
        var tvs = state.tvs;
        var activeEl = document.activeElement;
        var restoreScope = activeEl && elTvList.contains(activeEl) ? elTvList : (activeEl && elSheetTvs.contains(activeEl) ? elSheetTvs : null);
        var restoreTvId = restoreScope && activeEl.getAttribute ? activeEl.getAttribute("data-tv-id") : null;

        elTvQuick.innerHTML = tvs.length
          ? tvs.map(function (tv) {
              return '<option value="' + u.esc(tv.id) + '"' + (tv.id === state.selectedTvId ? " selected" : "") + ">" +
                u.esc(tv.name) + "</option>";
            }).join("")
          : '<option value="">Nenhuma TV</option>';
        elTvQuick.disabled = tvs.length === 0;

        elTvList.innerHTML = tvs.length
          ? tvs.map(tvCardHtml).join("")
          : '<div class="empty">Nenhuma TV encontrada na rede local.<br>Ligue a TV no mesmo Wi-Fi e toque em “Buscar TVs”.</div>';

        elSheetTvs.innerHTML = tvs.map(tvChipHtml).join("");
        elSheetTvs.hidden = tvs.length < 2;

        if (restoreScope && restoreTvId) {
          var btn = restoreScope.querySelector('[data-tv-id="' + restoreTvId.replace(/"/g, '\\"') + '"]');
          if (btn && btn.focus) btn.focus();
        }

        var rokus = tvs.filter(function (t) { return t.protocol === "roku-ecp"; });
        elSecRokuList.innerHTML = rokus.map(function (tv) {
          return '<button type="button" class="btn btn-block" data-tv-id="' + u.esc(tv.id) + '">' + icons.tv + "<span>Controlar " + u.esc(tv.name) + "</span></button>";
        }).join("");
        syncContext();
      }

      /* ---------- Contextual containers ---------- */
      function syncContext() {
        var mode = contextMode();
        $all("[data-ctx]").forEach(function (el) { el.hidden = el.getAttribute("data-ctx") !== mode; });
        elSecDlna.hidden = mode === "dlna";
        elSecRoku.hidden = mode === "roku" || !state.tvs.some(function (t) { return t.protocol === "roku-ecp"; });
        return mode;
      }

      function updateConnection() {
        var status = connStatus();
        elConn.classList.toggle("is-online", status === "online");
        elConn.classList.toggle("is-pending", status === "pending");
        elConn.classList.toggle("is-offline", status === "offline");
        var detail = status === "online"
          ? "Conectado ao servidor na rede local."
          : status === "pending"
            ? (everConnected ? "Reconectando ao servidor…" : "Conectando ao servidor…")
            : "Sem conexão com o servidor. Tentando novamente a cada 2 s.";
        elConnDetail.textContent = detail;
        elConnSummary.setAttribute("aria-label", "Status da conexão: " + detail);
        elConnWs.textContent = state.wsConnected ? "ativo" : "offline";
        elConnPanelUrl.textContent = state.network.panelUrl;
        elHeaderUrl.textContent = state.network.panelUrl;
        elLanUrl.textContent = state.network.panelUrl;
      }

      function updateCast(media) {
        var castTv = sel.getCastTargetTv();
        var downloading = isDownloading(media);
        var loading = state.castLoading;
        var hint;
        var canCast = false;
        if (!media) hint = "Escaneie uma pasta com filmes para começar.";
        else if (downloading) hint = media.downloadStatus.reason || "O arquivo ainda está em download.";
        else if (!castTv) hint = "Nenhuma TV Google Cast encontrada. Toque em Buscar TVs.";
        else {
          canCast = !loading;
          hint = loading ? "Enviando para " + castTv.name + "…" : "Pronto: " + mediaTitle(media) + " → " + castTv.name + ".";
        }

        elCastBadge.textContent = castTv ? castTv.ip + ":" + castTv.port : "Sem TV Cast";
        $all("[data-cast-load]").forEach(function (btn) { btn.disabled = !canCast; });
        setText("[data-cast-load] .js-cast-label", loading ? "Enviando…" : (castTv ? "Transmitir para " + castTv.name : "Transmitir para TV"));
        setText("[data-cast-hint]", hint);
        setText("[data-cast-tv-name]", castTv ? castTv.name : "Google Cast");

        $all("[data-cast-ctl]").forEach(function (btn) { btn.disabled = !castTv; });
        $all('[data-volume-step="-0.1"]').forEach(function (btn) { btn.disabled = !castTv || state.castVolume <= 0; });
        $all('[data-volume-step="0.1"]').forEach(function (btn) { btn.disabled = !castTv || state.castVolume >= 1; });
        setText("[data-volume-label]", volumeLabel());
        $all("[data-volume-meter]").forEach(function (el) { el.style.width = Math.round(state.castVolume * 100) + "%"; });
        $all("[data-volume-preset]").forEach(function (btn) {
          var active = Math.abs(Number(btn.getAttribute("data-cast-value")) - state.castVolume) < 0.005;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-pressed", String(active));
        });

        $all("[data-toggle-play]").forEach(function (btn) {
          var playing = state.playback && state.playback.playing && castTv && castTv.id === state.playback.tv.id;
          btn.innerHTML = playing ? icons.pause : icons.play;
          btn.setAttribute("aria-label", playing ? "Pausar na TV" : "Reproduzir na TV");
        });
        $all("[data-sub-mode]").forEach(function (btn) {
          btn.setAttribute("aria-pressed", String(btn.getAttribute("data-sub-mode") === subtitleMode));
        });
        $all("[data-remote-state]").forEach(function (el) {
          var session = state.playback;
          var value = loading ? "loading" : session && castTv && castTv.id === session.tv.id ? (session.playing ? "playing" : "paused") : "idle";
          el.textContent = stateLabel(value);
          el.setAttribute("data-state", value);
        });
      }

      function updateRoku() {
        var tv = rokuTarget();
        var limited = Boolean(tv && tv.ecpMode === "limited");
        $all("[data-roku-limited]").forEach(function (el) { el.hidden = !limited; });
        setText("[data-roku-name]", tv ? tv.name + " · " + (ECP_LABELS[tv.ecpMode] || tv.ecpMode) : "Nenhuma Roku selecionada");
      }

      function updateDlna(media) {
        var tv = sel.getSelectedTv();
        var isDmr = Boolean(tv && tv.protocol === "dlna-dmr");
        var ready = Boolean(media) && !isDownloading(media);
        var hint;
        if (!isDmr) hint = "Selecione um renderizador DLNA DMR para habilitar o envio direto.";
        else if (!media) hint = "Selecione um filme para enviar a " + tv.name + ".";
        else if (!ready) hint = media.downloadStatus.reason || "O arquivo ainda está em download.";
        else hint = "Pronto para enviar SetAVTransportURI para " + tv.name + " (" + tv.ip + ").";
        $all("[data-dlna-push]").forEach(function (btn) { btn.disabled = !isDmr || !ready; });
        setText("[data-dlna-hint]", hint);
        setText("[data-dlna-name]", isDmr ? tv.name : "DLNA DMR");
      }

      function playerSession() {
        if (state.playback) return state.playback;
        if (!state.remoteMediaId || !["playing", "paused", "loading"].includes(state.remoteState)) return null;
        return {
          tv: { protocol: "web-receiver", name: "Web Receiver" }, title: state.remoteTitle || "Web Receiver",
          mediaId: state.remoteMediaId, duration: state.remoteDurationSec,
          position: skipQueue.pending() !== null ? skipQueue.pending() : state.remotePositionSec,
          playing: state.isPlaying, seekable: state.wsConnected
        };
      }

      function updateNowPlaying(media, mode) {
        var session = playerSession();
        var tv = mode === "cast" ? sel.getCastTargetTv() : sel.getSelectedTv();
        var selectedName = session ? session.title : mediaTitle(media) || "Escolha um filme";
        var npSub = session ? (session.tv.protocol === "dlna-dmr" ? "Enviado" : session.playing ? "Reproduzindo" : "Pausado") + " · " + session.tv.name
          : tv ? "Destino · " + tv.name : "Nenhuma TV selecionada";
        elNpTitle.textContent = selectedName;
        elNpTitle.title = selectedName;
        elNpTitle.closest("button").setAttribute("aria-label", "Controle remoto · " + selectedName);
        elNpSub.textContent = npSub;
        elSheetTitle.textContent = selectedName;
        elSheetSub.textContent = npSub;
        setText(".player-cover-title", selectedName);
        var currentId = session ? session.mediaId : media && media.id;
        var jacket = Math.max(0, state.items.findIndex(function (item) { return item.id === currentId; })) % 3;
        $all(".player-cover, .np-info .np-art").forEach(function (cover) {
          cover.classList.remove("jacket-0", "jacket-1", "jacket-2");
          cover.classList.add("jacket-" + jacket);
        });
        setText("[data-player-caption]", npSub);
        var activeCast = session && session.tv.protocol === "google-cast";
        var receiver = session && session.tv.protocol === "web-receiver";
        var transport = hasTransport(session);

        var label = !tv ? (scanning ? "Buscando…" : "Buscar TVs")
          : !media ? "Escolher filme"
          : isDownloading(media) ? "Em download"
          : mode === "roku" ? "Abrir Roku"
          : state.castLoading ? "Enviando…" : "Transmitir";
        $all("[data-send-selection]").forEach(function (button) {
          var caption = button.querySelector("span") || button;
          caption.textContent = label === "Transmitir" ? "Assistir na TV" : label;
          button.disabled = scanning || state.castLoading || Boolean(tv && isDownloading(media));
        });
        $all("[data-player-send]").forEach(function (button) { button.hidden = Boolean(session); });
        if (transport) label = session.playing ? "Pausar" : "Reproduzir";
        var symbol = transport && session.playing ? icons.pause : !session && !tv ? icons.tv : icons.play;
        $all("[data-session-action]").forEach(function (button) {
          button.hidden = Boolean(session && !transport) || (!session && Boolean(button.closest("#remote-sheet")));
          button.innerHTML = symbol;
          button.title = label;
          button.setAttribute("aria-label", label + (transport ? " · " + session.title + " · " + session.tv.name : tv && media ? " · " + mediaTitle(media) + " · " + tv.name : ""));
          button.disabled = state.castLoading || (receiver && !state.wsConnected) || (!transport && (scanning || Boolean(tv && isDownloading(media))));
        });
        var skipBlocked = !transport ? "" : !session.seekable
          ? (activeCast ? "Indisponível: este filme está em modo Remux no Cast" : "Indisponível: Web Receiver desconectado")
          : !session.duration ? "Indisponível: duração do filme desconhecida" : "";
        $all("[data-player-skip]").forEach(function (button) {
          var delta = Number(button.getAttribute("data-player-skip"));
          button.hidden = !transport;
          button.disabled = Boolean(skipBlocked);
          button.title = skipBlocked || (delta < 0 ? "Voltar " + SKIP_BACK_SEC + " segundos" : "Avançar " + SKIP_FORWARD_SEC + " segundos");
        });
        $all("[data-player-volume]").forEach(function (input) {
          input.disabled = !activeCast;
          input.value = String(Math.round(state.castVolume * 100));
        });
        $all("[data-player-stop]").forEach(function (button) { button.hidden = !activeCast; });
        updatePlayerClock();
      }

      function updatePlayerClock() {
        var session = playerSession();
        var duration = session ? session.duration : (sel.getSelectedMedia() || {}).durationSec || 0;
        var position = session && session.tv.protocol === "google-cast" ? u.playbackPosition(session) : session && session.position || 0;
        elNpProgress.style.width = (duration > 0 ? Math.min(100, position / duration * 100) : 0) + "%";
        $all("[data-player-seek]").forEach(function (input) {
          input.disabled = !session || !session.seekable || !duration;
          input.max = String(Math.floor(duration) || 1);
          if (!input.matches(":active")) input.value = String(Math.floor(position));
        });
        setText("[data-player-position]", u.formatTime(position));
        setText("[data-player-duration]", u.formatTime(duration));
      }
      setInterval(function () { if (state.playback && state.playback.playing && !document.hidden) updatePlayerClock(); }, 1000);

      function updateRemoteUi() {
        var media = sel.getSelectedMedia();
        var mode = syncContext();
        updateConnection();
        updateCast(media);
        updateRoku();
        updateDlna(media);
        updateNowPlaying(media, mode);

        elReceiverState.textContent = stateLabel(state.remoteState) + (state.remoteTitle ? " — " + state.remoteTitle : "");
        if (!state.isSeeking && skipQueue.pending() === null && state.remoteDurationSec > 0 && !previewActive()) {
          elSeek.max = String(Math.floor(state.remoteDurationSec));
          elSeek.value = String(Math.floor(state.remotePositionSec));
          elTime.textContent = u.formatTime(state.remotePositionSec) + " / " + u.formatTime(state.remoteDurationSec);
        }
      }

      /* ---------- Local preview (Web Receiver drawer) ---------- */
      function previewActive() {
        return elSecReceiver.open && Boolean(elPreview.getAttribute("src"));
      }

      function applyPreviewSubtitle(media, subtitleId) {
        if (!elSecReceiver.open) return;
        var track = elPreview.textTracks && elPreview.textTracks[0];
        if (!media || !subtitleId) {
          elPreviewTrack.removeAttribute("src");
          if (track) track.mode = "disabled";
          return;
        }
        elPreviewTrack.src = sel.buildSubtitleUrl(media.id, subtitleId, state.previewOffsetSec);
        if (track) track.mode = "showing";
      }

      function loadLocalPreview(media, startSec, autoplay) {
        if (!elSecReceiver.open || !media) return;
        if (isDownloading(media)) {
          elPreview.removeAttribute("src");
          elPreview.load();
          state.previewLoadedMediaId = null;
          return;
        }
        var choice = sel.getTrackChoice(media);
        var start = Math.max(0, Math.floor(startSec || 0));
        var direct = sel.isDirectPlaySelected(media, choice.audioStreamIndex) && start === 0;
        state.previewOffsetSec = direct ? 0 : start;
        state.previewLoadedMediaId = media.id;
        elPreview.src = sel.buildStreamUrl(media.id, choice.audioStreamIndex, start);
        applyPreviewSubtitle(media, choice.subtitleId);
        elSeek.max = String(Math.max(1, Math.floor(media.durationSec || 0)));
        elSeek.value = String(start);
        elTime.textContent = u.formatTime(start) + " / " + u.formatTime(media.durationSec || 0);
        if (autoplay) elPreview.play().catch(function () {});
      }

      function getPreviewPositionSec() {
        if (!previewActive()) return 0;
        return Math.floor(state.previewOffsetSec + (elPreview.currentTime || 0));
      }

      /* ---------- Overlays: focus management ---------- */
      function focusablesIn(root) {
        var nodes = root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])');
        return Array.prototype.filter.call(nodes, function (el) {
          return !el.disabled && !el.closest("[hidden]") && el.getClientRects().length > 0;
        });
      }

      function topOverlay() {
        if (!elQrModal.hidden) return elQrModal;
        if (!elSheet.hidden) return elSheet;
        return null;
      }

      function overlayOpen(el) {
        if (!el.hidden) return;
        returnFocus[el.id] = document.activeElement;
        el.hidden = false;
        document.body.classList.add("no-scroll");
        var target = el.querySelector("[data-autofocus]") || focusablesIn(el)[0];
        if (target) target.focus();
      }

      function overlayClose(el) {
        if (el.hidden) return;
        el.hidden = true;
        if (!topOverlay()) document.body.classList.remove("no-scroll");
        var back = returnFocus[el.id];
        returnFocus[el.id] = null;
        if (back && back.focus && document.contains(back)) back.focus();
      }

      function setSheetExpanded(expanded) {
        $all("[data-open-sheet]").forEach(function (btn) { btn.setAttribute("aria-expanded", String(expanded)); });
      }

      function openQrModal() { elConn.open = false; overlayOpen(elQrModal); }
      function closeQrModal() { overlayClose(elQrModal); }
      function openRemoteSheet() {
        updateRemoteUi();
        elSheetBackdrop.hidden = false;
        overlayOpen(elSheet);
        setSheetExpanded(true);
      }
      function closeRemoteSheet() {
        elSheetBackdrop.hidden = true;
        overlayClose(elSheet);
        setSheetExpanded(false);
      }

      function handlePlayerKey(ev) {
        if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || !elQrModal.hidden) return false;
        var isSpace = ev.key === " " || ev.key === "Spacebar";
        if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight" && !isSpace) return false;
        var t = ev.target;
        if (t instanceof Element && (t.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])")
          || (isSpace && t.closest("button, summary, a")))) return false;
        var session = playerSession();
        if (!hasTransport(session)) return false;
        if (isSpace) {
          if (state.castLoading || (session.tv.protocol === "web-receiver" && !state.wsConnected)) return false;
          togglePlayback(session);
          return true;
        }
        if (!session.seekable || !session.duration) return false;
        skipBy(ev.key === "ArrowLeft" ? -SKIP_BACK_SEC : SKIP_FORWARD_SEC);
        return true;
      }

      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") {
          if (!elQrModal.hidden) { ev.preventDefault(); closeQrModal(); }
          else if (!elSheet.hidden) { ev.preventDefault(); closeRemoteSheet(); }
          else if (elConn.open) { elConn.open = false; elConnSummary.focus(); }
          return;
        }
        if (handlePlayerKey(ev)) { ev.preventDefault(); return; }
        if (ev.key !== "Tab") return;
        var overlay = topOverlay();
        if (!overlay) return;
        var items = focusablesIn(overlay);
        if (!items.length) { ev.preventDefault(); return; }
        var first = items[0];
        var last = items[items.length - 1];
        var inside = overlay.contains(document.activeElement);
        if (ev.shiftKey && (document.activeElement === first || !inside)) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && (document.activeElement === last || !inside)) { ev.preventDefault(); first.focus(); }
      });

      /* ---------- Commands ---------- */
      function withBusy(btn, task) {
        if (btn.getAttribute("aria-busy") === "true") return;
        btn.setAttribute("aria-busy", "true");
        Promise.resolve().then(task).catch(function () {}).then(function () {
          btn.removeAttribute("aria-busy");
          updateRemoteUi();
        });
      }

      function sendRokuKey(key) {
        var tv = rokuTarget();
        u.apiJson("/api/tv/roku/keypress", { method: "POST", body: JSON.stringify({ tvId: tv ? tv.id : null, key: key }) })
          .catch(function (err) { u.showToast("Erro ECP (" + key + "): " + err.message, true); });
      }

      async function launchRoku() {
        var tv = rokuTarget();
        try {
          await u.apiJson("/api/tv/roku/launch", { method: "POST", body: JSON.stringify({ tvId: tv ? tv.id : null }) });
          u.showToast("Abrindo Roku Media Player" + (tv ? " em " + tv.name : "") + ".");
        } catch (err) {
          u.showToast("Falha ao abrir Roku Media Player: " + err.message, true);
        }
      }

      async function setActiveDlna() {
        var media = sel.getSelectedMedia();
        if (!media) { u.showToast("Selecione um filme primeiro.", true); return; }
        var choice = sel.getTrackChoice(media);
        try {
          await u.apiJson("/api/session", {
            method: "POST",
            body: JSON.stringify({ mediaId: media.id, audioStreamIndex: choice.audioStreamIndex, subtitleId: choice.subtitleId, selectedTvId: state.selectedTvId })
          });
          u.showToast("Filme definido como ativo no DLNA MediaServer.");
        } catch (err) {
          u.showToast("Erro ao atualizar sessão: " + err.message, true);
        }
      }

      async function pushDlna() {
        var tv = sel.getSelectedTv();
        var media = sel.getSelectedMedia();
        if (!tv || tv.protocol !== "dlna-dmr") { u.showToast("Selecione uma TV DLNA DMR.", true); return; }
        if (!media) { u.showToast("Selecione um filme primeiro.", true); return; }
        var choice = sel.getTrackChoice(media);
        try {
          await u.apiJson("/api/tv/dlna/push", {
            method: "POST",
            body: JSON.stringify({ tvId: tv.id, mediaId: media.id, audioStreamIndex: choice.audioStreamIndex, subtitleId: choice.subtitleId })
          });
          state.playback = { tv: tv, title: mediaTitle(media), mediaId: media.id, duration: media.durationSec || 0, playing: false, seekable: false };
          updateRemoteUi();
          u.showToast("Filme enviado para " + tv.name + ".", false, true);
        } catch (err) {
          u.showToast("Erro no DLNA Push: " + err.message, true);
        }
      }

      document.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!(t instanceof Element)) return;
        if (elConn.open && !elConn.contains(t)) elConn.open = false;
        if (t === elQrModal) { closeQrModal(); return; }
        if (t === elSheetBackdrop) { closeRemoteSheet(); return; }
        var btn = t.closest("button");
        if (!btn || btn.disabled) return;

        if (btn.matches("[data-open-qr]")) { openQrModal(); return; }
        if (btn.matches("[data-close-qr]")) { closeQrModal(); return; }
        if (btn.matches("[data-open-sheet]")) { openRemoteSheet(); return; }
        if (btn.matches("[data-close-sheet]")) { closeRemoteSheet(); return; }
        if (btn.matches("[data-tv-id]")) { act.selectTv(btn.getAttribute("data-tv-id")); return; }
        if (btn.matches("[data-player-stop]") && state.playback) { act.sendCastControl("STOP", undefined, state.playback.tv); return; }
        var session = playerSession();
        if (btn.matches("[data-player-skip]")) { skipBy(Number(btn.getAttribute("data-player-skip"))); return; }
        if (btn.matches("[data-session-action]") && session) { togglePlayback(session); return; }
        if (btn.matches("[data-session-action], [data-send-selection]")) {
          if (!sel.getSelectedTv()) { $("btn-scan-tvs").click(); return; }
          if (!sel.getSelectedMedia()) {
            var film = document.querySelector(".lib-card");
            if (film) film.focus();
            else hooks.openScanDrawer();
            return;
          }
          var cMode = contextMode();
          if (cMode === "roku") withBusy(btn, launchRoku);
          else if (cMode === "dlna") withBusy(btn, pushDlna);
          else act.castSelectedMedia();
          return;
        }
        if (btn.matches("[data-cast-load]")) { act.castSelectedMedia(); return; }
        if (btn.matches("[data-toggle-play]")) { act.sendCastControl(btn.getAttribute("aria-label") === "Pausar na TV" ? "PAUSE" : "PLAY"); return; }
        if (btn.matches("[data-volume-step]")) {
          var next = Math.round((state.castVolume + Number(btn.getAttribute("data-volume-step"))) * 10) / 10;
          act.sendCastControl("VOLUME", Math.max(0, Math.min(1, next)));
          return;
        }
        if (btn.matches("[data-cast-action]")) {
          var action = btn.getAttribute("data-cast-action");
          var raw = btn.getAttribute("data-cast-value");
          if (action === "SUBTITLE_ON") subtitleMode = "on";
          if (action === "SUBTITLE_OFF") subtitleMode = "off";
          act.sendCastControl(action, raw !== null ? Number(raw) : undefined);
          return;
        }
        if (btn.matches("[data-roku-key]")) { sendRokuKey(btn.getAttribute("data-roku-key")); return; }
        if (btn.matches("[data-roku-launch]")) { withBusy(btn, launchRoku); return; }
        if (btn.matches("[data-dlna-push]")) { withBusy(btn, pushDlna); return; }
        if (btn.matches("[data-set-active]")) { withBusy(btn, setActiveDlna); return; }
      });

      elTvQuick.addEventListener("change", function () { act.selectTv(elTvQuick.value); });
      document.addEventListener("change", function (ev) {
        var input = ev.target;
        var session = playerSession();
        if (!(input instanceof HTMLInputElement) || !session) return;
        if (input.matches("[data-player-seek]")) { skipQueue.cancel(); seekTo(session, Number(input.value)); return; }
        if (session.tv.protocol === "google-cast" && input.matches("[data-player-volume]")) act.sendCastControl("VOLUME", Number(input.value) / 100, session.tv);
      });

      $("btn-scan-tvs").addEventListener("click", async function () {
        var btn = this;
        scanning = true;
        updateRemoteUi();
        var label = btn.querySelector(".js-label");
        btn.disabled = true;
        btn.classList.add("is-busy");
        if (label) label.textContent = "Buscando…";
        try {
          await act.loadTvs(true);
        } finally {
          btn.disabled = false;
          scanning = false;
          updateRemoteUi();
          btn.classList.remove("is-busy");
          if (label) label.textContent = "Buscar TVs";
        }
      });

      $("btn-copy-url").addEventListener("click", async function () {
        try {
          await u.copyText(state.network.panelUrl);
          u.showToast("URL copiada: " + state.network.panelUrl);
        } catch (_) {
          u.showToast("Não foi possível copiar automaticamente.", true);
        }
      });

      /* ---------- Web Receiver drawer ---------- */
      elSecReceiver.addEventListener("toggle", function () {
        if (elSecReceiver.open) {
          var media = sel.getSelectedMedia();
          if (media && state.previewLoadedMediaId !== media.id) loadLocalPreview(media, 0, false);
        } else {
          elPreview.pause();
        }
      });

      $("btn-open-receiver").addEventListener("click", function () { window.open("/receiver", "_blank", "noopener"); });

      $("btn-ws-load").addEventListener("click", function () {
        var media = sel.getSelectedMedia();
        if (!media) { u.showToast("Selecione um filme primeiro.", true); return; }
        var choice = sel.getTrackChoice(media);
        if (act.sendWs({
          type: "command",
          command: "load",
          mediaId: media.id,
          title: mediaTitle(media),
          audioStreamIndex: choice.audioStreamIndex,
          subtitleId: choice.subtitleId,
          startSec: getPreviewPositionSec(),
          durationSec: media.durationSec || 0,
          canDirectPlay: sel.isDirectPlaySelected(media, choice.audioStreamIndex)
        })) {
          state.playback = null;
          state.remoteMediaId = media.id;
          state.remoteTitle = mediaTitle(media);
          state.remoteState = "loading";
          updateRemoteUi();
          u.showToast("Filme enviado ao Web Receiver.");
        }
      });

      $("btn-ws-play").addEventListener("click", function () {
        act.sendWs({ type: "command", command: "play" });
        if (elSecReceiver.open) elPreview.play().catch(function () {});
      });

      $("btn-ws-pause").addEventListener("click", function () {
        act.sendWs({ type: "command", command: "pause" });
        elPreview.pause();
      });

      elSeek.addEventListener("input", function () {
        state.isSeeking = true;
        elTime.textContent = u.formatTime(Number(elSeek.value || 0)) + " / " + u.formatTime(Number(elSeek.max || 0));
      });

      elSeek.addEventListener("change", function () {
        state.isSeeking = false;
        var target = Number(elSeek.value || 0);
        var media = sel.getSelectedMedia();
        if (media && elSecReceiver.open) {
          var choice = sel.getTrackChoice(media);
          if (sel.isDirectPlaySelected(media, choice.audioStreamIndex) && state.previewOffsetSec === 0) {
            elPreview.currentTime = target;
          } else {
            loadLocalPreview(media, target, !elPreview.paused);
          }
        }
        if (state.wsConnected) act.sendWs({ type: "command", command: "seek", positionSec: target });
      });

      elPreview.addEventListener("timeupdate", function () {
        if (state.isSeeking) return;
        var media = sel.getSelectedMedia();
        var dur = (media && media.durationSec) || elPreview.duration || 0;
        var pos = state.previewOffsetSec + (elPreview.currentTime || 0);
        if (dur > 0) {
          elSeek.max = String(Math.floor(dur));
          elSeek.value = String(Math.min(Math.floor(dur), Math.floor(pos)));
          elTime.textContent = u.formatTime(pos) + " / " + u.formatTime(dur);
        }
      });

      hooks.renderTvs = renderTvs;
      hooks.updateRemoteUi = updateRemoteUi;
      hooks.loadLocalPreview = loadLocalPreview;
      hooks.applyPreviewSubtitle = applyPreviewSubtitle;
      hooks.getPreviewPositionSec = getPreviewPositionSec;
      hooks.openRemoteSheet = openRemoteSheet;
      hooks.closeRemoteSheet = closeRemoteSheet;
      hooks.openQrModal = openQrModal;
      hooks.closeQrModal = closeQrModal;
    })();
`;

/* ------------------------------------------------------------------------------------------------
 * Server-rendered control blocks. `variant === "panel"` carries the element ids; the sheet copy is
 * id-less and kept in sync by `updateRemoteUi()` through `data-*` attributes.
 * ---------------------------------------------------------------------------------------------- */

function idAttr(variant: ControlVariant, id: string): string {
  return variant === "panel" ? ` id="${id}"` : "";
}

function castControlsHtml(variant: ControlVariant): string {
  const presets = VOLUME_PRESETS.map(
    (p) =>
      `<button type="button" class="btn rm-preset" data-cast-ctl data-volume-preset data-cast-action="VOLUME" data-cast-value="${p.value}" aria-pressed="false">${p.label}</button>`
  ).join("");
  const head =
    variant === "panel"
      ? `
            <div class="rm-ctx-head">
              <strong>${ICONS.cast}<span data-cast-tv-name>Google Cast</span></strong>
              <span class="rm-mono" id="cast-target-badge">Sem TV Cast</span>
            </div>`
      : "";
  return `
          <div class="rm-ctx"${idAttr(variant, "ctl-cast")} data-ctx="cast">${head}
            <button type="button" class="btn btn-primary btn-block rm-cta"${idAttr(variant, "btn-cast-load")} data-cast-load disabled>${ICONS.cast}<span class="js-cast-label">Transmitir para TV</span></button>
            <p class="rm-hint"${idAttr(variant, "cast-status-hint")} data-cast-hint aria-live="polite">Selecione um filme pronto e uma TV Google Cast.</p>
            <div class="rm-transport" role="group" aria-label="Reprodução na TV">
              <button type="button" class="btn rm-round" data-cast-ctl data-cast-action="STOP" aria-label="Parar">${ICONS.stop}</button>
              <button type="button" class="btn rm-toggle" data-cast-ctl data-toggle-play aria-label="Reproduzir na TV">${ICONS.play}</button>
              <span class="rm-state" data-remote-state data-state="idle">Ocioso</span>
            </div>
            <div class="rm-vol" role="group" aria-label="Volume da TV">
              <div class="rm-vol-row">
                <button type="button" class="btn rm-round" data-cast-ctl data-volume-step="-0.1" aria-label="Diminuir volume">${ICONS.minus}</button>
                <div class="rm-vol-readout">
                  <span class="rm-vol-value"${idAttr(variant, "cast-volume-label")} data-volume-label aria-live="polite">50%</span>
                  <span class="rm-vol-meter" aria-hidden="true"><span data-volume-meter></span></span>
                </div>
                <button type="button" class="btn rm-round" data-cast-ctl data-volume-step="0.1" aria-label="Aumentar volume">${ICONS.plus}</button>
              </div>
              <div class="rm-presets">${presets}</div>
            </div>
            <div class="rm-seg" role="group" aria-label="Legendas na TV">
              <button type="button" class="btn rm-seg-btn" data-cast-ctl data-cast-action="SUBTITLE_ON" data-sub-mode="on" aria-pressed="false">${ICONS.subtitles}<span>Legenda ON</span></button>
              <button type="button" class="btn rm-seg-btn" data-cast-ctl data-cast-action="SUBTITLE_OFF" data-sub-mode="off" aria-pressed="false"><span>Legenda OFF</span></button>
            </div>
          </div>`;
}

function rokuControlsHtml(variant: ControlVariant): string {
  return `
          <div class="rm-ctx"${idAttr(variant, "ctl-roku")} data-ctx="roku" hidden>
            <div class="rm-ctx-head">
              <strong>${ICONS.tv}<span>Roku ECP</span></strong>
              <span class="rm-mono" data-roku-name>Nenhuma Roku selecionada</span>
            </div>
            <div class="rm-alert"${idAttr(variant, "roku-limited-alert")} data-roku-limited role="note" hidden>
              ${ICONS.alert}
              <div><strong>Roku em modo limitado</strong>Libere o controle pela rede na TV:<span class="rm-path">${ROKU_SETTINGS_PATH}</span></div>
            </div>
            <button type="button" class="btn btn-primary btn-block rm-cta"${idAttr(variant, "btn-roku-launch")} data-roku-launch>${ICONS.play}<span>Abrir Roku Media Player</span></button>
            <div class="rm-dpad" role="group" aria-label="Direcional Roku">
              <button type="button" class="btn rm-dpad-btn rm-dpad-up" data-roku-key="Up" aria-label="Cima">${ICONS.arrowUp}</button>
              <button type="button" class="btn rm-dpad-btn rm-dpad-left" data-roku-key="Left" aria-label="Esquerda">${ICONS.arrowLeft}</button>
              <button type="button" class="btn rm-dpad-ok" data-roku-key="Select" aria-label="OK">OK</button>
              <button type="button" class="btn rm-dpad-btn rm-dpad-right" data-roku-key="Right" aria-label="Direita">${ICONS.arrowRight}</button>
              <button type="button" class="btn rm-dpad-btn rm-dpad-down" data-roku-key="Down" aria-label="Baixo">${ICONS.arrowDown}</button>
            </div>
            <div class="rm-keys" role="group" aria-label="Teclas de mídia Roku">
              <button type="button" class="btn rm-round" data-roku-key="Back" aria-label="Voltar">${ICONS.back}</button>
              <button type="button" class="btn rm-round" data-roku-key="Rev" aria-label="Retroceder">${ICONS.rewind}</button>
              <button type="button" class="btn rm-round" data-roku-key="Play" aria-label="Play/Pause">${ICONS.play}</button>
              <button type="button" class="btn rm-round" data-roku-key="Fwd" aria-label="Avançar">${ICONS.forward}</button>
              <button type="button" class="btn rm-round" data-roku-key="Home" aria-label="Início">${ICONS.home}</button>
            </div>
          </div>`;
}

function dlnaControlsHtml(variant: ControlVariant): string {
  return `
          <div class="rm-ctx"${idAttr(variant, "ctl-dlna")} data-ctx="dlna" hidden>
            <div class="rm-ctx-head">
              <strong>${ICONS.wifi}<span data-dlna-name>DLNA DMR</span></strong>
            </div>
            <button type="button" class="btn btn-primary btn-block rm-cta"${idAttr(variant, "btn-dlna-push")} data-dlna-push disabled>${ICONS.cast}<span>Transmitir para TV</span></button>
            <button type="button" class="btn btn-block"${idAttr(variant, "btn-set-active")} data-set-active>${ICONS.check}<span>Definir como Filme Ativo no DLNA</span></button>
            <p class="rm-hint"${idAttr(variant, "dlna-push-hint")} data-dlna-hint aria-live="polite">Selecione um renderizador DLNA DMR para habilitar o envio direto.</p>
          </div>`;
}

export function renderRemoteFragments(ctx: ControllerRenderContext): RemoteFragments {
  const topbarHtml = `
    <header class="topbar">
      <div class="brand">
        <img class="brand-camera" width="706" height="787" src="/assets/camera.png" alt="">
        <div class="brand-text">
          <h1>Stream to My TV</h1>
          <div class="brand-url" id="header-url">${ctx.escapedPanelUrl}</div>
        </div>
      </div>
      <div class="topbar-actions">
        <button type="button" class="btn btn-pill btn-pair" id="btn-pair" data-open-qr aria-haspopup="dialog" aria-controls="qr-modal" aria-label="Parear celular">${ICONS.qr}<span class="btn-label">Parear celular</span></button>
        <details class="conn is-pending" id="conn-status">
          <summary id="conn-summary" aria-label="Status da conexão: Conectando ao servidor…"><span class="conn-dot" aria-hidden="true"></span><span id="conn-label">LAN</span></summary>
          <div class="conn-pop">
            <div class="conn-status-row"><span class="conn-dot" aria-hidden="true"></span><span id="conn-detail">Conectando ao servidor…</span></div>
            <dl class="conn-meta">
              <dt>Rede</dt><dd>${ctx.lanBadge}</dd>
              <dt>Interface</dt><dd>${ctx.lanMeta}</dd>
              <dt>Painel</dt><dd id="conn-panel-url">${ctx.escapedPanelUrl}</dd>
              <dt>Canal</dt><dd>WebSocket /ws · <span id="conn-ws-state">offline</span></dd>
            </dl>
          </div>
        </details>
      </div>
    </header>`;

  const sideColumnHtml = `
        <section class="panel aside-session" aria-label="Filme no player">
          <button type="button" class="player-cover" data-open-sheet aria-controls="remote-sheet" aria-expanded="false">
            <span class="player-cover-title">Escolha um filme</span>
          </button>
          <p data-player-caption>Nenhuma TV selecionada</p>
        </section>
        <section class="panel" id="tv-panel" aria-labelledby="tv-panel-title">
          <div class="panel-header">
            <div>
              <h2 class="panel-title" id="tv-panel-title">TVs na rede</h2>
              <p class="panel-sub">Escolha onde assistir</p>
            </div>
            <button type="button" class="btn btn-sm btn-pill" id="btn-scan-tvs">${ICONS.refresh}<span class="js-label">Buscar TVs</span></button>
          </div>
          <div class="rm-tv-list" id="tv-list"><div class="empty">Procurando TVs na rede local…</div></div>
          <details class="rm-box" id="tv-control-box"><summary>Controle remoto</summary>
            ${castControlsHtml("panel")}
            ${rokuControlsHtml("panel")}
            ${dlnaControlsHtml("panel")}
          </details>
        </section>

        <section class="panel rm-secondary" id="secondary-panel" aria-label="Modos secundários">
          <div class="rm-eyebrow">Modos secundários</div>
          <details class="rm-acc" id="sec-receiver">
            <summary><span class="rm-acc-title">${ICONS.externalLink}<span>Web Receiver &amp; Preview Local</span><span class="badge" id="receiver-state-label">Ocioso</span></span>${ICONS.chevronDown}</summary>
            <div class="rm-acc-body">
              <div class="row">
                <button type="button" class="btn btn-sm" id="btn-open-receiver">${ICONS.externalLink}<span>Abrir /receiver</span></button>
                <button type="button" class="btn btn-sm" id="btn-ws-load">${ICONS.cast}<span>Enviar ao Receiver</span></button>
                <button type="button" class="btn btn-sm btn-icon" id="btn-ws-play" aria-label="Reproduzir no Receiver">${ICONS.play}</button>
                <button type="button" class="btn btn-sm btn-icon" id="btn-ws-pause" aria-label="Pausar no Receiver">${ICONS.pause}</button>
              </div>
              <div class="rm-seek">
                <input type="range" id="seek-slider" min="0" max="100" value="0" step="1" aria-label="Posição do vídeo">
                <span class="rm-time" id="time-label">00:00 / 00:00</span>
              </div>
              <video id="local-preview" class="rm-preview" controls playsinline crossorigin="anonymous">
                <track id="local-subtitle-track" kind="subtitles" label="Legendas" default>
              </video>
            </div>
          </details>
          <details class="rm-acc" id="sec-dlna">
            <summary><span class="rm-acc-title">${ICONS.wifi}<span>DLNA MediaServer</span></span>${ICONS.chevronDown}</summary>
            <div class="rm-acc-body">
              <p class="rm-hint">TVs sem Cast podem abrir o filme ativo pela fonte de mídia DLNA no próprio menu da TV.</p>
              <button type="button" class="btn btn-block" id="btn-set-active-drawer" data-set-active>${ICONS.check}<span>Definir como Filme Ativo no DLNA</span></button>
            </div>
          </details>
          <details class="rm-acc" id="sec-roku" hidden>
            <summary><span class="rm-acc-title">${ICONS.tv}<span>Roku ECP</span></span>${ICONS.chevronDown}</summary>
            <div class="rm-acc-body">
              <p class="rm-hint">Selecione uma Roku para usar o direcional e as teclas de mídia.</p>
              <div class="rm-roku-links" id="sec-roku-list"></div>
            </div>
          </details>
        </section>`;

  const playerSeek = `<div class="player-seek">
    <span data-player-position>00:00</span>
    <input type="range" data-player-seek min="0" max="1" value="0" aria-label="Posição do filme na TV" disabled>
    <span data-player-duration>00:00</span>
  </div>`;
  const playerVolume = `<label class="player-volume">${ICONS.volumeOn}<span class="sr-only">Volume da reprodução na TV</span>
    <input data-player-volume type="range" min="0" max="100" value="50" disabled></label>`;
  const overlaysHtml = `
  <div class="now-playing player-bar" id="now-playing" role="region" aria-label="Sessão de transmissão">
    <div class="np-progress" aria-hidden="true"><span id="np-progress-bar"></span></div>
    <button type="button" class="np-info" data-open-sheet aria-controls="remote-sheet" aria-expanded="false" aria-label="Abrir controle remoto" title="Abrir controle remoto">
      <span class="np-art index-art" aria-hidden="true"></span>
      <span class="np-text">
        <span class="now-playing-title" id="now-playing-title">Nenhum filme selecionado</span>
        <span class="now-playing-sub" id="now-playing-sub">Nenhuma TV</span>
      </span>
    </button>
    <div class="player-transport">
      <button type="button" class="btn btn-primary np-btn" id="session-action" data-session-action aria-label="Reproduzir" disabled>${ICONS.play}</button>
      ${playerSeek}
    </div>
    <div class="player-output">
        <div class="tv-pill-wrap">
          ${ICONS.tv}
          <label class="sr-only" for="tv-quick-select">TV para a próxima transmissão</label>
          <select class="select tv-pill" id="tv-quick-select" disabled><option value="">Nenhuma TV</option></select>
        </div>
        ${playerVolume}
    </div>
  </div>

  <div class="sheet-backdrop" id="remote-sheet-backdrop" hidden></div>
  <div class="sheet-panel" id="remote-sheet" role="dialog" aria-modal="true" aria-labelledby="remote-sheet-title" hidden>
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="modal-header">
      <h2 class="panel-title" id="remote-sheet-title">Player</h2>
      <button type="button" class="btn btn-icon btn-ghost" data-close-sheet aria-label="Fechar controle remoto">${ICONS.close}</button>
    </div>
    <div class="rm-sheet-body">
      <div class="player-cover player-art" aria-hidden="true"><span class="player-cover-title"></span></div>
      <div class="rm-sheet-media">
        <div class="rm-sheet-media-text">
          <span class="rm-sheet-media-title" id="sheet-media-title">Nenhum filme selecionado</span>
          <span class="rm-sheet-media-sub" id="sheet-media-sub">Nenhuma TV</span>
        </div>
      </div>
      <div class="player-expanded-transport">
        ${playerSeek}
        <div class="player-skip-row">
          <button type="button" class="btn rm-round player-skip" data-player-skip="-${SKIP_BACK_SEC}" aria-label="Voltar ${SKIP_BACK_SEC} segundos" hidden>${ICONS.rewind}<span class="player-skip-num" aria-hidden="true">${SKIP_BACK_SEC}</span></button>
          <button type="button" class="btn btn-primary np-btn player-skip-play" data-session-action aria-label="Reproduzir">${ICONS.play}</button>
          <button type="button" class="btn rm-round player-skip" data-player-skip="${SKIP_FORWARD_SEC}" aria-label="Avançar ${SKIP_FORWARD_SEC} segundos" hidden>${ICONS.forward}<span class="player-skip-num" aria-hidden="true">${SKIP_FORWARD_SEC}</span></button>
        </div>
        <button type="button" class="btn btn-primary btn-block rm-cta" data-send-selection data-player-send>${ICONS.cast}<span>Assistir na TV</span></button>
        <button type="button" class="btn rm-round" data-player-stop aria-label="Parar na TV" hidden>${ICONS.stop}</button>
        ${playerVolume}
      </div>
      <div class="rm-chips" id="sheet-tv-list" role="group" aria-label="Trocar TV" hidden></div>
      <details data-ctx="cast"><summary>Controles da TV selecionada</summary>${castControlsHtml("sheet")}</details>
      ${rokuControlsHtml("sheet")}
      ${dlnaControlsHtml("sheet")}
    </div>
  </div>

  <div class="modal-backdrop" id="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title" hidden>
    <div class="modal-dialog qr-dialog">
      <div class="modal-header">
        <h2 class="panel-title" id="qr-modal-title">Parear celular</h2>
        <button type="button" class="btn btn-icon btn-ghost" data-close-qr data-autofocus aria-label="Fechar">${ICONS.close}</button>
      </div>
      <div class="stack">
        <div class="qr-frame" id="qr-frame">${ctx.qrSvg}</div>
        <code class="qr-url" id="lan-url-text">${ctx.escapedPanelUrl}</code>
        <button type="button" class="btn btn-primary btn-block" id="btn-copy-url">${ICONS.copy}<span>Copiar URL da LAN</span></button>
        <ol class="qr-steps">
          <li>Conecte o celular ao mesmo Wi-Fi deste computador.</li>
          <li>Aponte a câmera para o código e abra o link.</li>
        </ol>
        <p class="panel-sub">Interface ${ctx.lanMeta} · funciona sem internet.</p>
      </div>
    </div>
  </div>`;

  return { css: REMOTE_CSS, topbarHtml, sideColumnHtml, overlaysHtml, clientScript: REMOTE_SCRIPT };
}
