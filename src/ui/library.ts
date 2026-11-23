import type { ControllerRenderContext, LibraryFragment } from "./contract";
import { ICONS } from "./shared";

/**
 * Library, Scanner, Track Picker & Downloads UI — P1 Cinema Obsidian.
 * Owner: Library lane (`src/ui/library.ts`).
 * Implements hooks: renderLibrary, renderQuickPaths, updateDownloadMonitor, openScanDrawer.
 */

const LIBRARY_CSS = `
    /* Panel header refinements */
    .lib-header-main {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .lib-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .lib-count-badge {
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
      background: var(--surface-2);
      border-color: var(--border-strong);
    }
    .lib-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .btn-icon.is-spinning svg {
      animation: libSpin 0.8s linear infinite;
    }
    @keyframes libSpin {
      to { transform: rotate(360deg); }
    }

    /* Scan Drawer */
    .lib-scan {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      margin-bottom: 14px;
      transition: border-color 0.15s var(--ease), background 0.15s var(--ease);
    }
    .lib-scan:hover {
      border-color: var(--border-strong);
    }
    .lib-scan[open] {
      border-color: var(--border-strong);
      background: linear-gradient(180deg, var(--surface-2) 0%, rgba(19, 19, 22, 0.95) 100%);
    }
    .lib-scan > summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 600;
      min-height: 44px;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .lib-scan > summary::-webkit-details-marker {
      display: none;
    }
    .lib-scan-summary-left {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      color: var(--text);
    }
    .lib-scan-icon {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-xs);
      background: var(--surface-3);
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .lib-scan-icon .icon {
      width: 16px;
      height: 16px;
    }
    .lib-scan-summary-right {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex-shrink: 0;
    }
    .lib-scan-hint {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lib-scan[open] > summary .lib-chevron {
      transform: rotate(180deg);
      color: var(--text);
    }
    .lib-chevron {
      color: var(--muted);
      display: inline-flex;
      transition: transform 0.18s var(--ease), color 0.15s var(--ease);
    }
    .lib-scan-body {
      padding: 2px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-top: 1px solid rgba(39, 39, 42, 0.6);
    }
    .lib-scan-form {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .lib-scan-form .input {
      flex: 1 1 auto;
      min-width: 0;
      font-family: var(--mono);
      font-size: 13px;
    }

    /* Quick Path Tactile Pills */
    .lib-quick-paths {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .lib-chip {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 5px 12px;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      color: var(--text-secondary);
      border-radius: 999px;
      font: inherit;
      font-size: 12px;
      font-weight: 550;
      cursor: pointer;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: border-color 0.15s var(--ease), background 0.15s var(--ease), color 0.15s var(--ease), transform 0.1s var(--ease);
      -webkit-tap-highlight-color: transparent;
    }
    .lib-chip .icon {
      width: 14px;
      height: 14px;
      color: var(--accent);
      flex-shrink: 0;
    }
    .lib-chip span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lib-chip:hover {
      border-color: var(--accent);
      background: var(--surface-3);
      color: var(--text);
    }
    .lib-chip:active {
      transform: scale(0.98);
    }

    /* Compact Single-Line Download Monitor */
    .lib-monitor {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px 14px;
      padding: 10px 14px;
      margin-bottom: 14px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(245, 158, 11, 0.35);
      background: rgba(245, 158, 11, 0.09);
    }
    .lib-monitor-status {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .lib-pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
      animation: libPulse 1.8s infinite;
      flex-shrink: 0;
    }
    @keyframes libPulse {
      0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.65); }
      70% { box-shadow: 0 0 0 7px rgba(245, 158, 11, 0); }
      100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
    }
    .lib-monitor-title {
      font-weight: 650;
      font-size: 13px;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }
    .lib-monitor-sep {
      color: var(--border-strong);
      font-size: 12px;
    }
    .lib-monitor-sub {
      color: var(--muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .lib-monitor-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .lib-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 550;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
      min-height: 34px;
      padding: 4px 8px;
      border-radius: var(--radius-xs);
    }
    .lib-toggle:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.04);
    }
    .lib-toggle input {
      accent-color: var(--accent);
      width: 15px;
      height: 15px;
      margin: 0;
      cursor: pointer;
    }

    /* Movie Cards List */
    .lib-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .lib-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      padding: 11px 14px;
      cursor: pointer;
      transition: border-color 0.15s var(--ease), background 0.15s var(--ease), box-shadow 0.15s var(--ease);
      -webkit-tap-highlight-color: transparent;
    }
    .lib-card:hover {
      border-color: var(--border-strong);
      background: #1e1e24;
    }
    .lib-card.is-selected {
      border-color: var(--accent);
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, var(--surface-2) 100%);
      box-shadow: 0 0 0 1px var(--accent), 0 12px 30px -10px rgba(245, 158, 11, 0.18);
      padding: 13px 15px;
      cursor: default;
    }
    .lib-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .lib-card-title {
      font-size: 15px;
      font-weight: 650;
      line-height: 1.35;
      color: var(--text);
      overflow-wrap: anywhere;
      letter-spacing: -0.01em;
    }
    .lib-card.is-selected .lib-card-title {
      color: #ffffff;
    }
    .lib-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0;
      margin-top: 4px;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
    }
    .lib-meta-item {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
    }
    .lib-meta-item + .lib-meta-item::before {
      content: "·";
      margin: 0 7px;
      color: var(--border-strong);
      font-weight: 700;
    }
    .lib-meta-item.is-tech {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* Per-card Download Progress */
    .lib-progress-wrap {
      margin-top: 9px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .lib-progress {
      height: 5px;
      border-radius: 999px;
      background: var(--surface-3);
      overflow: hidden;
    }
    .lib-progress > div {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent) 0%, var(--accent-hover) 100%);
      transition: width 0.3s var(--ease);
    }
    .lib-reason {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    /* Selected Card Controls (Audio/Subtitle Pickers + Quick Cast & Upload) */
    .lib-card-controls {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(63, 63, 70, 0.55);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .lib-tracks {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }
    .lib-tracks .field > label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .lib-track-count {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 500;
      color: var(--muted);
      text-transform: none;
      letter-spacing: 0;
    }
    .lib-tracks .select {
      width: 100%;
      max-width: 100%;
      font-size: 13.5px;
      line-height: 1.35;
      background-color: var(--bg);
      border-color: var(--border-strong);
    }
    .lib-card-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .lib-upload {
      cursor: pointer;
    }
    .lib-upload:focus-within {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-color: var(--accent);
    }

    /* Cinema Empty State */
    .lib-empty {
      padding: 28px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 10px;
      background: rgba(27, 27, 32, 0.45);
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-sm);
    }
    .lib-empty-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--surface-2);
      border: 1px solid var(--border-strong);
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .lib-empty-title {
      font-size: 15px;
      font-weight: 650;
      color: var(--text);
    }
    .lib-empty-sub {
      font-size: 13px;
      color: var(--muted);
      max-width: 420px;
      line-height: 1.45;
    }
    .lib-empty-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 4px;
    }

    @media (max-width: 959px) {
      .lib-scan-form {
        flex-direction: column;
      }
      .lib-chip {
        min-height: 44px;
        padding: 8px 14px;
        font-size: 13px;
      }
      .lib-toggle {
        min-height: 44px;
        padding: 8px 10px;
        font-size: 13px;
      }
      .lib-tracks {
        grid-template-columns: 1fr;
      }
      .lib-tracks .select {
        font-size: 16px;
        min-height: 44px;
      }
      .lib-card-actions {
        flex-direction: column;
        align-items: stretch;
      }
      .lib-card-actions .btn,
      .lib-upload {
        width: 100%;
        min-height: 44px;
        margin-left: 0;
      }
      .lib-empty-actions {
        width: 100%;
        flex-direction: column;
        align-items: stretch;
      }
      .lib-empty-actions .btn {
        width: 100%;
      }
    }
`;

