import { CINEMA_CSS } from "./cinema";
import { renderQrSvg } from "../qr";
import type { LanInterface } from "../types";
import type { ControllerRenderContext } from "./contract";
import { renderLibraryFragment } from "./library";
import { renderRemoteFragments } from "./remote";
import { escapeHtml, ICONS, jsonForScript, SHARED_CSS } from "./shared";

const PANEL_URL_PLACEHOLDER = "__STTV_PANEL_URL_JSON__";
const ICONS_PLACEHOLDER = "__STTV_ICONS_JSON__";

/**
 * Browser runtime shared by every controller feature module. See `ClientRuntime` in
 * `./contract.ts` for the documented shape. Plain ES2017, no `${` sequences.
 */
const RUNTIME_SCRIPT = String.raw`
    (function () {
      function noop() {}

      var state = {
        items: [],
        libraryLoaded: false,
        tvs: [],
        network: {
          panelUrl: __STTV_PANEL_URL_JSON__,
          suggestedDownloadsDir: null,
          lastScannedPaths: []
        },
        selectedMediaId: null,
        selectedTvId: null,
        trackSelection: {},
        previewOffsetSec: 0,
        previewLoadedMediaId: null,
        remotePositionSec: 0,
        remoteDurationSec: 0,
        remoteState: "idle",
        remoteMediaId: null,
        remoteTitle: null,
        isPlaying: false,
        castVolume: 0.5,
        playback: null,
        castLoading: false,
        isSeeking: false,
        ws: null,
        wsConnected: false,
        wsReconnectTimer: null,
        downloadPollTimer: null,
        isRefreshing: false,
        lastRefreshedAt: null
      };

      var hooks = {
        renderLibrary: noop,
        renderQuickPaths: noop,
        updateDownloadMonitor: noop,
        openScanDrawer: noop,
        renderTvs: noop,
        updateRemoteUi: noop,
        loadLocalPreview: noop,
        applyPreviewSubtitle: noop,
        getPreviewPositionSec: function () { return 0; },
        openRemoteSheet: noop,
        closeRemoteSheet: noop,
        openQrModal: noop,
        closeQrModal: noop
      };

      function callHook(name) {
        var fn = hooks[name];
        if (typeof fn !== "function") return undefined;
        try {
          return fn.apply(null, Array.prototype.slice.call(arguments, 1));
        } catch (err) {
          if (window.console) console.error("[STTV] hook " + name + " failed", err);
          return undefined;
        }
      }

      /* ---------- utils ---------- */
      var toastTimer = null;
      function showToast(message, isError, confirmed) {
        var el = document.getElementById("toast");
        if (!el) return;
        el.textContent = String(message == null ? "" : message);
        el.className = "toast show" + (isError ? " error" : confirmed ? " confirmed" : "");
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.className = "toast"; }, 3400);
      }

      function esc(str) {
        return String(str == null ? "" : str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return "0 B";
        var units = ["B", "KB", "MB", "GB", "TB"];
        var v = bytes;
        var idx = 0;
        while (v >= 1024 && idx < units.length - 1) { v /= 1024; idx++; }
        return v.toFixed(idx >= 2 ? 2 : 0) + " " + units[idx];
      }

      function formatTime(sec) {
        if (!Number.isFinite(sec) || sec <= 0) return "00:00";
        var total = Math.floor(sec);
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        var mm = String(m).padStart(2, "0");
        var ss = String(s).padStart(2, "0");
        return h > 0 ? String(h).padStart(2, "0") + ":" + mm + ":" + ss : mm + ":" + ss;
      }

      async function apiJson(url, options) {
        var res = await fetch(url, Object.assign({
          headers: { "Content-Type": "application/json" }
        }, options || {}));
        var text = await res.text();
        var data = {};
        if (text) {
          try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
        }
        if (!res.ok) {
          throw new Error((data && (data.error || data.message)) || ("HTTP " + res.status));
        }
        return data;
      }

      async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return;
        }
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (!ok) throw new Error("copy failed");
      }

      /* ---------- selectors ---------- */
      function getSelectedMedia() {
        return state.items.find(function (m) { return m.id === state.selectedMediaId; }) || null;
      }

      function getSelectedTv() {
        return state.tvs.find(function (t) { return t.id === state.selectedTvId; }) || null;
      }

      function getCastTargetTv() {
        var selected = getSelectedTv();
        if (selected && selected.protocol === "google-cast") return selected;
        return state.tvs.find(function (t) { return t.protocol === "google-cast"; }) || null;
      }

      function getTrackChoice(media) {
        if (!media) return { audioStreamIndex: null, subtitleId: null };
        var existing = state.trackSelection[media.id];
        var audioTracks = media.audioTracks || [];
        var subtitleTracks = media.subtitleTracks || [];
        var validAudio = Boolean(existing) && (
          existing.audioStreamIndex === null
            ? audioTracks.length === 0
            : audioTracks.some(function (a) { return a.streamIndex === existing.audioStreamIndex; })
        );
        var validSub = Boolean(existing) && (
          existing.subtitleId === null ||
          subtitleTracks.some(function (s) { return s.id === existing.subtitleId; })
        );
        if (!validAudio || !validSub) {
          var defaultAudio = audioTracks.length > 0 ? audioTracks[0].streamIndex : null;
          var preferredSub = subtitleTracks.find(function (s) {
            return /pt|por|br/i.test(s.language || "") || /pt|por|br/i.test(s.title || "");
          }) || subtitleTracks[0] || null;
          state.trackSelection[media.id] = {
            audioStreamIndex: validAudio ? existing.audioStreamIndex : defaultAudio,
            subtitleId: validSub ? existing.subtitleId : (preferredSub ? preferredSub.id : null)
          };
        }
        return state.trackSelection[media.id];
      }

      function isDirectPlaySelected(media, audioStreamIndex) {
        if (!media || !media.canDirectPlayDefault) return false;
        if (!media.audioTracks || media.audioTracks.length === 0) return true;
        return audioStreamIndex === null || audioStreamIndex === media.audioTracks[0].streamIndex;
      }

      function buildStreamUrl(mediaId, audioStreamIndex, startSec) {
        var params = new URLSearchParams();
        if (audioStreamIndex !== null && audioStreamIndex !== undefined) {
          params.set("audio", String(audioStreamIndex));
        }
        if (startSec && startSec > 0) params.set("start", String(Math.floor(startSec)));
        var qs = params.toString();
        return "/stream/" + encodeURIComponent(mediaId) + (qs ? "?" + qs : "");
      }

      function buildSubtitleUrl(mediaId, subtitleId, startSec) {
        if (!subtitleId) return "";
        var suffix = String(subtitleId).endsWith(".vtt") ? String(subtitleId) : (subtitleId + ".vtt");
        var qs = startSec && startSec > 0 ? "?start=" + Math.floor(startSec) : "";
        return "/subtitles/" + encodeURIComponent(mediaId) + "/" + encodeURIComponent(suffix) + qs;
      }

      /* ---------- actions ---------- */
      function repairMediaSelection(preferredId) {
        var items = state.items;
        if (preferredId && items.some(function (m) { return m.id === preferredId; })) {
          state.selectedMediaId = preferredId;
        } else if (!state.selectedMediaId || !items.some(function (m) { return m.id === state.selectedMediaId; })) {
          state.selectedMediaId = items[0] ? items[0].id : null;
        }
      }

      function renderMediaViews() {
        callHook("renderLibrary");
        callHook("updateDownloadMonitor");
        callHook("updateRemoteUi");
      }

      function sendWs(payload) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          showToast("WebSocket desconectado.", true);
          return false;
        }
        state.ws.send(JSON.stringify(payload));
        return true;
      }

      function connectWs() {
        if (state.wsReconnectTimer) {
          clearTimeout(state.wsReconnectTimer);
          state.wsReconnectTimer = null;
        }
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        var ws = new WebSocket(proto + "//" + location.host + "/ws");
        state.ws = ws;

        ws.addEventListener("open", function () {
          state.wsConnected = true;
          ws.send(JSON.stringify({ type: "register", role: "controller" }));
          callHook("updateRemoteUi");
        });

        ws.addEventListener("message", function (ev) {
          var msg;
          try { msg = JSON.parse(ev.data); } catch (_) { return; }
          if (!msg || msg.type !== "status") return;
          var pos = Number(msg.positionSec || 0);
          var dur = Number(msg.durationSec || 0);
          state.remotePositionSec = Number.isFinite(pos) ? pos : 0;
          if (dur > 0) state.remoteDurationSec = dur;
          if (msg.state) {
            state.remoteState = String(msg.state);
            state.isPlaying = msg.state === "playing";
          }
          if (msg.mediaId !== undefined) state.remoteMediaId = msg.mediaId ? String(msg.mediaId) : null;
          if (msg.title !== undefined) state.remoteTitle = msg.title ? String(msg.title) : null;
          callHook("updateRemoteUi");
        });

        ws.addEventListener("close", function () {
          state.wsConnected = false;
          if (state.ws === ws) state.ws = null;
          callHook("updateRemoteUi");
          state.wsReconnectTimer = setTimeout(connectWs, 2000);
        });
      }

      async function loadNetwork() {
        try {
          var data = await apiJson("/api/network", { method: "GET" });
          var panelUrl = data.panelUrl || (data.baseUrl ? data.baseUrl + "/" : state.network.panelUrl);
          state.network = {
            panelUrl: panelUrl,
            suggestedDownloadsDir: data.suggestedDownloadsDir || null,
            lastScannedPaths: Array.isArray(data.lastScannedPaths) ? data.lastScannedPaths : []
          };
        } catch (_) {
          /* keep server-rendered defaults */
        }
        callHook("renderQuickPaths");
        callHook("updateRemoteUi");
      }

      function setLibraryItems(items, preferredId) {
        state.libraryLoaded = true;
        state.items = Array.isArray(items) ? items : [];
        repairMediaSelection(preferredId || null);
        renderMediaViews();
        var media = getSelectedMedia();
        if (media && state.previewLoadedMediaId !== media.id) callHook("loadLocalPreview", media, 0, false);
      }

      async function loadLibrary() {
        try {
          var data = await apiJson("/api/library", { method: "GET" });
          var items = Array.isArray(data) ? data : (data.items || data.media || []);
          if (Array.isArray(data.lastScannedPaths)) {
            state.network.lastScannedPaths = data.lastScannedPaths;
            callHook("renderQuickPaths");
          }
          var sessionMediaId = !state.selectedMediaId && data.session ? data.session.mediaId : null;
          setLibraryItems(items, sessionMediaId);
        } catch (err) {
          state.libraryLoaded = true;
          showToast("Erro ao carregar biblioteca: " + err.message, true);
          renderMediaViews();
        }
      }

      async function refreshLibrary(silent) {
        if (state.isRefreshing) return;
        state.isRefreshing = true;
        var prevDownloading = new Set(
          state.items
            .filter(function (m) { return m.downloadStatus && m.downloadStatus.ready === false; })
            .map(function (m) { return m.id; })
        );
        try {
          var data = await apiJson("/api/library/refresh", { method: "POST", body: "{}" });
          var items = Array.isArray(data.items) ? data.items : [];
          state.lastRefreshedAt = data.refreshedAt || Math.floor(Date.now() / 1000);
          if (Array.isArray(data.lastScannedPaths)) {
            state.network.lastScannedPaths = data.lastScannedPaths;
            callHook("renderQuickPaths");
          }
          var newlyReady = items.find(function (m) {
            return prevDownloading.has(m.id) && (!m.downloadStatus || m.downloadStatus.ready !== false);
          });
          setLibraryItems(items, null);
          if (newlyReady) {
            showToast((newlyReady.title || newlyReady.fileName) + " pronto para transmitir!");
          } else if (!silent) {
            showToast("Status da biblioteca atualizado.");
          }
        } catch (err) {
          if (!silent) showToast("Falha ao atualizar status: " + err.message, true);
        } finally {
          state.isRefreshing = false;
        }
      }

      async function loadTvs(triggerScan) {
        try {
          var data = await apiJson(triggerScan ? "/api/tvs/scan" : "/api/tvs", {
            method: triggerScan ? "POST" : "GET"
          });
          var tvs = Array.isArray(data) ? data : (data.tvs || data.devices || []);
          state.tvs = tvs;
          if (!state.selectedTvId || !tvs.some(function (t) { return t.id === state.selectedTvId; })) {
            var preferredCast = tvs.find(function (t) { return t.protocol === "google-cast"; });
            state.selectedTvId = preferredCast ? preferredCast.id : (tvs[0] ? tvs[0].id : null);
          }
          if (triggerScan) showToast(tvs.length + " TV(s) encontrada(s) na LAN.");
        } catch (err) {
          if (triggerScan) showToast("Erro ao buscar TVs: " + err.message, true);
        }
        callHook("renderTvs");
        callHook("updateRemoteUi");
      }

      function selectMedia(mediaId) {
        if (!mediaId || mediaId === state.selectedMediaId) return;
        if (!state.items.some(function (m) { return m.id === mediaId; })) return;
        state.selectedMediaId = mediaId;
        renderMediaViews();
        callHook("loadLocalPreview", getSelectedMedia(), 0, false);
      }

      function selectTv(tvId) {
        if (!tvId || !state.tvs.some(function (t) { return t.id === tvId; })) return;
        state.selectedTvId = tvId;
        callHook("renderTvs");
        callHook("updateRemoteUi");
      }

      async function castSelectedMedia(startSec) {
        var media = getSelectedMedia();
        if (!media) {
          showToast("Selecione um filme primeiro.", true);
          return;
        }
        if (media.downloadStatus && media.downloadStatus.ready === false) {
          showToast(media.downloadStatus.reason || "O arquivo ainda está em download.", true);
          return;
        }
        var tv = getCastTargetTv();
        var choice = getTrackChoice(media);
        var start = typeof startSec === "number" && startSec >= 0
          ? Math.floor(startSec)
          : Math.floor(Number(callHook("getPreviewPositionSec")) || 0);
        if (!tv || state.castLoading) return;
        state.castLoading = true;
        callHook("updateRemoteUi");
        try {
          await apiJson("/api/tv/cast/load", {
            method: "POST",
            body: JSON.stringify({
              tvId: tv.id, ip: tv.ip,
              mediaId: media.id,
              audioStreamIndex: choice.audioStreamIndex,
              subtitleId: choice.subtitleId,
              startSec: start
            })
          });
          state.playback = {
            tv: tv, title: media.title || media.fileName, mediaId: media.id,
            duration: Number(media.durationSec) || 0, position: start, updated: Date.now(),
            playing: true, seekable: isDirectPlaySelected(media, choice.audioStreamIndex)
          };
          showToast("Filme enviado para " + (tv ? tv.name : "a TV") + ".", false, true);
        } catch (err) {
          showToast("Erro ao transmitir via Cast: " + err.message, true);
        } finally {
          state.castLoading = false;
          callHook("updateRemoteUi");
        }
      }

      function playbackPosition(session) {
        var elapsed = session.playing ? (Date.now() - session.updated) / 1000 : 0;
        return Math.min(session.duration || Infinity, session.position + elapsed);
      }

      async function sendCastControl(action, value, target) {
        var tv = target || getCastTargetTv();
        if (!tv) return;
        var session = state.playback;
        try {
          var res = await apiJson("/api/tv/cast/control", {
            method: "POST",
            body: JSON.stringify({ tvId: tv.id, ip: tv.ip, action: action, value: value })
          });
          if (session && session === state.playback && session.tv.id === tv.id) {
            session.position = action === "SEEK" ? Number(value) : playbackPosition(session);
            session.updated = Date.now();
            if (action === "PLAY") session.playing = true;
            if (action === "PAUSE") session.playing = false;
            if (action === "STOP") state.playback = null;
          }
          if (action === "VOLUME" && typeof value === "number" && Number.isFinite(value)) {
            state.castVolume = Math.max(0, Math.min(1, value));
          }
          showToast((res && res.detail) || ("Comando " + action + " enviado para " + (tv ? tv.name : "a TV") + "."));
        } catch (err) {
          showToast("Erro Cast (" + action + "): " + err.message, true);
        } finally {
          callHook("updateRemoteUi");
        }
      }

      var initialized = false;
      function init() {
        if (initialized) return;
        initialized = true;
        renderMediaViews();
        callHook("renderQuickPaths");
        callHook("renderTvs");
        connectWs();
        loadNetwork();
        loadLibrary();
        loadTvs(false);
      }

      window.__STTV = {
        state: state,
        utils: {
          esc: esc,
          formatBytes: formatBytes,
          formatTime: formatTime,
          playbackPosition: playbackPosition,
          apiJson: apiJson,
          showToast: showToast,
          copyText: copyText
        },
        selectors: {
          getSelectedMedia: getSelectedMedia,
          getSelectedTv: getSelectedTv,
          getCastTargetTv: getCastTargetTv,
          getTrackChoice: getTrackChoice,
          isDirectPlaySelected: isDirectPlaySelected,
          buildStreamUrl: buildStreamUrl,
          buildSubtitleUrl: buildSubtitleUrl
        },
        actions: {
          sendWs: sendWs,
          loadNetwork: loadNetwork,
          loadLibrary: loadLibrary,
          refreshLibrary: refreshLibrary,
          setLibraryItems: setLibraryItems,
          loadTvs: loadTvs,
          selectMedia: selectMedia,
          selectTv: selectTv,
          castSelectedMedia: castSelectedMedia,
          sendCastControl: sendCastControl
        },
        icons: __STTV_ICONS_JSON__,
        hooks: hooks,
        init: init
      };
    })();
`;

