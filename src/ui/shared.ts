/**
 * Shared, framework-free building blocks for every server-rendered UI page.
 *
 * Everything here is 100% offline: no CDN, no web fonts, no remote icons.
 * Icons are inline SVG without an `xmlns` attribute (not needed for inline SVG in HTML).
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Serializes a value as JSON that is safe to embed inside an inline `<script>` element. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function icon(body: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICONS = {
  play: icon('<path d="M7 4.5v15l12-7.5z"/>'),
  pause: icon('<rect x="6.5" y="4.5" width="3.5" height="15" rx="1"/><rect x="14" y="4.5" width="3.5" height="15" rx="1"/>'),
  stop: icon('<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>'),
  cast: icon('<path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M3 12a8 8 0 0 1 8 8"/><path d="M3 16a4 4 0 0 1 4 4"/><path d="M3 20h.01"/>'),
  tv: icon('<rect x="2.5" y="5" width="19" height="12.5" rx="2"/><path d="M8 21h8"/><path d="M12 17.5V21"/>'),
  subtitles: icon('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M6.5 13h4"/><path d="M13 13h4.5"/><path d="M6.5 16h7"/><path d="M15.5 16h2"/>'),
  volumeOn: icon('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  volumeMute: icon('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/>'),
  folder: icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  refresh: icon('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>'),
  qr: icon('<rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2.5v2.5"/><path d="M20.5 14.5v.01"/><path d="M14.5 20.5h.01"/><path d="M17.5 20.5h3v-3"/>'),
  copy: icon('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>'),
  close: icon('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  chevronDown: icon('<path d="m6 9 6 6 6-6"/>'),
  chevronUp: icon('<path d="m6 15 6-6 6 6"/>'),
  upload: icon('<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  plus: icon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  arrowUp: icon('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
  arrowDown: icon('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
  arrowLeft: icon('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
  arrowRight: icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  home: icon('<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5h13V9"/><path d="M10 19.5v-5.5h4v5.5"/>'),
  back: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  rewind: icon('<path d="M11 6.5v11L3.5 12z"/><path d="M20.5 6.5v11L13 12z"/>'),
  forward: icon('<path d="M13 6.5v11l7.5-5.5z"/><path d="M3.5 6.5v11L11 12z"/>'),
  sliders: icon('<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="18" cy="18" r="2"/>'),
  wifi: icon('<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16.1a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>'),
  sparkle: icon('<path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z"/>'),
  check: icon('<path d="m4.5 12.5 5 5 10-11"/>'),
  alert: icon('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>'),
  film: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18"/><path d="M17 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
  download: icon('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>'),
  externalLink: icon('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  moreHorizontal: icon('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>')
} as const satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/**
 * P1 Cinema Obsidian — design tokens and reusable primitives shared by every page.
 *
 * Contrast (WCAG 2.1 AA, normal text >= 4.5:1):
 *   --text   #fafafa on --bg #09090b ≈ 19:1, on --surface #131316 ≈ 17.8:1
 *   --muted  #a1a1aa on --bg #09090b ≈ 7.7:1, on --surface #131316 ≈ 7.2:1
 *   --accent-fg #09090b on --accent #f59e0b ≈ 9.2:1
 */
