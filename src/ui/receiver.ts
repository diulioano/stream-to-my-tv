import type { LanInterface } from "../types";
import { escapeHtml, ICONS } from "./shared";

export function renderReceiverHtml(lan: LanInterface, port: number): string {
  const panelUrl = escapeHtml(`http://${lan.address}:${port}/`);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Stream to My TV — Web Receiver</title>
  <style>
    :root {
      color-scheme: dark;
      --safe-x: clamp(24px, 5vw, 72px);
      --safe-y: clamp(20px, 4.5%, 48px);
      --gold: #f59e0b;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; background: #09090b; color: #fafafa; font: 500 clamp(15px, 1.4vw, 20px)/1.5 system-ui, sans-serif; }
    .stage { position: fixed; inset: 0; overflow: hidden; background: #000; }
    video#tv-player { width: 100%; height: 100%; object-fit: contain; }
    video#tv-player::cue { background: rgba(9, 9, 11, 0.84); color: #fafafa; font: 600 1.25em/1.45 sans-serif; text-shadow: 0 1px 3px #000; }
    #idle-hint {
      position: absolute; inset: 0; z-index: 1; display: grid; place-items: center;
      background: radial-gradient(ellipse at 50% 42%, #241c14 0%, #121012 36%, #09090b 72%);
    }
    .idle-content {
      position: absolute; inset: var(--safe-y) var(--safe-x);
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    }
    .idle-content .icon { width: clamp(40px, 5vw, 72px); height: auto; color: var(--gold); stroke-width: 1.4; }
    h1 { margin: .55em 0 .18em; font-size: clamp(26px, 3vw, 44px); line-height: 1.15; letter-spacing: -.035em; }
    .idle-content p { margin: 0; max-width: 44ch; color: #d4d4d8; }
    .address {
      margin-top: 1.1em; padding: .45em 1em; max-width: 100%; overflow-wrap: anywhere;
      color: #fde6b3; background: #2a2116; border: 1px solid #6c4e27; border-radius: 2em;
      font: 600 clamp(17px, 2vw, 30px)/1.4 ui-monospace, monospace;
    }
    #status-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; transition: opacity .35s ease; }
    #status-overlay.faded { opacity: 0; }
    .top, .timeline { position: absolute; left: var(--safe-x); right: var(--safe-x); display: flex; gap: 1em; align-items: flex-start; }
    .top { top: var(--safe-y); justify-content: space-between; }
    .details, .timeline {
      background: rgba(9,9,11,.88); border: 1px solid rgba(255,255,255,.16); border-radius: 12px; padding: .55em .95em;
    }
    .details { min-width: 0; }
    #media-title, #track-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #media-title { font-size: clamp(20px, 2vw, 32px); font-weight: 650; line-height: 1.25; }
    #media-status, #track-summary { color: #d4d4d8; }
    .connection {
      margin-left: auto; flex: none; display: flex; align-items: center; gap: .6em; padding: .28em .8em;
      background: #171719; border: 1px solid #3f3f46; border-radius: 2em; font-size: clamp(14px, 1.25vw, 18px);
    }
    .lan { color: #d4d4d8; border-right: 1px solid #52525b; padding-right: .6em; }
    #ws-status::before { content: ""; display: inline-block; width: .48em; height: .48em; margin-right: .45em; border-radius: 50%; background: var(--gold); }
    #ws-status.connected::before { background: #4ade80; }
    .timeline { bottom: max(var(--safe-y), 64px); flex-direction: column; gap: .45em; }
    .timeline-info { display: flex; justify-content: space-between; gap: 1em; width: 100%; }
    #clock { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rail { width: 100%; height: 4px; overflow: hidden; border-radius: 4px; background: #52525b; }
    #elapsed { height: 100%; width: 0; background: var(--gold); }
    @media (prefers-reduced-motion: reduce) { #status-overlay { transition: none; } }
  </style>
</head>
<body>
  <main class="stage">
    <video id="tv-player" controls playsinline crossorigin="anonymous">
      <track id="tv-subtitles" kind="subtitles" label="Legendas" default>
    </video>
    <section id="idle-hint">
      <div class="idle-content">
        ${ICONS.cast}
        <h1>Aguardando transmissão</h1>
        <p>No celular ou computador, abra o painel na mesma rede e envie um filme para esta tela.</p>
        <code class="address">${panelUrl}</code>
      </div>
    </section>
    <div id="status-overlay">
      <div class="top">
        <div class="details" id="media-details" hidden>
          <div id="media-title"></div>
          <div id="media-status" role="status"></div>
        </div>
        <div class="connection"><span class="lan">LAN</span><span id="ws-status" role="status">Conectando…</span></div>
      </div>
      <div class="timeline" id="timeline" hidden>
        <div class="timeline-info"><span id="clock">00:00 / 00:00</span><span id="track-summary"></span></div>
        <div class="rail" aria-hidden="true"><div id="elapsed"></div></div>
      </div>
    </div>
  </main>

  <script>
    (function () {
      const player = document.getElementById("tv-player");
      const subTrack = document.getElementById("tv-subtitles");
      const overlay = document.getElementById("status-overlay");
      const idleHint = document.getElementById("idle-hint");
      const elTitle = document.getElementById("media-title");
      const elStatus = document.getElementById("media-status");
      const elWsStatus = document.getElementById("ws-status");

      const state = {
        mediaId: null,
        title: "",
        audioStreamIndex: null,
        subtitleId: null,
        durationSec: 0,
        baseOffsetSec: 0,
        canDirectPlay: false,
        ws: null,
        reconnectTimer: null,
        fadeTimer: null,
        lastBroadcastMs: 0
      };

      const clock = document.getElementById("clock");
      const elapsed = document.getElementById("elapsed");
      const tracks = document.getElementById("track-summary");

      function formatTime(seconds) {
        const whole = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(whole / 3600);
        const minutes = String(Math.floor(whole / 60) % 60).padStart(2, "0");
        return (hours ? hours + ":" : "") + minutes + ":" + String(whole % 60).padStart(2, "0");
      }

      function duration() {
        return state.durationSec || (Number.isFinite(player.duration) ? state.baseOffsetSec + player.duration : 0);
      }

      function updateTimeline() {
        const pos = state.baseOffsetSec + (player.currentTime || 0);
        const total = duration();
        clock.textContent = formatTime(pos) + " / " + formatTime(total);
        elapsed.style.width = (total > 0 ? Math.min(100, pos / total * 100) : 0) + "%";
      }

      function showOverlayTemporarily() {
        tracks.textContent = [
          player.muted ? "Sem som" : state.audioStreamIndex !== null ? "Áudio #" + state.audioStreamIndex : "",
          state.subtitleId ? "Legendas ativas" : ""
        ].filter(Boolean).join(" · ");
        updateTimeline();
        overlay.classList.remove("faded");
        if (state.fadeTimer) clearTimeout(state.fadeTimer);
        if (!player.paused && state.mediaId) {
          state.fadeTimer = setTimeout(function () {
            overlay.classList.add("faded");
          }, 4000);
        }
      }

      function buildStreamUrl(mediaId, audioStreamIndex, startSec) {
        const params = new URLSearchParams();
        if (audioStreamIndex !== null && audioStreamIndex !== undefined) {
          params.set("audio", String(audioStreamIndex));
        }
        if (startSec && startSec > 0) {
          params.set("start", String(Math.floor(startSec)));
        }
        const qs = params.toString();
        return "/stream/" + encodeURIComponent(mediaId) + (qs ? "?" + qs : "");
      }

      function buildSubtitleUrl(mediaId, subtitleId, startSec) {
        if (!mediaId || !subtitleId) return "";
        const suffix = String(subtitleId).endsWith(".vtt") ? subtitleId : (subtitleId + ".vtt");
        const qs = startSec && startSec > 0 ? "?start=" + Math.floor(startSec) : "";
        return "/subtitles/" + encodeURIComponent(mediaId) + "/" + encodeURIComponent(suffix) + qs;
      }

      function setSubtitle(subtitleId) {
        state.subtitleId = subtitleId || null;
        if (!state.mediaId || !state.subtitleId) {
          subTrack.removeAttribute("src");
          if (player.textTracks && player.textTracks[0]) {
            player.textTracks[0].mode = "disabled";
          }
          elStatus.textContent = "Legenda desativada";
          showOverlayTemporarily();
          return;
        }
        subTrack.src = buildSubtitleUrl(state.mediaId, state.subtitleId, state.baseOffsetSec);
        if (player.textTracks && player.textTracks[0]) {
          player.textTracks[0].mode = "showing";
        }
        elStatus.textContent = "Legenda ativa: " + state.subtitleId;
        showOverlayTemporarily();
      }

      function loadStream(startSec, autoplay) {
        if (!state.mediaId) return;
        const start = Math.max(0, Math.floor(startSec || 0));
        const direct = Boolean(state.canDirectPlay) && start === 0;
        state.baseOffsetSec = direct ? 0 : start;
        idleHint.hidden = true;
        document.getElementById("media-details").hidden = false;
        document.getElementById("timeline").hidden = false;
        elTitle.textContent = state.title || state.mediaId;
        elStatus.textContent = "Carregando stream" + (start > 0 ? " em " + start + "s" : "") + "...";
        player.src = buildStreamUrl(state.mediaId, state.audioStreamIndex, start);
        setSubtitle(state.subtitleId);
        showOverlayTemporarily();
        if (autoplay) {
          player.play().catch(function () {
            elStatus.textContent = "Clique no player para liberar autoplay";
          });
        }
      }

      function broadcastStatus(statusName, force) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        if (!force && now - state.lastBroadcastMs < 1000) return;
        state.lastBroadcastMs = now;
        const pos = state.baseOffsetSec + (player.currentTime || 0);
        const dur = duration();
        state.ws.send(JSON.stringify({
          type: "status",
          state: statusName,
          mediaId: state.mediaId,
          title: state.title,
          positionSec: Math.floor(pos),
          durationSec: Math.floor(dur),
          audioStreamIndex: state.audioStreamIndex,
          subtitleId: state.subtitleId
        }));
      }

      function handleCommand(msg) {
        const cmd = msg.type === "command" ? msg.command : msg.type;
        if (cmd === "load") {
          state.mediaId = msg.mediaId || null;
          state.title = msg.title || msg.mediaId || "";
          state.audioStreamIndex = msg.audioStreamIndex !== undefined ? msg.audioStreamIndex : null;
          state.subtitleId = msg.subtitleId || null;
          state.durationSec = Number(msg.durationSec || 0);
          state.canDirectPlay = Boolean(msg.canDirectPlay);
          loadStream(msg.startSec || 0, true);
          broadcastStatus("loading", true);
          return;
        }
        if (cmd === "play") {
          player.play().catch(function () {});
          elStatus.textContent = "Reproduzindo";
          showOverlayTemporarily();
          broadcastStatus("playing", true);
          return;
        }
        if (cmd === "pause") {
          player.pause();
          elStatus.textContent = "Pausado";
          showOverlayTemporarily();
          broadcastStatus("paused", true);
          return;
        }
        if (cmd === "seek") {
          const target = Math.max(0, Math.floor(Number(msg.positionSec || 0)));
          if (state.canDirectPlay && state.baseOffsetSec === 0) {
            player.currentTime = target;
          } else {
            loadStream(target, !player.paused);
          }
          elStatus.textContent = "Posição " + formatTime(target);
          showOverlayTemporarily();
          broadcastStatus(player.paused ? "paused" : "playing", true);
          return;
        }
        if (cmd === "setAudio") {
          if (!state.mediaId || (msg.mediaId && msg.mediaId !== state.mediaId)) return;
          state.audioStreamIndex = msg.audioStreamIndex !== undefined ? msg.audioStreamIndex : null;
          const pos = msg.positionSec !== undefined
            ? Number(msg.positionSec)
            : (state.baseOffsetSec + (player.currentTime || 0));
          loadStream(pos, !player.paused);
          elStatus.textContent = "Áudio alterado (#" + state.audioStreamIndex + ")";
          showOverlayTemporarily();
          broadcastStatus("loading", true);
          return;
        }
        if (cmd === "setSubtitle") {
          if (!state.mediaId || (msg.mediaId && msg.mediaId !== state.mediaId)) return;
          setSubtitle(msg.subtitleId || null);
          broadcastStatus(player.paused ? "paused" : "playing", true);
        }
      }

      function connectWs() {
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        const proto = location.protocol === "https:" ? "wss://" : "ws://";
        const ws = new WebSocket(proto + location.host + "/ws");
        state.ws = ws;

        ws.addEventListener("open", function () {
          elWsStatus.textContent = "Conectado";
          elWsStatus.className = "connected";
          ws.send(JSON.stringify({ type: "register", role: "receiver" }));
          broadcastStatus(state.mediaId ? (player.paused ? "paused" : "playing") : "idle", true);
        });

        ws.addEventListener("message", function (ev) {
          let msg;
          try { msg = JSON.parse(ev.data); } catch (_) { return; }
          handleCommand(msg);
        });

        ws.addEventListener("close", function () {
          elWsStatus.textContent = "Reconectando…";
          elWsStatus.className = "";
          state.reconnectTimer = setTimeout(connectWs, 2000);
        });
      }

      player.addEventListener("play", function () {
        elStatus.textContent = "Reproduzindo";
        showOverlayTemporarily();
        broadcastStatus("playing", true);
      });

      player.addEventListener("pause", function () {
        elStatus.textContent = "Pausado";
        showOverlayTemporarily();
        broadcastStatus("paused", true);
      });

      document.addEventListener("mousemove", showOverlayTemporarily);
      document.addEventListener("touchstart", showOverlayTemporarily, { passive: true });
      document.addEventListener("keydown", function (event) {
        showOverlayTemporarily();
        if (!state.mediaId || event.ctrlKey || event.altKey || event.metaKey) return;
        switch (event.key) {
          case " ":
          case "Enter":
            event.preventDefault();
            if (!event.repeat) handleCommand({ type: player.paused ? "play" : "pause" });
            break;
          case "ArrowLeft":
          case "ArrowRight": {
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? -10 : 10;
            const target = Math.min(duration() || Infinity, state.baseOffsetSec + player.currentTime + delta);
            handleCommand({ type: "seek", positionSec: target });
            break;
          }
          case "m":
          case "M":
            event.preventDefault();
            if (!event.repeat) player.muted = !player.muted;
            break;
        }
      });

      player.addEventListener("volumechange", showOverlayTemporarily);
      player.addEventListener("seeked", showOverlayTemporarily);
      player.addEventListener("durationchange", updateTimeline);
      player.addEventListener("timeupdate", function () {
        updateTimeline();
        broadcastStatus(player.paused ? "paused" : "playing", false);
      });

      player.addEventListener("ended", function () {
        elStatus.textContent = "Reprodução concluída";
        showOverlayTemporarily();
        broadcastStatus("ended", true);
      });

      player.addEventListener("error", function () {
        elStatus.textContent = "Erro ao reproduzir stream";
        showOverlayTemporarily();
        broadcastStatus("error", true);
      });

      connectWs();
    })();
  </script>
</body>
</html>`;
}