const LIBRARY_SCRIPT = String.raw`
    (function () {
      var STTV = window.__STTV;
      var state = STTV.state;
      var u = STTV.utils;
      var sel = STTV.selectors;
      var act = STTV.actions;
      var RECENT_PATHS_KEY = "sttv_recent_scan_paths";

      var elPanel = document.getElementById("library-panel");
      var elCountBadge = document.getElementById("library-count-badge");
      var elBtnRefresh = document.getElementById("btn-refresh");
      var elBtnSample = document.getElementById("btn-sample");
      var elScan = document.getElementById("scan-details");
      var elScanSummary = document.getElementById("scan-summary");
      var elScanHint = document.getElementById("scan-summary-hint");
      var elScanForm = document.getElementById("scan-form");
      var elScanPath = document.getElementById("scan-path");
      var elBtnScan = document.getElementById("btn-scan");
      var elQuickPaths = document.getElementById("quick-paths");
      var elMonitor = document.getElementById("download-monitor");
      var elMonitorTitle = document.getElementById("download-monitor-title");
      var elMonitorSub = document.getElementById("download-monitor-sub");
      var elAuto = document.getElementById("chk-auto-refresh");
      var elList = document.getElementById("movie-list");
      var userToggledScan = false;

      function readStoredPaths() {
        try {
          var raw = localStorage.getItem(RECENT_PATHS_KEY);
          var parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? parsed.filter(function (p) { return typeof p === "string" && p.trim(); }) : [];
        } catch (_) {
          return [];
        }
      }

      function rememberScannedPath(p) {
        var clean = String(p || "").trim();
        if (!clean) return;
        var merged = [clean].concat(readStoredPaths().filter(function (x) { return x !== clean; })).slice(0, 5);
        try { localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(merged)); } catch (_) {}
        if (state.network.lastScannedPaths.indexOf(clean) === -1) {
          state.network.lastScannedPaths = [clean].concat(state.network.lastScannedPaths).slice(0, 6);
        }
        renderQuickPaths();
      }

      function shortPathLabel(p) {
        var parts = String(p || "").split(/[\\/]/).filter(Boolean);
        return parts.slice(-2).join("/") || String(p || "");
      }

      function renderQuickPaths() {
        var chips = [];
        var dlDir = state.network.suggestedDownloadsDir;
        var seen = new Set();
        var folderIcon = STTV.icons.folder || "";
        if (dlDir) {
          seen.add(dlDir);
          chips.push(
            '<button type="button" class="lib-chip" data-fill-path="' + u.esc(dlDir) + '" title="' + u.esc(dlDir) + '">' +
              folderIcon + '<span>Usar pasta Downloads</span>' +
            '</button>'
          );
        }
        (state.network.lastScannedPaths || []).concat(readStoredPaths()).forEach(function (p) {
          if (!p || seen.has(p)) return;
          seen.add(p);
          var shortLabel = shortPathLabel(p);
          chips.push(
            '<button type="button" class="lib-chip" data-fill-path="' + u.esc(p) + '" title="' + u.esc(p) + '">' +
              folderIcon + '<span>Recente: ' + u.esc(shortLabel) + '</span>' +
            '</button>'
          );
        });
        elQuickPaths.innerHTML = chips.join("");
        elQuickPaths.hidden = chips.length === 0;
        if (state.libraryLoaded && state.items.length === 0) {
          renderEmptyState();
        }
      }

      function stopPolling() {
        if (!state.downloadPollTimer) return;
        clearInterval(state.downloadPollTimer);
        state.downloadPollTimer = null;
      }

      function startPolling() {
        if (state.downloadPollTimer) return;
        state.downloadPollTimer = setInterval(function () { act.refreshLibrary(true); }, 5000);
      }

      function updateDownloadMonitor() {
        var downloading = state.items.filter(function (m) { return m.downloadStatus && m.downloadStatus.ready === false; });
        if (downloading.length === 0) {
          elMonitor.hidden = true;
          stopPolling();
          return;
        }
        elMonitor.hidden = false;
        var avg = Math.round(downloading.reduce(function (acc, m) {
          return acc + Number(m.downloadStatus.estimatedProgressPct || 0);
        }, 0) / downloading.length);
        elMonitorTitle.textContent = downloading.length === 1
          ? "1 download ativo · ~" + avg + "%"
          : downloading.length + " downloads ativos · ~" + avg + "%";
        elMonitorSub.textContent = state.lastRefreshedAt
          ? "Verificado às " + new Date(state.lastRefreshedAt * 1000).toLocaleTimeString("pt-BR")
          : "Monitoramento ativo";
        if (elAuto.checked) startPolling(); else stopPolling();
      }

      function formatDurationCompact(sec) {
        if (!Number.isFinite(sec) || sec <= 0) return "";
        var total = Math.floor(sec);
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        if (h > 0) {
          return m > 0 ? (h + "h " + m + "m") : (h + "h");
        }
        if (m > 0) {
          return s > 0 && m < 10 ? (m + "m " + s + "s") : (m + "m");
        }
        return s + "s";
      }

      function formatResolutionLabel(video) {
        if (!video || !video.height) return "";
        var w = Number(video.width || 0);
        var h = Number(video.height || 0);
        var res = "";
        if (h >= 2160 || w >= 3840) res = "4K";
        else if (h >= 1440 || w >= 2560) res = "1440p";
        else if (h >= 1080 || w >= 1920) res = "1080p";
        else if (h >= 720 || w >= 1280) res = "720p";
        else if (h >= 480) res = "480p";
        else res = h + "p";
        return res;
      }

      function trackOptions(item, choice) {
        var audio = (item.audioTracks || []).map(function (a) {
          var label = "#" + a.audioOrderIndex + " " + (a.language || "und") + (a.title ? " — " + a.title : "") + " (" + a.codec + ", " + a.channels + "ch)";
          return '<option value="' + u.esc(a.streamIndex) + '"' + (choice.audioStreamIndex === a.streamIndex ? " selected" : "") + ">" + u.esc(label) + "</option>";
        }).join("");
        var subs = ['<option value="">Sem legenda</option>'].concat((item.subtitleTracks || []).map(function (s) {
          var label = (s.language || "und") + (s.title ? " — " + s.title : "") + " [" + s.kind + "]";
          return '<option value="' + u.esc(s.id) + '"' + (choice.subtitleId === s.id ? " selected" : "") + ">" + u.esc(label) + "</option>";
        })).join("");
        return { audio: audio, subs: subs };
      }

      function renderCard(item, index) {
        var selected = item.id === state.selectedMediaId;
        var choice = sel.getTrackChoice(item);
        var downloading = Boolean(item.downloadStatus && item.downloadStatus.ready === false);
        var pct = downloading ? Math.max(0, Math.min(100, Number(item.downloadStatus.estimatedProgressPct || 0))) : 100;

        var badge = downloading
          ? '<span class="badge badge-warn" data-dl-badge>Baixando ' + u.esc(pct) + '%</span>'
          : sel.isDirectPlaySelected(item, choice.audioStreamIndex)
            ? '<span class="badge badge-ready" data-mode-badge>Direct Play</span>'
            : '<span class="badge badge-info" data-mode-badge>Remux AAC</span>';

        var metaParts = [];
        var durText = formatDurationCompact(item.durationSec);
        if (durText) metaParts.push('<span class="lib-meta-item">' + u.esc(durText) + '</span>');

        var resText = formatResolutionLabel(item.video);
        if (resText) {
          metaParts.push('<span class="lib-meta-item is-tech">' + u.esc(resText) + '</span>');
        } else if (downloading) {
          metaParts.push('<span class="lib-meta-item">Aguardando cabeçalho</span>');
        }

        if (item.container) {
          metaParts.push('<span class="lib-meta-item is-tech">' + u.esc(String(item.container).toUpperCase()) + '</span>');
        }
        if (item.fileSize > 0) {
          metaParts.push('<span class="lib-meta-item">' + u.esc(u.formatBytes(item.fileSize)) + '</span>');
        }

        var audioLen = (item.audioTracks || []).length;
        var subLen = (item.subtitleTracks || []).length;
        var html = '<article class="lib-card' + (selected ? " is-selected" : "") + '" data-media-id="' + u.esc(item.id) + '" data-downloading="' + (downloading ? "1" : "0") + '" data-audio-count="' + audioLen + '" data-sub-count="' + subLen + '" tabindex="0"' + (selected ? ' aria-current="true"' : "") + '>' +
          '<div class="lib-cover jacket-' + (index % 3) + '" aria-hidden="true"><span class="jacket-format">' + u.esc(String(item.container || "Vídeo").toUpperCase()) + '</span></div>' +
          '<div class="lib-card-head">' +
            '<div class="lib-card-title">' + u.esc(item.title || item.fileName) + '</div>' +
            badge +
          '</div>' +
          '<div class="lib-meta">' + metaParts.join("") + '</div>';

        if (downloading) {
          html += '<div class="lib-progress-wrap">' +
            '<div class="lib-progress" role="progressbar" aria-label="Progresso do download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + u.esc(pct) + '" data-dl-bar-wrap>' +
              '<div data-dl-bar style="width:' + u.esc(pct) + '%"></div>' +
            '</div>' +
            '<p class="lib-reason" data-dl-reason>' + u.esc(item.downloadStatus.reason || "Cabeçalho moov/ftyp ainda não disponível.") + '</p>' +
          '</div>';
        }

        if (selected) {
          var opts = trackOptions(item, choice);
          var audioCount = (item.audioTracks || []).length;
          var subCount = (item.subtitleTracks || []).length;
          html += '<button type="button" class="btn lib-send" data-send-selection' + (downloading ? ' disabled' : '') + '>' + STTV.icons.play + '<span>Assistir na TV</span></button>' +
            '<details class="lib-card-controls"><summary>' + STTV.icons.sliders + 'Áudio e legendas</summary>' +
            '<div class="lib-tracks">' +
              '<div class="field">' +
                '<label for="audio-' + u.esc(item.id) + '">' +
                  '<span>Áudio</span>' +
                  '<span class="lib-track-count">' + (audioCount > 0 ? audioCount + (audioCount === 1 ? " faixa" : " faixas") : "0 faixas") + '</span>' +
                '</label>' +
                '<select class="select" id="audio-' + u.esc(item.id) + '" data-audio-select="' + u.esc(item.id) + '"' + (opts.audio ? "" : " disabled") + '>' +
                  (opts.audio || '<option value="">Aguardando faixas de áudio</option>') +
                '</select>' +
              '</div>' +
              '<div class="field">' +
                '<label for="sub-' + u.esc(item.id) + '">' +
                  '<span>Legenda</span>' +
                  '<span class="lib-track-count">' + (subCount > 0 ? subCount + (subCount === 1 ? " disponível" : " disponíveis") : "nenhuma") + '</span>' +
                '</label>' +
                '<select class="select" id="sub-' + u.esc(item.id) + '" data-sub-select="' + u.esc(item.id) + '">' +
                  opts.subs +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="lib-card-actions">' +
              '<label class="btn btn-sm lib-upload">' +
                STTV.icons.upload + '<span>+ Enviar legenda (.srt/.vtt)</span>' +
                '<input type="file" accept=".srt,.vtt" class="sr-only" data-sub-upload="' + u.esc(item.id) + '">' +
              '</label>' +
            '</div>' +
          '</details>';
        }

        return html + '</article>';
      }

      function renderEmptyState() {
        var dlDir = state.network.suggestedDownloadsDir;
        var actionsHtml = "";
        if (dlDir) {
          actionsHtml += '<button type="button" class="btn btn-primary btn-sm" data-empty-scan="' + u.esc(dlDir) + '">' +
            STTV.icons.folder + '<span>Usar pasta Downloads</span>' +
          '</button>';
        }
        actionsHtml += '<button type="button" class="btn btn-sm" data-empty-open-scan>' +
          STTV.icons.folder + '<span>Escolher pasta ou arquivo</span>' +
        '</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-empty-sample>' +
          STTV.icons.sparkle + '<span>Gerar filme de exemplo</span>' +
        '</button>';

        elList.innerHTML =
          '<div class="empty lib-empty">' +
            '<img class="empty-camera" src="/assets/camera.png" alt="">' +
            '<p class="lib-empty-title">Nenhum filme na biblioteca</p>' +
            '<p class="lib-empty-sub">Escaneie uma pasta local com vídeos (.mp4, .mkv, .webm, .avi, .mov) ou gere um vídeo de demonstração.</p>' +
            '<div class="lib-empty-actions">' + actionsHtml + '</div>' +
          '</div>';
      }

      function canPatchInPlace(items) {
        var cards = elList.querySelectorAll(".lib-card[data-media-id]");
        if (cards.length !== items.length || items.length === 0) return false;
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var card = cards[i];
          var downloading = Boolean(item.downloadStatus && item.downloadStatus.ready === false);
          var selected = item.id === state.selectedMediaId;
          var audioLen = String((item.audioTracks || []).length);
          var subLen = String((item.subtitleTracks || []).length);
          if (card.getAttribute("data-media-id") !== item.id) return false;
          if ((card.getAttribute("data-downloading") === "1") !== downloading) return false;
          if (card.classList.contains("is-selected") !== selected) return false;
          if (card.getAttribute("data-audio-count") !== audioLen) return false;
          if (card.getAttribute("data-sub-count") !== subLen) return false;
        }
        return true;
      }

      function patchDownloadsInPlace(items) {
        var cards = elList.querySelectorAll(".lib-card[data-media-id]");
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var card = cards[i];
          if (!item.downloadStatus || item.downloadStatus.ready !== false) {
            var modeBadge = card.querySelector("[data-mode-badge]");
            if (modeBadge) {
              var direct = sel.isDirectPlaySelected(item, sel.getTrackChoice(item).audioStreamIndex);
              modeBadge.className = "badge " + (direct ? "badge-ready" : "badge-info");
              modeBadge.textContent = direct ? "Direct Play" : "Remux AAC";
            }
            continue;
          }
          var pct = Math.max(0, Math.min(100, Number(item.downloadStatus.estimatedProgressPct || 0)));
          var badge = card.querySelector("[data-dl-badge]");
          var barWrap = card.querySelector("[data-dl-bar-wrap]");
          var bar = card.querySelector("[data-dl-bar]");
          var reason = card.querySelector("[data-dl-reason]");
          var castLbl = card.querySelector(".js-card-cast-label");
          if (badge) badge.textContent = "Baixando " + pct + "%";
          if (barWrap) barWrap.setAttribute("aria-valuenow", String(pct));
          if (bar) bar.style.width = pct + "%";
          if (reason) reason.textContent = item.downloadStatus.reason || "Cabeçalho moov/ftyp ainda não disponível.";
          if (castLbl) castLbl.textContent = "Baixando (" + pct + "%)";
        }
      }

      function renderLibrary() {
        var count = state.items.length;
        elPanel.classList.toggle("has-items", count > 0);
        if (elCountBadge) {
          elCountBadge.textContent = count === 1 ? "1 filme" : count + " filmes";
        }
        if (!state.libraryLoaded && count === 0) {
          elScanHint.textContent = "Escolha o caminho";
          return;
        }
        var lastPaths = state.network.lastScannedPaths || [];
        if (count > 0) {
          elScanHint.textContent = lastPaths[0] ? shortPathLabel(lastPaths[0]) : (count === 1 ? "1 filme" : count + " filmes");
        } else {
          elScanHint.textContent = "Escolha o caminho";
        }
        if (!userToggledScan) {
          elScan.open = count === 0;
        }
        if (count > 0) {
          if (canPatchInPlace(state.items)) {
            patchDownloadsInPlace(state.items);
            return;
          }
          var activeEl = document.activeElement;
          var restoreId = activeEl && elList.contains(activeEl) ? activeEl.id : "";
          var restoreMediaId = !restoreId && activeEl && elList.contains(activeEl) && activeEl.getAttribute
            ? activeEl.getAttribute("data-media-id")
            : "";
          elList.innerHTML = state.items.map(renderCard).join("");
          document.getElementById("library-index").innerHTML = state.items.map(function (item, index) {
            return '<button type="button" class="index-item" data-index-media="' + u.esc(item.id) + '"' + (item.id === state.selectedMediaId ? ' aria-current="true"' : '') + '><span aria-hidden="true" class="index-art jacket-' + index % 3 + '"></span><span>' + u.esc(item.title || item.fileName) + '</span></button>';
          }).join("");
          if (restoreId) {
            var targetById = document.getElementById(restoreId);
            if (targetById && targetById.focus) targetById.focus();
          } else if (restoreMediaId) {
            var targetCard = elList.querySelector('[data-media-id="' + restoreMediaId.replace(/"/g, '\\"') + '"]');
            if (targetCard && targetCard.focus) targetCard.focus();
          }
        } else {
          document.getElementById("library-index").replaceChildren();
          renderEmptyState();
        }
      }

      document.getElementById("library-index").addEventListener("click", function (ev) {
        var button = ev.target.closest("[data-index-media]");
        if (!button) return;
        act.selectMedia(button.dataset.indexMedia);
        var selectedCard = elList.querySelector(".is-selected");
        if (selectedCard) selectedCard.focus();
      });

      function openScanDrawer() {
        userToggledScan = true;
        elScan.open = true;
        elScanPath.focus();
      }

      if (elScanSummary) {
        elScanSummary.addEventListener("click", function () {
          userToggledScan = true;
        });
      }

      async function performScan(rawPath) {
        var pathValue = String(rawPath || "").trim();
        if (!pathValue) {
          u.showToast("Informe o caminho de uma pasta ou arquivo de vídeo.", true);
          elScan.open = true;
          elScanPath.focus();
          return;
        }
        elScanPath.value = pathValue;
        elBtnScan.disabled = true;
        try {
          var data = await u.apiJson("/api/library/scan", { method: "POST", body: JSON.stringify({ path: pathValue }) });
          rememberScannedPath(pathValue);
          state.lastRefreshedAt = Math.floor(Date.now() / 1000);
          var scannedItems = Array.isArray(data) ? data : (data.items || data.media || []);
          if (scannedItems.length > 0) {
            userToggledScan = false;
          }
          act.setLibraryItems(scannedItems, null);
          u.showToast(data.scannedCount ? data.scannedCount + " arquivo(s) encontrado(s)." : "Pasta escaneada; nenhum vídeo suportado encontrado.");
        } catch (err) {
          u.showToast("Falha ao escanear: " + err.message, true);
        } finally {
          elBtnScan.disabled = false;
        }
      }

      async function triggerSampleGeneration() {
        if (elBtnSample.disabled) return;
        elBtnSample.disabled = true;
        try {
          var data = await u.apiJson("/api/library/sample", { method: "POST" });
          userToggledScan = false;
          await act.loadLibrary();
          if (data && data.item && data.item.id) act.selectMedia(data.item.id);
          u.showToast("Filme de exemplo pronto.");
        } catch (err) {
          u.showToast("Falha ao gerar exemplo: " + err.message, true);
        } finally {
          elBtnSample.disabled = false;
        }
      }

      elQuickPaths.addEventListener("click", function (ev) {
        var chip = ev.target.closest("[data-fill-path]");
        if (!chip) return;
        elScanPath.value = chip.getAttribute("data-fill-path") || "";
        elScanPath.focus();
      });

      elScanForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        performScan(elScanPath.value);
      });

      elBtnRefresh.addEventListener("click", async function () {
        elBtnRefresh.classList.add("is-spinning");
        try {
          await act.refreshLibrary(false);
        } finally {
          elBtnRefresh.classList.remove("is-spinning");
        }
      });

      document.getElementById("btn-refresh-downloads").addEventListener("click", function () {
        act.refreshLibrary(false);
      });

      elAuto.addEventListener("change", updateDownloadMonitor);
      elBtnSample.addEventListener("click", triggerSampleGeneration);

      elList.addEventListener("click", function (ev) {
        var emptyScanBtn = ev.target.closest("[data-empty-scan]");
        if (emptyScanBtn) {
          performScan(emptyScanBtn.getAttribute("data-empty-scan") || "");
          return;
        }
        var emptyOpenBtn = ev.target.closest("[data-empty-open-scan]");
        if (emptyOpenBtn) {
          openScanDrawer();
          return;
        }
        var emptySampleBtn = ev.target.closest("[data-empty-sample]");
        if (emptySampleBtn) {
          triggerSampleGeneration();
          return;
        }
        if (ev.target.closest("select, label, input, button, a, summary")) return;
        var card = ev.target.closest("[data-media-id]");
        if (card) {
          act.selectMedia(card.getAttribute("data-media-id"));
        }
      });

      elList.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          if (ev.target.matches && ev.target.matches("[data-media-id]")) {
            ev.preventDefault();
            var mediaId = ev.target.getAttribute("data-media-id");
            if (mediaId) {
              act.selectMedia(mediaId);
              var nextCard = elList.querySelector('[data-media-id="' + mediaId.replace(/"/g, '\\"') + '"]');
              if (nextCard && nextCard.focus) nextCard.focus();
            }
          }
        }
      });

      elList.addEventListener("change", function (ev) {
        var audioSel = ev.target.closest("[data-audio-select]");
        var subSel = ev.target.closest("[data-sub-select]");
        var upload = ev.target.closest("[data-sub-upload]");
        var target = audioSel || subSel || upload;
        if (!target) return;
        var mediaId = target.getAttribute(audioSel ? "data-audio-select" : subSel ? "data-sub-select" : "data-sub-upload");
        var media = state.items.find(function (m) { return m.id === mediaId; });
        if (!media) return;
        var choice = sel.getTrackChoice(media);

        if (audioSel) {
          var val = audioSel.value === "" ? null : Number(audioSel.value);
          var pos = Math.floor(STTV.hooks.getPreviewPositionSec() || 0);
          choice.audioStreamIndex = val;
          renderLibrary();
          STTV.hooks.updateRemoteUi();
          STTV.hooks.loadLocalPreview(media, pos, false);
          if (state.wsConnected && state.remoteMediaId === media.id && (state.remoteState === "playing" || state.remoteState === "paused" || state.remoteState === "loading")) {
            act.sendWs({ type: "command", command: "setAudio", mediaId: media.id, audioStreamIndex: val, positionSec: Math.floor(state.remotePositionSec || pos) });
          }
          return;
        }

        if (subSel) {
          choice.subtitleId = subSel.value || null;
          STTV.hooks.applyPreviewSubtitle(media, choice.subtitleId);
          if (state.wsConnected && state.remoteMediaId === media.id && (state.remoteState === "playing" || state.remoteState === "paused" || state.remoteState === "loading")) {
            act.sendWs({ type: "command", command: "setSubtitle", mediaId: media.id, subtitleId: choice.subtitleId });
          }
          return;
        }

        if (upload && upload.files && upload.files[0]) {
          var file = upload.files[0];
          var reader = new FileReader();
          reader.onload = async function () {
            try {
              var res = await u.apiJson("/api/media/" + encodeURIComponent(media.id) + "/subtitles/upload", {
                method: "POST",
                body: JSON.stringify({ fileName: file.name, content: String(reader.result || ""), language: "pt-BR" })
              });
              await act.loadLibrary();
              if (res && res.item && res.selectedSubtitleId) {
                var updated = state.items.find(function (m) { return m.id === res.item.id; });
                sel.getTrackChoice(updated || null).subtitleId = res.selectedSubtitleId;
                renderLibrary();
                STTV.hooks.updateRemoteUi();
                STTV.hooks.applyPreviewSubtitle(updated || res.item, res.selectedSubtitleId);
              }
              u.showToast("Legenda " + file.name + " adicionada e selecionada!");
            } catch (err) {
              u.showToast("Erro ao enviar legenda: " + err.message, true);
            } finally {
              upload.value = "";
            }
          };
          reader.readAsText(file, "UTF-8");
        }
      });

      STTV.hooks.renderLibrary = renderLibrary;
      STTV.hooks.renderQuickPaths = renderQuickPaths;
      STTV.hooks.updateDownloadMonitor = updateDownloadMonitor;
      STTV.hooks.openScanDrawer = openScanDrawer;
    })();
`;