export function buildControllerContext(lan: LanInterface, port: number): ControllerRenderContext {
  const panelUrl = `http://${lan.address}:${port}/`;
  return {
    lan,
    port,
    panelUrl,
    escapedPanelUrl: escapeHtml(panelUrl),
    lanBadge: escapeHtml(`LAN ${lan.cidr}`),
    lanMeta: escapeHtml(`${lan.name} (${lan.cidr})`),
    qrSvg: renderQrSvg(panelUrl, {
      ecc: "M",
      quietZone: 4,
      darkColor: "#000000",
      lightColor: "#ffffff",
      ariaLabel: `QR Code para parear celular em ${panelUrl}`
    })
  };
}

export function renderControllerHtml(lan: LanInterface, port: number): string {
  const ctx = buildControllerContext(lan, port);
  const library = renderLibraryFragment(ctx);
  const remote = renderRemoteFragments(ctx);
  const runtimeScript = RUNTIME_SCRIPT.replace(PANEL_URL_PLACEHOLDER, () => jsonForScript(ctx.panelUrl)).replace(
    ICONS_PLACEHOLDER,
    () => jsonForScript(ICONS)
  );

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#1a1815">
  <title>Stream to My TV — Controle LAN</title>
  <style>${SHARED_CSS}${library.css}${remote.css}${CINEMA_CSS}
  </style>
</head>
<body>
  <div class="app">
    ${remote.topbarHtml}
    <main class="layout-grid">
      <div class="col-main">
        ${library.html}
      </div>
      <div class="col-side">
        ${remote.sideColumnHtml}
      </div>
    </main>
  </div>
  ${remote.overlaysHtml}
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>${runtimeScript}</script>
  <script>${library.clientScript}</script>
  <script>${remote.clientScript}</script>
  <script>window.__STTV.init();</script>
</body>
</html>`;
}