export const SHARED_CSS = `
    :root {
      color-scheme: dark;
      --bg: #09090b;
      --surface: #131316;
      --surface-2: #1b1b20;
      --surface-3: #24242b;
      --border: #27272a;
      --border-strong: #3f3f46;
      --text: #fafafa;
      --text-secondary: #d4d4d8;
      --muted: #a1a1aa;
      --accent: #f59e0b;
      --accent-hover: #fbbf24;
      --accent-soft: rgba(245, 158, 11, 0.14);
      --accent-fg: #09090b;
      --green: #22c55e;
      --green-soft: rgba(34, 197, 94, 0.14);
      --red: #ef4444;
      --red-soft: rgba(239, 68, 68, 0.14);
      --blue: #3b82f6;
      --blue-soft: rgba(59, 130, 246, 0.14);
      --radius: 14px;
      --radius-sm: 10px;
      --radius-xs: 8px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
      --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.5;
      overflow-x: clip;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
    }
    body.no-scroll { overflow: hidden; }
    h1, h2, h3, h4, p { margin: 0; }
    a { color: var(--accent); }
    code, .mono { font-family: var(--mono); }
    img, svg, video { max-width: 100%; }
    .icon { width: 20px; height: 20px; flex: 0 0 auto; display: inline-block; vertical-align: middle; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
    :focus { outline: none; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* App shell */
    .app {
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px 24px 40px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .layout-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.95fr);
      gap: 20px;
      align-items: start;
    }
    .col-main, .col-side { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

    /* Panels */
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
      min-width: 0;
    }
    .panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .panel-title { font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
    .panel-sub { color: var(--muted); font-size: 13px; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .empty {
      padding: 22px 16px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-sm);
      font-size: 14px;
    }

    /* Buttons */
    .btn {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 40px;
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-strong);
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      font-size: 14px;
      font-weight: 550;
      line-height: 1.2;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      transition: background 0.15s var(--ease), border-color 0.15s var(--ease), color 0.15s var(--ease), transform 0.1s var(--ease);
      -webkit-tap-highlight-color: transparent;
    }
    .btn:hover { background: var(--surface-3); }
    .btn:active { transform: scale(0.98); }
    .btn:disabled, .btn[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; transform: none; }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 650; }
    .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
    .btn-ghost { background: transparent; border-color: transparent; color: var(--text-secondary); }
    .btn-ghost:hover { background: var(--surface-2); color: var(--text); }
    .btn-icon { padding: 8px; min-width: 40px; }
    .btn-sm { min-height: 34px; padding: 6px 11px; font-size: 13px; }
    .btn-sm.btn-icon { min-width: 34px; padding: 6px; }
    .btn-block { width: 100%; }
    .btn.is-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

    /* Form controls */
    .input, .select {
      width: 100%;
      min-height: 40px;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-strong);
      background: var(--bg);
      color: var(--text);
      font: inherit;
      font-size: 14px;
    }
    .input::placeholder { color: var(--muted); }
    .input:focus-visible, .select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
    .select { appearance: none; padding-right: 32px; background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%); background-position: calc(100% - 17px) 50%, calc(100% - 12px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
    .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .field > label { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid var(--border-strong);
      background: var(--surface-2);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
    }
    .badge-ready { color: var(--green); background: var(--green-soft); border-color: rgba(34, 197, 94, 0.35); }
    .badge-warn { color: var(--accent); background: var(--accent-soft); border-color: rgba(245, 158, 11, 0.35); }
    .badge-danger { color: var(--red); background: var(--red-soft); border-color: rgba(239, 68, 68, 0.35); }
    .badge-accent { color: var(--accent-fg); background: var(--accent); border-color: var(--accent); }
    .badge-info { color: var(--blue); background: var(--blue-soft); border-color: rgba(59, 130, 246, 0.35); }

    /* Modal */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .modal-dialog {
      width: 100%;
      max-width: 440px;
      max-height: calc(100% - 32px);
      overflow: auto;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 20px;
    }
    .modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }

    /* Bottom sheet */
    .sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(0, 0, 0, 0.6);
    }
    .sheet-panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 55;
      max-height: 88%;
      overflow: auto;
      background: var(--surface);
      border-top: 1px solid var(--border-strong);
      border-radius: var(--radius) var(--radius) 0 0;
      box-shadow: var(--shadow);
      padding: 12px 16px calc(20px + var(--safe-bottom));
    }
    .sheet-handle { width: 40px; height: 4px; border-radius: 999px; background: var(--border-strong); margin: 0 auto 12px; }

    /* Toast */
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(24px + var(--safe-bottom));
      z-index: 80;
      max-width: min(92%, 480px);
      padding: 11px 16px;
      border-radius: var(--radius-sm);
      background: var(--surface-3);
      border: 1px solid var(--border-strong);
      color: var(--text);
      font-size: 14px;
      box-shadow: var(--shadow);
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 12px);
      transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .toast.error { border-color: rgba(239, 68, 68, 0.5); background: #2a1414; }

    @media (max-width: 959px) {
      .app { padding: 14px 16px calc(100px + var(--safe-bottom)); gap: 16px; }
      .layout-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
      .col-main, .col-side { gap: 16px; }
      .panel { padding: 16px; }
      .btn, .btn-sm, .btn-icon, .btn-sm.btn-icon { min-height: 44px; min-width: 44px; }
      .input, .select { min-height: 44px; font-size: 16px; }
      .toast { bottom: calc(96px + var(--safe-bottom)); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }
`;
