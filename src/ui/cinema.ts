export const CINEMA_CSS = `
  :root {
    --bg: #100f0e; --surface: #1d1c1a; --surface-2: #292724; --surface-3: #36332d;
    --border: #3e3a34; --border-strong: #615b50; --text: #fbf5e9; --text-secondary: #ded7c9;
    --muted: #bdb7aa; --accent: #fac782; --accent-hover: #ffdbab; --accent-fg: #271c0d;
    --accent-soft: #463825; --green: #acdbb5; --radius: 12px; --radius-sm: 7px;
  }
  html { scroll-padding-bottom: 130px; }
  .app { max-width: none; gap: 10px; padding: 10px 14px calc(118px + var(--safe-bottom)); }
  .topbar { padding: 5px 8px; gap: 8px; align-items: center; }
  .brand { gap: 10px; }
  .brand h1 { font: 600 clamp(20px,2vw,29px)/1 Georgia,serif; letter-spacing: -.045em; }
  .brand-camera { width: 35px; height: 37px; object-fit: contain; filter: invert(1); mix-blend-mode: screen; }
  .brand-url { font-size: 10px; margin-top: 4px; }
  .topbar-actions { flex: 0 0 auto; }
  .layout-grid { grid-template-columns: minmax(0,1fr) clamp(265px,23vw,440px); gap: 10px; }
  .col-side { gap: 10px; }
  .panel { padding: 16px; }
  .panel-title, .shelf-heading h3, .rail-title { font: 650 18px/1.25 var(--font,system-ui); letter-spacing: -.035em; }
  #receiver-state-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .library-workspace { display: grid; grid-template-columns: clamp(180px,16vw,300px) minmax(0,1fr); gap: 10px; min-width: 0; }
  .library-stage, .library-rail { min-width: 0; border-radius: var(--radius); background: var(--surface); }
  .library-stage { overflow: hidden; padding: 0 clamp(15px,1.7vw,25px) 26px; min-height: min(680px,75vh); }
  .library-rail { padding: 18px 12px; }
  .rail-title { display: flex; gap: 10px; align-items: center; padding: 0 4px 19px; font-size: 16px; }
  .lib-scan { margin: 0 0 12px; }
  .lib-scan summary { padding: 8px; gap: 4px; }
  .lib-scan-summary-left { white-space: normal; gap: 6px; }
  .lib-scan-summary-left > span:last-child { font-size: 13px; }
  .lib-scan-hint { display: none; }
  .lib-scan-form { display: flex; flex-wrap: wrap; }
  .lib-scan-form input { width: 100%; }
  .library-index { display: grid; gap: 4px; }
  .index-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 0; border-radius: 7px; padding: 6px; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; overflow-wrap: anywhere; }
  .index-item:hover, .index-item[aria-current] { background: var(--surface-2); color: var(--text); }
  .index-art, .lib-cover, .player-cover {
    --ink: #efa564; --photo: url('/assets/camera.png'); --crop: 63%;
    position: relative; isolation: isolate; overflow: hidden; background-color: var(--ink);
    background-image: repeating-linear-gradient(113deg, transparent 0 15px,#fff2 15px 16px);
  }
  .jacket-1 { --ink: #a3c4ba; --photo: url('/assets/clapper.png'); --crop: 87%; }
  .jacket-2 { --ink: #cea5aa; --photo: url('/assets/film.png'); --crop: 83%; }
  .index-art { width: 40px; height: 40px; border-radius: 4px; flex: none; }
  .index-art::before, .lib-cover::before, .player-cover::before {
    content: ''; position: absolute; inset: 0; z-index: -1;
    background: var(--photo) center / var(--crop) auto no-repeat; mix-blend-mode: multiply;
  }
  .library-hero {
    display: flex; align-items: end; position: relative; isolation: isolate; overflow: hidden;
    margin-inline: calc(-1 * clamp(15px,1.7vw,25px)); padding: clamp(20px,2.7vw,42px);
    min-height: clamp(177px,17.5vw,275px); background: linear-gradient(108deg,#162e2b 7%,#315d54 60%,#84a693);
  }
  .library-hero::before { content:''; position:absolute; inset:-50%; z-index:-2; opacity:.24; background: repeating-radial-gradient(ellipse at 75% 62%, transparent 0 23px,#d2e0bb 24px 25px,transparent 26px 39px); transform:rotate(-14deg); }
  .hero-copy { position: relative; z-index: 1; }
  .hero-copy h2 { font: 550 clamp(43px,5.6vw,88px)/1 Georgia,serif; letter-spacing: -.075em; color: #fff4da; }
  #library-count-badge { display: block; margin-top: 10px; font-size: 13px; font-weight: 600; color: #dbebd9; }
  .hero-camera { position: absolute; z-index:-1; right: -2%; top: -5%; width: 53%; height: 155%; object-fit: contain; object-position: top center; mix-blend-mode: multiply; transform: rotate(-7deg); }
  .shelf-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin: 22px 0 12px; }
  .shelf-heading h3 { font-size: 24px; }
  .lib-list { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,190px),1fr)); align-items: start; gap: 12px; }
  .lib-list > .empty { grid-column: 1/-1; }
  .lib-card,.lib-card.is-selected { min-width: 0; padding: 9px; border: 1px solid transparent; border-radius: 9px; background: #252421; box-shadow: none; }
  .lib-card:hover,.lib-card.is-selected { background: #302e29; border-color: #5a5348; }
  .lib-card.is-selected { border-color: #a58251; }
  .lib-cover { border-radius: 5px; aspect-ratio: 1.32; margin-bottom: 12px; }
  .jacket-format { position: absolute; top: 8px; left: 8px; color: #211e19; border: 1px solid currentColor; padding: 1px 5px; font: 650 10px/1.5 var(--mono); letter-spacing: .08em; }
  .lib-card-head { flex-direction: column; gap: 5px; }
  .lib-card-title { line-height:1.25; font-size: 16px; }
  .lib-meta { margin-top: 8px; }
  .lib-card-controls { display: block; margin-top: 8px; padding-top: 0; }
  .lib-card-controls summary,.rm-box>summary { cursor: pointer; font-weight: 600; min-height: 42px; padding: 11px 0; }
  .lib-card-controls summary { display:flex; gap:7px; align-items:center; color:var(--text-secondary); font-size:13px; }
  .lib-card-controls summary .icon { width:16px;height:16px; }
  .lib-tracks { grid-template-columns: minmax(0,1fr); }
  .lib-card-actions { margin-top: 10px; }
  .lib-send { width: 100%; margin-top:10px; background:var(--accent); color:var(--accent-fg); border:0; border-radius: 24px; }
  .lib-send:hover { background:var(--accent-hover);color:var(--accent-fg); }
  .empty-camera { width: 66px; height: 68px; object-fit: contain; filter: invert(1); mix-blend-mode: screen; }
  .now-playing { position: fixed; inset: auto 0 0; z-index: 45; display:flex; align-items:center; gap:12px; background: #151412; padding: 12px 24px calc(12px + var(--safe-bottom)); border-top: 1px solid var(--border); }
  .now-playing.player-bar { display: grid; grid-template-columns: minmax(0,1fr) minmax(180px,1.2fr) minmax(0,1fr); }
  .np-art { border-radius: 5px; background:#bd9a71; color:#272019; }
  .player-transport { display: grid; justify-items: center; gap: 3px; min-width:0; }
  .player-output,.player-seek,.player-volume { display:flex; gap:8px; align-items:center; min-width:0; }
  .player-output { justify-content:flex-end; }
  .player-seek { width:100%; }
  .player-seek input { flex:1; min-width:0; }
  .player-volume input { width: clamp(40px,5vw,85px); }
  .player-seek,.player-volume { font-size: 11px; font-variant-numeric:tabular-nums; }
  .player-bar input,.player-expanded-transport input { accent-color: var(--accent); }
  .player-bar .tv-pill { width:100%; min-width:0; max-width:180px; }
  .player-bar .tv-pill-wrap { min-width:0; }
  #session-action { min-height:44px; border-radius: 30px; }
  .sheet-panel { width:min(100%,620px); padding: 16px clamp(18px,4vw,40px) calc(25px + var(--safe-bottom)); background:linear-gradient(155deg,#315a51,#18332f 40%,#151f1b); }
  .sheet-panel .modal-header { align-items:center; }
  .sheet-panel .rm-sheet-media { flex-direction:column; align-items:stretch; border:0; background:transparent; padding:0; }
  .player-cover { width:min(100%,285px,37vh); aspect-ratio:1; margin: 3px auto 12px; border-radius:5px; box-shadow:0 12px 36px #0005; display:grid; align-content:end; }
  .player-cover-title { display:block; padding:14px; font:600 clamp(21px,3vw,38px)/1 Georgia,serif; text-shadow:0 2px 7px #221c15; overflow-wrap:anywhere; color:white; background:linear-gradient(transparent,#2c1e12aa); }
  .sheet-panel .rm-sheet-media-title { font-size:21px; white-space:normal; }
  .player-expanded-transport { display:grid; gap:10px; justify-items:center; }
  .player-skip-row { display:flex; align-items:center; justify-content:center; gap:clamp(14px,6vw,32px); max-width:100%; }
  .player-skip-row .player-skip { width:48px; height:48px; min-width:48px; flex-direction:column; gap:0; }
  .player-skip-row .player-skip .icon { width:18px; height:18px; }
  .player-skip-num { font-size:10px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
  .player-skip-row .player-skip-play { width:56px; height:56px; min-width:56px; }
  .aside-session { display: grid; gap: 9px; }
  .aside-session .player-cover { width: 100%; height: auto; aspect-ratio: 1.8; margin: 0; padding: 0; border: 0; cursor:pointer; text-align:left; }
  .aside-session .player-cover-title { font-size:clamp(20px,2vw,30px); line-height:1.1; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
  .aside-session [data-player-caption] { color: var(--muted); font-size: 13px; }
  .player-volume input { min-width: 45px; }
  .player-expanded-transport .player-volume input { width:96px; }
  @media (min-width:601px) and (max-width:1100px) {
    #remote-sheet { inset: 0; width:100%; max-width:none; height:100dvh; max-height:100dvh; border:0; border-radius:0; padding:24px max(24px,calc((100vw - 530px)/2)); background:linear-gradient(160deg,#36796e,#193d36 65%,#142620); }
    #remote-sheet .sheet-handle { display:none; }
    #remote-sheet .modal-header { margin-bottom: clamp(20px,5vh,70px); }
    #remote-sheet .player-cover { width:min(65vw,39vh,380px); }
  }
  @media(max-width:900px) { .aside-session { display:none; } }
  .toast { bottom:calc(108px + var(--safe-bottom)); }
  .toast.confirmed::before { content:""; display:inline-block; width:20px;height:13px;margin-right:8px; border:1px solid currentColor;border-bottom-width:6px;transform-origin:left bottom;background:repeating-linear-gradient(130deg,var(--text) 0 3px,transparent 3px 7px); }
  @media(prefers-reduced-motion:no-preference) {
    .toast.confirmed::before { animation:clap .32s ease-out; }
    @keyframes clap { 0% {transform:rotate(-23deg)} 70% {transform:rotate(4deg)} }
  }
  @media(max-width:1120px) {
    .library-workspace { grid-template-columns: minmax(0,1fr); }
    .library-rail { padding:8px 12px; }
    .rail-title,.library-index { display:none; }
    .lib-scan { margin:0; }
  }
  @media(max-width:900px) {
    .layout-grid {grid-template-columns:minmax(0,1fr);}
    .library-stage { min-height:0; }
    .now-playing.player-bar { grid-template-columns:minmax(0,1fr) auto auto; }
    .player-bar .player-volume,.player-bar .player-seek { display:none; }
    .player-transport { display:flex; }
  }
  @media(max-width:600px) {
    .app {padding: 6px 8px calc(116px + var(--safe-bottom));}
    .brand-camera { width:26px; height:31px; }
    .topbar .brand { gap:5px; }
    .topbar { flex-wrap:nowrap; }
    .topbar-actions { gap:4px; }
    .btn-pair { width:40px; }
    .btn-pair .btn-label { display:none; }
    .library-hero {min-height:154px;}
    .hero-copy h2 {font-size:49px;}
    .lib-list {grid-template-columns:repeat(auto-fill,minmax(min(100%,140px),1fr));gap:8px;}
    .lib-send { gap:4px; padding-inline:4px; font-size:13px; }
    .lib-card-title {font-size:14px;}
    .lib-card .lib-meta {font-size:11px;}
    .lib-card .lib-upload {white-space:normal;}
    .shelf-heading {margin:16px 0 10px;}
    .lib-header-actions {gap:4px;}
    #btn-sample span {display:none;}
    .now-playing.player-bar { gap:6px; padding:8px 10px calc(8px + var(--safe-bottom)); }
    .np-info { flex:1; min-width:0; }
    .np-art { width:34px;height:34px; }
    .np-text {min-width:0;}
    .player-output .tv-pill-wrap { max-width:85px; }
    .player-output select.tv-pill { font-size:12px; padding-left:6px; }
    .player-output .tv-pill-wrap>.icon { display:none; }
    .sheet-panel { width:100%; max-height:95dvh; }
  }
`;