export function renderLibraryFragment(_ctx: ControllerRenderContext): LibraryFragment {
  const html = `
        <section class="library-workspace" id="library-panel" aria-labelledby="library-title">
          <aside class="library-rail" aria-label="Navegação da biblioteca">
            <h2 class="rail-title">${ICONS.folder} Minha biblioteca</h2>
          <details class="lib-scan" id="scan-details" open>
            <summary id="scan-summary">
              <span class="lib-scan-summary-left">
                <span class="lib-scan-icon">${ICONS.folder}</span>
                <span>Escanear pasta ou arquivo</span>
              </span>
              <span class="lib-scan-summary-right">
                <span class="lib-scan-hint" id="scan-summary-hint">Escolha o caminho</span>
                <span class="lib-chevron">${ICONS.chevronDown}</span>
              </span>
            </summary>
            <div class="lib-scan-body">
              <form class="lib-scan-form" id="scan-form">
                <label class="sr-only" for="scan-path">Caminho da pasta ou arquivo</label>
                <input type="text" class="input" id="scan-path" value="" placeholder="Cole o caminho da pasta ou arquivo (.mp4, .mkv)" autocomplete="off" spellcheck="false">
                <button type="submit" class="btn btn-primary" id="btn-scan">Escanear</button>
              </form>
              <div class="lib-quick-paths" id="quick-paths" hidden></div>
            </div>
          </details>

            <div class="library-index" id="library-index" aria-label="Índice de filmes"></div>
          </aside>
          <div class="library-stage">
            <header class="library-hero">
              <div class="hero-copy"><h2 id="library-title">Biblioteca</h2><span id="library-count-badge">0 filmes</span></div>
              <img class="hero-camera" src="/assets/camera.png" alt="">
            </header>
            <div class="shelf-heading"><h3>Seus filmes</h3><div class="lib-header-actions">
              <button type="button" class="btn btn-sm btn-ghost" id="btn-sample" aria-label="Gerar vídeo de demonstração" title="Gerar vídeo de demonstração">${ICONS.sparkle}<span>Exemplo</span></button>
              <button type="button" class="btn btn-sm btn-icon" id="btn-refresh" aria-label="Atualizar biblioteca" title="Atualizar biblioteca">${ICONS.refresh}</button>
            </div></div>
          <div class="lib-monitor" id="download-monitor" role="status" aria-live="polite" hidden>
            <div class="lib-monitor-status">
              <span class="lib-pulse-dot" aria-hidden="true"></span>
              <span class="lib-monitor-title" id="download-monitor-title">Acompanhando download</span>
              <span class="lib-monitor-sep" aria-hidden="true">·</span>
              <span class="lib-monitor-sub" id="download-monitor-sub">Monitoramento ativo</span>
            </div>
            <div class="lib-monitor-actions">
              <label class="lib-toggle"><input type="checkbox" id="chk-auto-refresh" checked><span>Auto (5s)</span></label>
              <button type="button" class="btn btn-sm" id="btn-refresh-downloads">Verificar agora</button>
            </div>
          </div>

          <div class="lib-list" id="movie-list" aria-label="Filmes na biblioteca">
            <div class="empty">Carregando biblioteca...</div>
          </div>
          </div>
        </section>`;

  return { css: LIBRARY_CSS, html, clientScript: LIBRARY_SCRIPT };
}
