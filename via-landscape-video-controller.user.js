// ==UserScript==
// @name         Via横屏视频控制器
// @namespace    https://github.com/wushanglin
// @version      1.0
// @description  横屏接管视频控制、竖屏恢复原生；缩略图预览失败自动重试，支持 VTT / 精灵图、iOS 式进度拖动、长按倍速及按域名永久缓存。
// @author       小桐雨
// @run-at       document-end
// @match        https://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
(() => {
  'use strict';
  if (window.__viaIOSV61) return;
  window.__viaIOSV61 = true;

  const SETTINGS_KEY = 'via-ios-video-v5-settings';
  const DOMAIN_KEY = 'via-ios-video-v55-domain-sprite-layouts';
  const DOMAIN = location.hostname.toLowerCase();

  const DEFAULTS = {
    height: 34,
    width: 100,
    left: 12,
    right: 12,
    hideSeconds: 3,
    longPressRate: 2,
    swipeSeconds: 120
  };

  const RANGES = {
    height: [26, 64],
    width: [40, 100],
    left: [0, 100],
    right: [0, 100],
    hideSeconds: [0, 15]
  };

  const SWIPE_OPTIONS = [90, 120, 180, 240, 300];

  const clamp = (n, a, b) =>
    Math.min(b, Math.max(a, n));

  const landscape = () =>
    matchMedia('(orientation: landscape)').matches;

  const seekable = v =>
    !!v && Number.isFinite(v.duration) && v.duration > 0;

  const two = n => String(n).padStart(2, '0');

  const timeText = n => {
    n = Math.max(0, Math.floor(Number(n) || 0));
    const h = Math.floor(n / 3600);
    const m = Math.floor(n / 60) % 60;
    const s = n % 60;

    return h
      ? `${h}:${two(m)}:${two(s)}`
      : `${two(m)}:${two(s)}`;
  };

  // ========================================
  // 设置与持久化存储
  // ========================================

  function read(key) {
    let value;

    try {
      if (typeof GM_getValue === 'function') {
        value = GM_getValue(key);
      }
    } catch (_) { }

    if (value && typeof value.then === 'function') {
      value = null;
    }

    if (value == null) {
      try {
        value = localStorage.getItem(key);
      } catch (_) { }
    }

    try {
      return typeof value === 'string'
        ? JSON.parse(value)
        : value;
    } catch (_) {
      return null;
    }
  }

  function write(key, value) {
    const raw = JSON.stringify(value);

    try {
      localStorage.setItem(key, raw);
    } catch (_) { }

    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, raw);
      }
    } catch (_) { }
  }

  const cfg = { ...DEFAULTS };
  const oldSettings = read(SETTINGS_KEY) || {};

  for (const key of Object.keys(RANGES)) {
    if (
      oldSettings[key] != null &&
      Number.isFinite(Number(oldSettings[key]))
    ) {
      cfg[key] = clamp(
        Number(oldSettings[key]),
        ...RANGES[key]
      );
    }
  }

  cfg.longPressRate =
    Number(oldSettings.longPressRate) === 3 ? 3 : 2;

  cfg.swipeSeconds =
    SWIPE_OPTIONS.includes(Number(oldSettings.swipeSeconds))
      ? Number(oldSettings.swipeSeconds)
      : 120;

  const saveSettings = () =>
    write(SETTINGS_KEY, cfg);

  // ========================================
  // 永久域名缓存
  // ========================================

  let db = read(DOMAIN_KEY);

  if (
    !db ||
    db.version !== 1 ||
    !db.domains ||
    typeof db.domains !== 'object'
  ) {
    db = {
      version: 1,
      domains: {}
    };
  }

  function profiles() {
    const list = db.domains[DOMAIN];

    if (!Array.isArray(list)) return [];

    // 永不过期，也不按数量清理旧配置。
    return list.filter(p =>
      p &&
      Number.isInteger(p.cols) &&
      p.cols > 0 &&
      Number.isInteger(p.rows) &&
      p.rows > 0 &&
      p.cols <= 30 &&
      p.rows <= 30 &&
      Number.isFinite(p.period) &&
      p.period > 0 &&
      p.period <= 300 &&
      Number.isFinite(p.ratio) &&
      p.ratio > 0 &&
      typeof p.assetHost === 'string' &&
      typeof p.stem === 'string'
    );
  }

  function identity(s) {
    if (!s?.series) return null;

    try {
      const u = new URL(s.url);

      return {
        assetHost: u.hostname.toLowerCase(),
        stem: (
          s.series.prefix.split('/').pop() || ''
        ).slice(0, 50),
        ext: s.series.ext.toLowerCase(),
        ratio: s.tileW / s.tileH
      };
    } catch (_) {
      return null;
    }
  }

  function matchingProfile(s) {
    const id = identity(s);

    return id && profiles().find(p =>
      p.assetHost === id.assetHost &&
      p.stem === id.stem &&
      p.ext === id.ext &&
      p.cols === s.cols &&
      p.rows === s.rows &&
      Math.abs(p.ratio / id.ratio - 1) < .06
    );
  }

  function saveModel(m) {
    const id = identity(m);

    if (
      !id ||
      m.samples < 4 ||
      !Number.isFinite(m.offset)
    ) return;

    const record = {
      ...id,
      cols: m.cols,
      rows: m.rows,
      period: m.period,
      offset: m.offset,
      savedAt: Date.now()
    };

    db.domains[DOMAIN] = [
      record,
      ...profiles().filter(p => !(
        p.assetHost === id.assetHost &&
        p.stem === id.stem &&
        p.ext === id.ext &&
        p.cols === m.cols &&
        p.rows === m.rows
      ))
    ];

    write(DOMAIN_KEY, db);
  }

  // ========================================
  // 网站原生控件隐藏
  // ========================================

  const css = document.createElement('style');

  css.textContent = `
      .via61-managed .plyr__controls,
      .via61-managed .plyr__control--overlaid,
      .via61-managed .vjs-control-bar,
      .via61-managed .vjs-big-play-button,
      .via61-managed .dplayer-controller,
      .via61-managed .art-controls,
      .via61-managed .xgplayer-controls,
      .via61-managed .jw-controlbar,
      .via61-managed .jw-display-controls,
      .via61-managed .mejs__controls,
      .via61-managed .ytp-chrome-top,
      .via61-managed .ytp-chrome-bottom,
      .via61-managed .ytp-large-play-button {
        opacity:0!important;
        pointer-events:none!important;
      }

      video.via61-media::-webkit-media-controls {
        display:none!important;
      }
    `;

  (document.head || document.documentElement)
    .appendChild(css);

  // ========================================
  // 播放器控制层
  // ========================================

  const host = document.createElement('div');

  host.style.cssText = `
      position:fixed;
      display:none;
      pointer-events:none;
      z-index:2147483647;
      isolation:isolate;
    `;

  const shadow = host.attachShadow({
    mode: 'open'
  });

  shadow.innerHTML = `
      <style>
        * {
          box-sizing:border-box;
        }

        button,input,select {
          font:inherit;
        }

        button {
          border:0;
          color:#fff;
          cursor:pointer;
          -webkit-tap-highlight-color:transparent;
        }

        [hidden] {
          display:none!important;
        }

        .surface {
          position:absolute;
          inset:0;
          pointer-events:auto;
          touch-action:none;
        }

        .ui {
          position:absolute;
          inset:0;
          color:#fff;
          font:12px -apple-system,
            BlinkMacSystemFont,system-ui,sans-serif;
          pointer-events:none;
          opacity:0;
          transition:opacity .18s;
          user-select:none;
          -webkit-user-select:none;
        }

        .ui.show {
          opacity:1;
        }

        .ui.show .tap,
        .ui.show .seek,
        .ui.show .panel {
          pointer-events:auto;
        }

        .glass {
          background:rgba(22,25,31,.58);
          border:1px solid rgba(255,255,255,.15);
          backdrop-filter:blur(18px);
          -webkit-backdrop-filter:blur(18px);
          box-shadow:0 5px 23px #0005;
        }

        .top {
          position:absolute;
          z-index:15;
          right:10px;
          top:9px;
          display:flex;
          gap:7px;
        }

        .icon {
          width:36px;
          height:36px;
          border-radius:50%;
          background:rgba(24,27,33,.65);
          font-size:21px;
        }

        .middle {
          position:absolute;
          z-index:7;
          left:50%;
          top:50%;
          transform:translate(-50%,-50%);
          display:flex;
          align-items:center;
          gap:18px;
        }

        .middle button {
          width:58px;
          height:58px;
          border-radius:50%;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          line-height:1;
          background:rgba(18,21,27,.59);
          font-size:29px;
          box-shadow:0 4px 14px #0005;
          touch-action:manipulation;
        }

        .middle button small {
          font-size:11px;
          font-weight:700;
        }

        .middle #toggle {
          width:74px;
          height:74px;
          background:rgba(18,21,27,.77);
          font-size:34px;
        }

        .seek {
          position:absolute;
          bottom:calc(
            6px + env(safe-area-inset-bottom,0px)
          );
          display:flex;
          align-items:center;
          gap:9px;
          padding:0 11px;
          height:34px;
          border-radius:12px;
          touch-action:none;
        }

        .clock {
          flex:none;
          font-size:10px;
          font-weight:600;
          font-variant-numeric:tabular-nums;
          white-space:nowrap;
        }

        .rail {
          position:relative;
          flex:1;
          min-width:10px;
          height:100%;
          touch-action:none;
        }

        .rail[aria-disabled=true] {
          opacity:.45;
          pointer-events:none;
        }

        .rail-hit {
          position:absolute;
          top:50%;
          left:-6px;
          right:-6px;
          height:72px;
          transform:translateY(-50%);
          touch-action:none;
          z-index:4;
        }

        .line,.buffer,.fill {
          position:absolute;
          top:50%;
          left:0;
          height:3px;
          border-radius:5px;
          transform:translateY(-50%);
        }

        .line {
          width:100%;
          background:#ffffff50;
        }

        .buffer {
          width:0;
          background:#ffffff30;
        }

        .fill {
          width:0;
          background:#fff;
        }

        .dot {
          position:absolute;
          top:50%;
          left:0;
          transform:translate(-50%,-50%);
          width:5px;
          height:12px;
          border-radius:6px;
          background:#fff;
        }

        .rail.drag .dot {
          height:18px;
          width:6px;
        }

        .preview {
          position:absolute;
          bottom:calc(100% + 10px);
          left:50%;
          transform:translateX(-50%);
          width:180px;
          padding:6px;
          border-radius:13px;
          background:rgba(18,21,28,.97);
          border:1px solid #ffffff2c;
          box-shadow:0 10px 35px #0009;
          pointer-events:none;
        }

        .photo {
          position:relative;
          width:166px;
          height:94px;
          background:#242833;
          overflow:hidden;
          border-radius:8px;
        }

        .frame {
          position:absolute;
          overflow:hidden;
          transform-origin:0 0;
        }

        .frame img {
          position:absolute;
          max-width:none!important;
          max-height:none!important;
        }

        .single {
          width:100%;
          height:100%;
          object-fit:contain;
        }

        .fallback {
          position:absolute;
          inset:0;
          display:grid;
          place-items:center;
          color:#c2c9d6;
          font-size:11px;
          text-align:center;
          padding:10px;
        }

        .preview-footer {
          display:flex;
          justify-content:space-between;
          font-variant-numeric:tabular-nums;
          font-size:10px;
          padding:5px 3px 0;
          color:#c6d0df;
        }

        .speed-toast,
        .swipe-toast {
          position:absolute;
          z-index:8;
          left:50%;
          transform:translateX(-50%);
          padding:9px 14px;
          background:rgba(20,23,30,.84);
          border-radius:15px;
          font-weight:700;
          pointer-events:none;
          white-space:pre;
          text-align:center;
        }

        .speed-toast {
          top:23%;
          font-size:16px;
        }

        .swipe-toast {
          top:12%;
          font-size:13px;
          line-height:1.5;
        }

        .veil {
          position:absolute;
          inset:0;
          z-index:10;
          background:#0005;
          touch-action:none;
          pointer-events:auto;
        }

        .panel {
          position:absolute;
          z-index:12;
          right:8px;
          top:8px;
          bottom:8px;
          width:min(390px,calc(100% - 16px));
          display:flex;
          flex-direction:column;
          overflow:hidden;
          border-radius:18px;
          border:1px solid #ffffff25;
          background:rgba(27,30,38,.98);
          box-shadow:0 15px 45px #0009;
          backdrop-filter:blur(22px);
          -webkit-backdrop-filter:blur(22px);
        }

        .settings-head {
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:12px 14px 9px;
          flex:none;
        }

        .settings-title {
          font-size:16px;
          font-weight:700;
        }

        .settings-sub {
          font-size:10px;
          color:#aeb9c9;
          margin-top:3px;
        }

        .close {
          width:32px;
          height:32px;
          background:#ffffff20;
          border-radius:50%;
          font-size:18px;
        }

        .tabs {
          display:grid;
          grid-template-columns:
            repeat(3,minmax(0,1fr));
          gap:3px;
          margin:0 12px 9px;
          padding:3px;
          background:#ffffff13;
          border-radius:11px;
          flex:none;
        }

        .tab {
          height:32px;
          border-radius:8px;
          background:none;
          color:#b7c1cf;
          font-size:12px;
          font-weight:650;
        }

        .tab.active {
          background:#ffffff28;
          color:white;
        }

        .settings-scroll {
          flex:1;
          min-height:0;
          overflow-y:auto;
          overflow-x:hidden;
          touch-action:pan-y;
          overscroll-behavior:contain;
          -webkit-overflow-scrolling:touch;
          padding:0 12px 12px;
        }

        .section-name {
          font-size:10px;
          font-weight:700;
          letter-spacing:.5px;
          color:#aebbd0;
          margin:9px 4px 7px;
        }

        .setting-card {
          padding:11px 12px;
          margin-bottom:8px;
          background:#ffffff0c;
          border:1px solid #ffffff18;
          border-radius:12px;
        }

        .control-head {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:7px;
          margin-bottom:8px;
        }

        .control-head label {
          font-size:12px;
          font-weight:600;
        }

        .control-head output {
          font-size:11px;
          padding:4px 7px;
          background:#ffffff1b;
          border-radius:7px;
          font-variant-numeric:tabular-nums;
        }

        .setting-card input[type=range] {
          width:100%;
          height:24px;
          margin:0;
          display:block;
          accent-color:#bed0ee;
          touch-action:pan-y;
        }

        .setting-card select {
          width:100%;
          min-height:34px;
          padding:6px 10px;
          border-radius:9px;
          border:1px solid #ffffff30;
          background:#363b49;
          color:#fff;
          font-size:12px;
        }

        .note {
          font-size:10px;
          line-height:1.5;
          color:#b5becd;
          margin-top:6px;
        }

        .actions {
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          margin:10px 0;
        }

        .action {
          padding:9px 12px;
          background:#ffffff1c;
          border:1px solid #ffffff25;
          border-radius:10px;
          min-height:35px;
          font-size:11px;
          font-weight:600;
        }

        .action.subtle {
          background:transparent;
        }

        .action.danger {
          color:#f0cece;
          background:#ffffff08;
        }

        .diag {
          border:1px solid #ffffff20;
          background:#0003;
          border-radius:12px;
          padding:11px 12px;
          margin:8px 0;
          overflow-wrap:anywhere;
          font-size:10px;
          line-height:1.65;
          white-space:pre-wrap;
          color:#c5d0dd;
          font-variant-numeric:tabular-nums;
        }

        @media(max-height:270px) {
          .middle {
            gap:12px;
          }

          .middle button {
            width:50px;
            height:50px;
            font-size:25px;
          }

          .middle #toggle {
            width:64px;
            height:64px;
            font-size:30px;
          }

          .panel {
            top:4px;
            bottom:4px;
          }

          .settings-head {
            padding:7px 12px 5px;
          }

          .tabs {
            margin-bottom:5px;
          }

          .tab {
            height:29px;
          }
        }
      </style>

      <div class="surface" id="surface"></div>

      <div class="ui" id="ui">

        <div class="veil" id="veil" hidden></div>
        <div class="speed-toast" id="speedToast" hidden></div>
        <div class="swipe-toast" id="swipeToast" hidden></div>

        <div class="top">
          <button class="tap icon glass" id="gear" aria-label="设置">⚙</button>
          <button class="tap icon glass" id="full" aria-label="全屏">⛶</button>
        </div>

        <div class="middle">
          <button class="tap" id="back">↶<small>10</small></button>
          <button class="tap" id="toggle">▶</button>
          <button class="tap" id="next">↷<small>10</small></button>
        </div>

        <div class="seek glass" id="seek">
          <span class="clock" id="now">00:00</span>

          <div class="rail" id="rail">
            <div class="line"></div>
            <div class="buffer" id="buffer"></div>
            <div class="fill" id="fill"></div>
            <div class="dot" id="dot"></div>
            <div class="rail-hit" id="railHit"></div>

            <div class="preview" id="preview" hidden>
              <div class="photo">
                <div class="frame" id="frame" hidden>
                  <img id="cropImage" alt="">
                </div>
                <img class="single" id="single" hidden alt="">
                <div class="fallback" id="fallback">正在查找预览…</div>
              </div>

              <div class="preview-footer">
                <span id="previewTime">00:00</span>
                <span id="level">1× 正常</span>
              </div>
            </div>
          </div>

          <span class="clock" id="total">00:00</span>
        </div>

        <section class="panel" id="panel" hidden>

          <div class="settings-head">
            <div>
              <div class="settings-title">播放器设置</div>
              <div class="settings-sub">Via · iOS 风格控制器 v6.1</div>
            </div>
            <button class="close" id="done">✕</button>
          </div>

          <div class="tabs">
            <button class="tab active" data-tab="look">外观</button>
            <button class="tab" data-tab="gesture">手势</button>
            <button class="tab" data-tab="preview">预览</button>
          </div>

          <div class="settings-scroll" id="settingsScroll">

            <div data-pane="look">

              <div class="section-name">控制条</div>

              <div class="setting-card">
                <div class="control-head">
                  <label>控件高度</label>
                  <output data-out="height"></output>
                </div>
                <input data-setting="height" type="range" min="26" max="64">
              </div>

              <div class="setting-card">
                <div class="control-head">
                  <label>控件宽度</label>
                  <output data-out="width"></output>
                </div>
                <input data-setting="width" type="range" min="40" max="100">
              </div>

              <div class="setting-card">
                <div class="control-head">
                  <label>左侧边距</label>
                  <output data-out="left"></output>
                </div>
                <input data-setting="left" type="range" min="0" max="100">
              </div>

              <div class="setting-card">
                <div class="control-head">
                  <label>右侧边距</label>
                  <output data-out="right"></output>
                </div>
                <input data-setting="right" type="range" min="0" max="100">
              </div>

              <div class="section-name">显示</div>

              <div class="setting-card">
                <div class="control-head">
                  <label>自动隐藏</label>
                  <output data-out="hideSeconds"></output>
                </div>
                <input data-setting="hideSeconds" type="range" min="0" max="15">
                <div class="note">0 秒表示始终显示</div>
              </div>

              <div class="actions">
                <button class="action subtle" id="reset">恢复全部默认设置</button>
              </div>

            </div>

            <div data-pane="gesture" hidden>

              <div class="section-name">视频画面</div>

              <div class="setting-card">
                <div class="control-head">
                  <label>长按快放倍速</label>
                </div>

                <select id="longPressRate">
                  <option value="2">2× · 默认</option>
                  <option value="3">3×</option>
                </select>

                <div class="note">长按约450ms，松手恢复原速</div>
              </div>

              <div class="setting-card">
                <div class="control-head">
                  <label>左右滑动快进/快退</label>
                </div>

                <select id="swipeSeconds">
                  <option value="90">90 秒 / 屏</option>
                  <option value="120">120 秒 / 屏 · 默认</option>
                  <option value="180">180 秒 / 屏</option>
                  <option value="240">240 秒 / 屏</option>
                  <option value="300">300 秒 / 屏</option>
                </select>

                <div class="note">右滑快进，左滑快退；松手才跳转</div>
              </div>

              <div class="section-name">进度条</div>

              <div class="setting-card">
                <div class="note">
                  72px以上触摸热区；相对位移拖动。
                  向上滑动35 / 75 / 125px，
                  精细度依次变为½×、¼×、⅒×。
                </div>
              </div>

            </div>

            <div data-pane="preview" hidden>

              <div class="section-name">识别状态</div>
              <div class="diag" id="diagnostics">等待视频加载…</div>

              <div class="note">
                域名布局永久保存，不会因为时间流逝自动删除。
                横竖屏切换时保留当前视频的识别结果；
                首次资源未准备好会继续尝试。
              </div>

              <div class="actions">
                <button class="action" id="relearn">↻ 重新学习当前域名</button>
              </div>

              <div class="section-name">当前页面</div>

              <div class="actions">
                <button class="action danger" id="leave">退出本页接管</button>
              </div>

            </div>

          </div>
        </section>

      </div>
    `;

  const $ = id => shadow.getElementById(id);

  // ========================================
  // 每个视频独立保存识别状态
  // ========================================

  const videoStates = new WeakMap();

  function stateOf(v) {
    if (!videoStates.has(v)) {
      videoStates.set(v, {
        mediaId: '',
        cues: [],
        model: null,
        samples: [],
        mode: '尚未识别',
        candidates: [],
        failedVtts: new Set(),
        attempts: 0,
        probing: false,
        lastProbeAt: 0,
        observed: new Map(),
        probeToken: 0
      });
    }

    return videoStates.get(v);
  }

  let video = null;
  let wrapper = null;
  let originalControls = false;

  let activeState = null;
  let activation = 0;
  let disabledForPage = false;

  let isShown = false;
  let panelOpen = false;
  let hideTimer = 0;

  let drag = null;
  let pointer = null;
  let longTimer = 0;
  let speedRestore = null;

  let recognitionTimer = 0;
  let previewTicket = 0;

  let wrapperObserver = null;
  let scrollLock = null;
  let panelTouchY = null;

  let positionPatched = null;
  let oldPosition = '';

  function diagnostics() {
    const stored = profiles();
    const s = activeState;

    $('diagnostics').textContent =
      `当前域名：${DOMAIN}\n` +
      `永久布局：${stored.length
        ? stored.map(p => `${p.cols}×${p.rows} / ${p.period}秒`).join('；')
        : '无'}\n` +
      `当前视频：${s?.mode || '无'}\n` +
      `VTT：${s?.cues.length || 0} 段；样本：${s?.samples.length || 0} 个\n` +
      `已尝试：${s?.attempts || 0} 次${s?.probing ? '（正在读取）' : ''}`;
  }

  function setMode(s, mode) {
    if (s && s.mode !== mode) {
      s.mode = mode;
      diagnostics();
    }
  }

  // ========================================
  // 控制层显示与隐藏
  // ========================================

  function clearHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function show() {
    if (!video || !landscape() || disabledForPage) return;

    isShown = true;
    $('ui').classList.add('show');
    render();
    startHideTimer();
  }

  function hide() {
    if (
      drag ||
      pointer?.seeking ||
      pointer?.speed ||
      panelOpen
    ) return;

    isShown = false;
    $('ui').classList.remove('show');
    clearHideTimer();
  }

  function startHideTimer() {
    clearHideTimer();

    if (
      isShown &&
      !panelOpen &&
      !drag &&
      !pointer?.seeking &&
      !pointer?.speed &&
      cfg.hideSeconds
    ) {
      hideTimer = setTimeout(
        hide,
        cfg.hideSeconds * 1000
      );
    }
  }

  function stopPress() {
    clearTimeout(longTimer);

    if (speedRestore) {
      try {
        speedRestore.v.playbackRate = speedRestore.rate;
      } catch (_) { }

      speedRestore = null;
    }

    pointer = null;
    $('speedToast').hidden = true;
    $('swipeToast').hidden = true;
  }

  function resetPreview() {
    previewTicket++;

    $('preview').hidden = true;
    $('frame').hidden = true;
    $('single').hidden = true;
    $('fallback').hidden = false;
    $('fallback').textContent = '正在查找预览…';
  }

  function stopRecognition() {
    clearTimeout(recognitionTimer);
    recognitionTimer = 0;

    if (wrapperObserver) {
      wrapperObserver.disconnect();
    }

    wrapperObserver = null;
  }

  // ========================================
  // 设置页滚动隔离
  // ========================================

  function lockScroll(on) {
    if (on && !scrollLock) {
      scrollLock = {
        html: document.documentElement.style.overflow,
        body: document.body?.style.overflow ?? ''
      };

      document.documentElement.style.overflow = 'hidden';

      if (document.body) {
        document.body.style.overflow = 'hidden';
      }
    } else if (!on && scrollLock) {
      document.documentElement.style.overflow =
        scrollLock.html;

      if (document.body) {
        document.body.style.overflow = scrollLock.body;
      }

      scrollLock = null;
    }
  }

  function setPanel(open) {
    panelOpen =
      !!open &&
      !!video &&
      !disabledForPage;

    $('panel').hidden = !panelOpen;
    $('veil').hidden = !panelOpen;

    lockScroll(panelOpen);

    if (panelOpen) {
      stopPress();
      show();
      clearHideTimer();
    } else {
      startHideTimer();
    }
  }

  // ========================================
  // 暂停接管：不删除视频识别结果
  // ========================================

  function deactivate() {
    activation++;
    stopRecognition();

    if (activeState) {
      // 取消旋转前尚未完成的异步探针。
      activeState.probing = false;
      activeState.probeToken = -1;
    }

    stopPress();
    drag = null;
    resetPreview();
    setPanel(false);
    clearHideTimer();

    isShown = false;
    $('ui').classList.remove('show');
    $('rail').classList.remove('drag');

    if (wrapper) {
      wrapper.classList.remove('via61-managed');
    }

    if (video) {
      video.classList.remove('via61-media');

      try {
        video.controls = originalControls;
      } catch (_) { }
    }

    // 这里只释放网页控制层。
    // videoStates WeakMap 内的数据不清除。
    video = null;
    wrapper = null;
    activeState = null;

    host.style.display = 'none';

    if (host.isConnected) {
      host.remove();
    }

    if (positionPatched) {
      positionPatched.style.position = oldPosition;
    }

    positionPatched = null;
  }

  function visibleVideos() {
    const fs = document.fullscreenElement;

    if (fs?.tagName === 'VIDEO') return [];

    return [
      ...(fs || document).querySelectorAll('video')
    ].filter(v => {
      const r = v.getBoundingClientRect();
      const style = getComputedStyle(v);

      return (
        r.width > 160 &&
        r.height > 85 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < innerWidth &&
        r.top < innerHeight &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    }).sort((a, b) =>
      Number(!b.paused) -
      Number(!a.paused) ||
      b.clientWidth * b.clientHeight -
      a.clientWidth * a.clientHeight
    );
  }

  // ========================================
  // 控制层布局
  // ========================================

  function layout() {
    if (!video) return;

    const r = video.getBoundingClientRect();

    if (r.width <= 0 || r.height <= 0) return;

    const fs = document.fullscreenElement;

    const parent =
      fs && fs.tagName !== 'VIDEO'
        ? fs
        : document.body;

    if (!parent) return;

    if (host.parentNode !== parent) {
      if (positionPatched) {
        positionPatched.style.position = oldPosition;
      }

      positionPatched = null;

      if (
        parent !== document.body &&
        getComputedStyle(parent).position === 'static'
      ) {
        positionPatched = parent;
        oldPosition = parent.style.position;
        parent.style.position = 'relative';
      }

      parent.appendChild(host);
    }

    if (parent === document.body) {
      Object.assign(host.style, {
        position: 'fixed',
        left: r.left + 'px',
        top: r.top + 'px'
      });
    } else {
      const p = parent.getBoundingClientRect();

      Object.assign(host.style, {
        position: 'absolute',
        left: (
          r.left - p.left + parent.scrollLeft
        ) + 'px',
        top: (
          r.top - p.top + parent.scrollTop
        ) + 'px'
      });
    }

    host.style.width = r.width + 'px';
    host.style.height = r.height + 'px';

    const available = Math.max(
      30,
      r.width - cfg.left - cfg.right
    );

    const width = available * cfg.width / 100;

    $('railHit').style.height =
      Math.max(72, cfg.height + 24) + 'px';

    Object.assign($('seek').style, {
      height: cfg.height + 'px',
      width: width + 'px',
      left: (
        cfg.left +
        (available - width) / 2
      ) + 'px'
    });
  }

  // ========================================
  // 视频资源变化检测
  // ========================================

  function videoIdentity(v) {
    return (
      v.currentSrc ||
      v.src ||
      v.querySelector('source[src]')?.src ||
      ''
    );
  }

  function checkSource() {
    if (!video) return;

    const current = videoIdentity(video);

    if (!current || current === activeState.mediaId) {
      return;
    }

    if (activeState.mediaId) {
      // 同一个 video 元素更换了视频资源。
      // 旧映射不能继续用于新视频。
      activeState.cues = [];
      activeState.model = null;
      activeState.samples = [];
      activeState.attempts = 0;
      activeState.failedVtts.clear();

      setMode(
        activeState,
        '视频源更新，正在重新识别'
      );
    }

    activeState.mediaId = current;
    scheduleRecognition(120);
  }

  // ========================================
  // 接管视频
  // ========================================

  function attach(v) {
    if (video && video !== v) {
      deactivate();
    }

    video = v;

    // 关键：恢复该视频之前学习的内容。
    activeState = stateOf(v);

    originalControls = v.controls;

    try {
      v.controls = false;
    } catch (_) { }

    v.classList.add('via61-media');

    wrapper = v.closest(
      '.plyr,.video-js,.dplayer,' +
      '.art-video-player,.xgplayer,.jwplayer,' +
      '.mejs__container,.html5-video-player'
    ) || v.parentElement;

    if (wrapper) {
      wrapper.classList.add('via61-managed');
    }

    host.style.display = 'block';
    layout();
    checkSource();

    if (activeState.model) {
      setMode(
        activeState,
        '横屏恢复：沿用当前视频缩略图映射'
      );
    } else if (activeState.cues.length) {
      setMode(
        activeState,
        '横屏恢复：沿用当前视频 VTT'
      );
    } else {
      setMode(
        activeState,
        '等待播放器预览资源'
      );
    }

    observeWrapper();

    if (
      !activeState.model &&
      !activeState.cues.length
    ) {
      scheduleRecognition(250);
    }

    diagnostics();
  }

  function render(
    t = video?.currentTime,
    d = video?.duration
  ) {
    if (!video) return;

    const valid =
      Number.isFinite(d) &&
      d > 0;

    $('now').textContent = timeText(t);
    $('total').textContent =
      valid ? timeText(d) : 'LIVE';

    $('rail').setAttribute(
      'aria-disabled',
      String(!valid)
    );

    const pct = valid
      ? clamp(t / d * 100, 0, 100)
      : 0;

    $('fill').style.width = pct + '%';
    $('dot').style.left = pct + '%';

    $('toggle').textContent =
      video.paused ? '▶' : 'Ⅱ';

    if (!valid || drag) return;

    try {
      let pctBuffered = 0;

      for (
        let i = 0;
        i < video.buffered.length;
        i++
      ) {
        if (
          video.buffered.start(i) <= t &&
          video.buffered.end(i) >= t
        ) {
          pctBuffered =
            video.buffered.end(i) / d * 100;
          break;
        }
      }

      $('buffer').style.width =
        clamp(pctBuffered, 0, 100) + '%';
    } catch (_) { }
  }

  // ========================================
  // 设置项
  // ========================================

  function updateInputs() {
    for (
      const el of shadow.querySelectorAll(
        '[data-setting]'
      )
    ) {
      const key = el.dataset.setting;
      el.value = cfg[key];

      const unit =
        key === 'width'
          ? '%'
          : key === 'hideSeconds'
            ? '秒'
            : 'px';

      shadow.querySelector(
        `[data-out="${key}"]`
      ).textContent =
        key === 'hideSeconds' &&
          cfg[key] === 0
          ? '常显'
          : cfg[key] + unit;
    }

    $('longPressRate').value =
      String(cfg.longPressRate);

    $('swipeSeconds').value =
      String(cfg.swipeSeconds);
  }

  updateInputs();

  for (
    const el of shadow.querySelectorAll(
      '[data-setting]'
    )
  ) {
    el.addEventListener('input', () => {
      const k = el.dataset.setting;

      cfg[k] = clamp(
        Number(el.value),
        ...RANGES[k]
      );

      saveSettings();
      updateInputs();
      layout();
      startHideTimer();
    });
  }

  $('longPressRate').onchange = () => {
    cfg.longPressRate =
      Number($('longPressRate').value) === 3
        ? 3
        : 2;

    saveSettings();
  };

  $('swipeSeconds').onchange = () => {
    const v = Number(
      $('swipeSeconds').value
    );

    cfg.swipeSeconds =
      SWIPE_OPTIONS.includes(v)
        ? v
        : 120;

    saveSettings();
  };

  function switchTab(name) {
    for (
      const tab of shadow.querySelectorAll(
        '[data-tab]'
      )
    ) {
      const on = tab.dataset.tab === name;

      tab.classList.toggle(
        'active',
        on
      );

      tab.setAttribute(
        'aria-selected',
        String(on)
      );
    }

    for (
      const pane of shadow.querySelectorAll(
        '[data-pane]'
      )
    ) {
      pane.hidden =
        pane.dataset.pane !== name;
    }

    $('settingsScroll').scrollTop = 0;
  }

  shadow.querySelectorAll('[data-tab]')
    .forEach(el => {
      el.addEventListener('click', () => {
        switchTab(el.dataset.tab);
      });
    });

  $('gear').onclick = () =>
    setPanel(!panelOpen);

  $('done').onclick = () =>
    setPanel(false);

  $('reset').onclick = () => {
    Object.assign(cfg, DEFAULTS);
    saveSettings();
    updateInputs();
    layout();
  };

  $('leave').onclick = () => {
    disabledForPage = true;
    deactivate();
  };

  $('relearn').onclick = () => {
    // 只有手动点击这里才删除域名学习数据。
    delete db.domains[DOMAIN];
    write(DOMAIN_KEY, db);

    if (activeState) {
      activeState.model = null;
      activeState.samples = [];
      activeState.attempts = 0;
      activeState.failedVtts.clear();

      setMode(
        activeState,
        '已清除域名布局，重新学习'
      );
    }

    scheduleRecognition(100);
    diagnostics();
  };

  // ========================================
  // 设置页手势隔离
  // ========================================

  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'wheel',
    'click',
    'dblclick'
  ]) {
    $('panel').addEventListener(
      type,
      e => e.stopPropagation(),
      { passive: false }
    );
  }

  $('panel').addEventListener(
    'touchstart',
    e => {
      panelTouchY =
        e.touches[0]?.clientY ?? null;
    },
    { passive: true }
  );

  $('panel').addEventListener(
    'touchmove',
    e => {
      if (
        panelTouchY == null ||
        !e.touches.length
      ) return;

      const y = e.touches[0].clientY;
      const dy = y - panelTouchY;
      const sc = $('settingsScroll');

      if (
        sc.scrollHeight <= sc.clientHeight ||
        (dy > 0 && sc.scrollTop <= 0) ||
        (
          dy < 0 &&
          sc.scrollTop + sc.clientHeight >=
          sc.scrollHeight - 1
        )
      ) {
        e.preventDefault();
      }

      panelTouchY = y;
    },
    { passive: false }
  );

  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'touchstart',
    'touchmove',
    'touchend',
    'click',
    'wheel'
  ]) {
    $('veil').addEventListener(
      type,
      e => {
        e.stopPropagation();

        if (e.cancelable) {
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }

  // ========================================
  // 播放、暂停、快进、快退
  // ========================================

  $('toggle').onclick = () => {
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => { });
    } else {
      video.pause();
    }

    render();
    startHideTimer();
  };

  function jump(seconds) {
    if (!seekable(video)) return;

    try {
      video.currentTime = clamp(
        video.currentTime + seconds,
        0,
        video.duration
      );
    } catch (_) { }

    render();
    startHideTimer();
  }

  $('back').onclick = () => jump(-10);
  $('next').onclick = () => jump(10);

  $('full').onclick = () => {
    if (!video) return;

    if (document.fullscreenElement) {
      document.exitFullscreen?.()
        .catch(() => { });
    } else {
      (
        wrapper?.contains(video)
          ? wrapper
          : video.parentElement
      )?.requestFullscreen?.()
        .catch(() => { });
    }

    startHideTimer();
  };

  // ========================================
  // 视频画面手势
  // ========================================

  const surface = $('surface');

  surface.addEventListener(
    'pointerdown',
    e => {
      if (
        !e.isPrimary ||
        !video ||
        panelOpen ||
        !landscape()
      ) return;

      e.preventDefault();
      e.stopPropagation();
      stopPress();

      pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        v: video,
        start: video.currentTime,
        target: video.currentTime,
        moved: false,
        seeking: false,
        speed: false,
        vertical: false
      };

      try {
        surface.setPointerCapture(
          e.pointerId
        );
      } catch (_) { }

      longTimer = setTimeout(() => {
        const p = pointer;

        if (
          !p ||
          p.id !== e.pointerId ||
          p.moved ||
          p.seeking ||
          p.vertical ||
          p.v !== video ||
          panelOpen ||
          video.paused ||
          video.ended
        ) return;

        try {
          speedRestore = {
            v: video,
            rate: video.playbackRate
          };

          video.playbackRate =
            cfg.longPressRate;

          p.speed = true;

          $('speedToast').textContent =
            `${cfg.longPressRate}× 正在快放`;

          $('speedToast').hidden = false;

          show();
          clearHideTimer();
        } catch (_) { }
      }, 450);
    }
  );

  surface.addEventListener(
    'pointermove',
    e => {
      const p = pointer;

      if (
        !p ||
        p.id !== e.pointerId
      ) return;

      e.stopPropagation();

      if (e.cancelable) {
        e.preventDefault();
      }

      if (p.speed) return;

      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;

      if (Math.hypot(dx, dy) > 12) {
        p.moved = true;
        clearTimeout(longTimer);
      }

      if (p.vertical) return;

      if (!p.seeking) {
        if (
          Math.abs(dy) > 16 &&
          Math.abs(dy) >
          Math.abs(dx) * 1.25
        ) {
          p.vertical = true;
          return;
        }

        if (
          Math.abs(dx) < 18 ||
          Math.abs(dx) <
          Math.abs(dy) * 1.25 ||
          !seekable(p.v)
        ) return;

        p.seeking = true;

        show();
        clearHideTimer();

        $('swipeToast').hidden = false;
      }

      const width = Math.max(
        160,
        surface.getBoundingClientRect().width
      );

      p.target = clamp(
        p.start +
        dx / width *
        cfg.swipeSeconds,
        0,
        p.v.duration
      );

      const delta = Math.round(
        p.target - p.start
      );

      $('swipeToast').textContent =
        `${delta >= 0 ? '快进' : '快退'} ` +
        `${delta >= 0 ? '+' : '−'}` +
        `${Math.abs(delta)} 秒\n` +
        `${timeText(p.target)} / ` +
        `${timeText(p.v.duration)}`;

      render(
        p.target,
        p.v.duration
      );
    },
    { passive: false }
  );

  function finishSurface(e, cancelled) {
    const p = pointer;

    if (
      !p ||
      p.id !== e.pointerId
    ) return;

    e.stopPropagation();

    if (e.cancelable) {
      e.preventDefault();
    }

    const {
      seeking,
      speed,
      moved,
      v,
      target
    } = p;

    stopPress();

    if (seeking) {
      if (
        !cancelled &&
        v.isConnected &&
        seekable(v)
      ) {
        try {
          v.currentTime = target;
        } catch (_) { }
      }

      render();
      startHideTimer();
    } else if (
      !cancelled &&
      !speed &&
      !moved &&
      !panelOpen
    ) {
      isShown ? hide() : show();
    } else if (speed) {
      startHideTimer();
    }
  }

  surface.addEventListener(
    'pointerup',
    e => finishSurface(e, false)
  );

  surface.addEventListener(
    'pointercancel',
    e => finishSurface(e, true)
  );

  surface.addEventListener(
    'lostpointercapture',
    e => finishSurface(e, true)
  );

  surface.addEventListener(
    'click',
    e => {
      e.preventDefault();
      e.stopPropagation();
    }
  );

  surface.addEventListener(
    'touchmove',
    e => {
      e.stopPropagation();

      if (e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  // ========================================
  // WebVTT 解析
  // ========================================

  function toSeconds(str) {
    const p = str.trim()
      .replace(',', '.')
      .split(':')
      .map(Number);

    return p.some(n => !Number.isFinite(n))
      ? NaN
      : p.reduce((a, b) => a * 60 + b, 0);
  }

  function imageCue(text, base) {
    const word = (text || '')
      .trim()
      .split(/\s+/)[0]
      .replaceAll('&amp;', '&');

    if (!word) return null;

    try {
      const u = new URL(word, base);

      if (!/^https?:$/.test(u.protocol)) {
        return null;
      }

      const xy = u.hash.match(
        /(?:^#|&)xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)/i
      );

      const crop = xy
        ? xy.slice(1).map(Number)
        : null;

      if (
        crop &&
        (!crop[2] || !crop[3])
      ) return null;

      u.hash = '';

      if (
        !/\.(png|jpe?g|webp|avif|gif)$/i
          .test(u.pathname)
      ) return null;

      return {
        url: u.href,
        crop
      };
    } catch (_) {
      return null;
    }
  }

  function parseVTT(raw, base) {
    const result = [];

    for (
      const block of raw
        .replace(/\r/g, '')
        .split(/\n\s*\n/)
    ) {
      const lines = block
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean);

      const idx = lines.findIndex(
        x => x.includes('-->')
      );

      if (
        idx < 0 ||
        !lines[idx + 1]
      ) continue;

      const [a, b] =
        lines[idx].split(/\s*-->\s*/);

      const start = toSeconds(a);

      const end = toSeconds(
        (b || '').split(/\s/)[0]
      );

      const image = imageCue(
        lines[idx + 1],
        base
      );

      if (
        image &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start
      ) {
        result.push({
          start,
          end,
          ...image
        });
      }
    }

    return result.sort(
      (a, b) => a.start - b.start
    );
  }

  function cuesFromTracks(v) {
    const result = [];

    for (const t of v.textTracks || []) {
      if (
        t.kind !== 'metadata' &&
        !/thumb|preview|sprite/i
          .test(t.label || '')
      ) continue;

      for (const cue of t.cues || []) {
        const image = imageCue(
          cue.text,
          document.baseURI
        );

        if (image) {
          result.push({
            start: cue.startTime,
            end: cue.endTime,
            ...image
          });
        }
      }
    }

    return result.sort(
      (a, b) => a.start - b.start
    );
  }

  async function lookForVtt(v, s, token) {
    if (s.cues.length) return true;

    const trackCues = cuesFromTracks(v);

    if (trackCues.length) {
      s.cues = trackCues;

      setMode(
        s,
        `WebVTT 文本轨道 (${s.cues.length}段)`
      );

      return true;
    }

    const links = new Set();
    const scope = wrapper || v.parentElement;

    for (
      const el of scope?.querySelectorAll(
        'track[src],[data-vtt],' +
        '[data-preview-vtt],' +
        '[data-thumbnails]'
      ) || []
    ) {
      for (const attr of [
        'src',
        'data-vtt',
        'data-preview-vtt',
        'data-thumbnails'
      ]) {
        const value = el.getAttribute(attr);

        if (
          !value ||
          !/\.vtt(?:$|[?#])/i.test(value)
        ) continue;

        try {
          links.add(
            new URL(
              value,
              document.baseURI
            ).href
          );
        } catch (_) { }
      }
    }

    for (
      const link of [...links].slice(0, 8)
    ) {
      if (s.failedVtts.has(link)) {
        continue;
      }

      s.failedVtts.add(link);

      try {
        const response = await fetch(
          link,
          {
            credentials:
              new URL(link).origin ===
                location.origin
                ? 'same-origin'
                : 'omit'
          }
        );

        if (!response.ok) continue;

        const body =
          await response.text();

        if (body.length > 2000000) {
          continue;
        }

        const parsed = parseVTT(
          body,
          link
        );

        if (
          token !== activation ||
          video !== v
        ) return false;

        if (parsed.length) {
          s.cues = parsed;

          setMode(
            s,
            `WebVTT (${parsed.length}段)`
          );

          return true;
        }
      } catch (_) { }
    }

    return false;
  }

  function cueAt(t) {
    const arr = activeState?.cues || [];

    let l = 0;
    let r = arr.length - 1;
    let found = null;

    while (l <= r) {
      const mid = (l + r) >> 1;

      if (arr[mid].start <= t) {
        found = arr[mid];
        l = mid + 1;
      } else {
        r = mid - 1;
      }
    }

    return found && found.end >= t
      ? found
      : null;
  }

  // ========================================
  // 精灵图索引与播放器选择器
  // ========================================

  const PROGRESS = [
    '.plyr__progress',
    '.vjs-progress-holder',
    '.vjs-progress-control',
    '.jw-slider-time',
    '.xgplayer-progress',
    '.art-control-progress',
    '.dplayer-bar-wrap',
    '.mejs__time-rail'
  ].join(',');

  const THUMBS = [
    '.plyr__preview-thumb',
    '.vjs-vtt-thumbnail-display',
    '.jw-preview',
    '.xgplayer-progress-preview',
    '.dplayer-thumb',
    '.video-thumbnail'
  ].join(',');

  function seriesFromURL(raw) {
    try {
      const u = new URL(
        raw,
        document.baseURI
      );

      const m = u.pathname.match(
        /^(.*?)(\d+)(\.(?:jpe?g|png|webp|avif))$/i
      );

      if (
        !m ||
        !/^https?:$/.test(u.protocol)
      ) return null;

      const num = Number(m[2]);

      if (
        !Number.isSafeInteger(num) ||
        num > 10000000
      ) return null;

      const prefix = m[1];
      const digits = m[2].length;
      const ext = m[3];

      return {
        num,
        prefix,
        ext,
        key:
          u.origin + prefix +
          '|' + ext +
          '|' + u.search,

        build(n) {
          if (
            !Number.isSafeInteger(n) ||
            n < 0
          ) return null;

          const target =
            new URL(u.href);

          target.pathname =
            prefix +
            String(n).padStart(digits, '0') +
            ext;

          return target.href;
        }
      };
    } catch (_) {
      return null;
    }
  }

  function numeric(el, name) {
    const inline = parseFloat(
      el?.style?.[name]
    );

    return Number.isFinite(inline)
      ? inline
      : parseFloat(
        getComputedStyle(el)[name]
      );
  }

  // ========================================
  // 从 DOM 自动识别网格
  // ========================================

  function fromImg(img) {
    const parent = img.parentElement;

    if (
      !parent ||
      !img.naturalWidth ||
      !img.naturalHeight
    ) return null;

    const iw = numeric(img, 'width');
    const ih = numeric(img, 'height');

    const cw = numeric(parent, 'width');
    const ch = numeric(parent, 'height');

    if (
      !(iw > 50 &&
        ih > 30 &&
        cw > 15 &&
        ch > 12)
    ) return null;

    const cols = Math.round(iw / cw);
    const rows = Math.round(ih / ch);

    if (
      cols < 1 ||
      rows < 1 ||
      cols > 30 ||
      rows > 30 ||
      cols * rows < 2 ||
      Math.abs(iw / cw - cols) > .14 ||
      Math.abs(ih / ch - rows) > .14
    ) return null;

    const tileW =
      img.naturalWidth / cols;

    const tileH =
      img.naturalHeight / rows;

    if (
      tileW < 24 ||
      tileH < 18
    ) return null;

    let left = numeric(img, 'left');
    let top = numeric(img, 'top');

    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top)
    ) {
      const a = img.getBoundingClientRect();
      const b = parent.getBoundingClientRect();

      const factor = b.width / cw;

      if (factor <= 0) return null;

      left = (a.left - b.left) / factor;
      top = (a.top - b.top) / factor;
    }

    const col = Math.round(-left / cw);
    const row = Math.round(-top / ch);

    if (
      col < 0 ||
      row < 0 ||
      col >= cols ||
      row >= rows ||
      Math.abs(left + col * cw) > cw * .16 ||
      Math.abs(top + row * ch) > ch * .16
    ) return null;

    const url =
      img.currentSrc || img.src;

    const series = seriesFromURL(url);

    if (!series) return null;

    return {
      url,
      series,
      cols,
      rows,
      tileW,
      tileH,
      col,
      row,
      tile: row * cols + col,
      sheet: series.num,
      signature:
        url + '|' +
        col + '|' +
        row + '|' +
        cols + 'x' + rows
    };
  }

  function nativeSprites() {
    if (!wrapper) return [];

    const found = [];

    for (
      const img of wrapper.querySelectorAll(
        '.plyr__preview-thumb__image-container img,' +
        '.vjs-vtt-thumbnail-display img,' +
        '.jw-preview img,' +
        '.xgplayer-progress-preview img,' +
        '.dplayer-thumb img'
      )
    ) {
      const item = fromImg(img);

      if (item) {
        found.push(item);
      }
    }

    return found;
  }

  function hoverNative(t) {
    if (
      !wrapper ||
      !seekable(video)
    ) return false;

    const bar =
      wrapper.querySelector(PROGRESS);

    if (!bar) return false;

    const r = bar.getBoundingClientRect();

    if (r.width < 8) return false;

    const x =
      r.left +
      clamp(
        t / video.duration,
        0,
        1
      ) * r.width;

    const y =
      r.top + r.height / 2;

    for (
      const target of [
        bar,
        bar.querySelector(
          'input[type=range]'
        )
      ].filter(Boolean)
    ) {
      for (const type of [
        'pointermove',
        'mousemove'
      ]) {
        try {
          const E =
            type === 'pointermove' &&
              typeof PointerEvent === 'function'
              ? PointerEvent
              : MouseEvent;

          target.dispatchEvent(
            new E(type, {
              bubbles: true,
              clientX: x,
              clientY: y,
              pointerType: 'mouse'
            })
          );
        } catch (_) { }
      }
    }

    return true;
  }

  function nativeTime(fallbackValue) {
    const text = wrapper?.querySelector(
      '.plyr__preview-thumb__time-container,' +
      '.plyr__preview-thumb__time'
    )?.textContent;

    const m = text?.match(
      /\b\d{1,3}:\d{2}(?::\d{2})?\b/
    );

    if (!m) return fallbackValue;

    const t = toSeconds(m[0]);

    return (
      Number.isFinite(t) &&
      Math.abs(t - fallbackValue) <
      Math.max(5, video.duration / 30)
    ) ? t : fallbackValue;
  }

  // ========================================
  // 永久缓存快速恢复
  // ========================================

  function modelFromCache(sample) {
    const p = matchingProfile(sample);

    if (
      !p ||
      !Number.isFinite(p.offset)
    ) return null;

    const count = p.cols * p.rows;

    return {
      ...sample,
      period: p.period,
      offset: p.offset,
      frameCount: count,
      observedUrls: new Map([
        [sample.sheet, sample.url]
      ]),
      samples: 0,
      cached: true
    };
  }

  // ========================================
  // 多样本精灵图时间映射
  // ========================================

  function scoreSamples(samples) {
    const groups = new Map();

    for (const s of samples) {
      const k =
        s.series.key + '|' +
        s.cols + 'x' + s.rows;

      if (!groups.has(k)) {
        groups.set(k, []);
      }

      groups.get(k).push(s);
    }

    let winner = null;

    for (const data0 of groups.values()) {
      const per =
        data0[0].cols *
        data0[0].rows;

      const unique = new Map(
        data0.map(s => [
          s.sheet * per + s.tile,
          {
            ...s,
            index:
              s.sheet * per + s.tile
          }
        ])
      );

      const data = [
        ...unique.values()
      ].sort(
        (a, b) => a.index - b.index
      );

      if (
        data.length < 4 ||
        new Set(
          data.map(s => s.sheet)
        ).size < 2
      ) continue;

      const slopes = [];

      for (
        let i = 0;
        i < data.length;
        i++
      ) {
        for (
          let j = i + 1;
          j < data.length;
          j++
        ) {
          const di =
            data[j].index -
            data[i].index;

          const dt =
            data[j].t -
            data[i].t;

          if (
            di >= 6 &&
            dt > 0
          ) {
            slopes.push(dt / di);
          }
        }
      }

      if (!slopes.length) continue;

      slopes.sort(
        (a, b) => a - b
      );

      let period = slopes[
        Math.floor(slopes.length / 2)
      ];

      const nice = [
        .1, .2, .25, .5,
        1, 1.5, 2, 2.5,
        3, 4, 5, 6, 8,
        10, 12, 15, 20,
        30, 60, 120
      ];

      const close = nice.reduce(
        (a, b) =>
          Math.abs(b - period) <
            Math.abs(a - period)
            ? b
            : a,
        nice[0]
      );

      if (
        Math.abs(close - period) /
        period < .025
      ) {
        period = close;
      }

      if (
        period < .1 ||
        period > 300
      ) continue;

      const offsets = [0];

      for (const s of data) {
        const k =
          s.t - s.index * period;

        offsets.push(
          k - .00001,
          k - period + .00001,
          k - period / 2
        );
      }

      let matched = [];
      let offset = 0;

      for (const o of offsets) {
        const group = data.filter(
          s => Math.floor(
            (s.t - o + .00001) / period
          ) === s.index
        );

        if (
          group.length >
          matched.length
        ) {
          matched = group;
          offset = o;
        }
      }

      if (
        matched.length < 4 ||
        matched.length < data.length * .7 ||
        new Set(
          matched.map(s => s.sheet)
        ).size < 2
      ) continue;

      const candidate = {
        ...matched[0],
        period,
        offset,
        frameCount: per,
        samples: matched.length,
        observedUrls: new Map(
          matched.map(s => [
            s.sheet,
            s.url
          ])
        )
      };

      if (
        !winner ||
        candidate.samples > winner.samples
      ) {
        winner = candidate;
      }
    }

    return winner;
  }

  function registerSample(s, t, item) {
    if (
      !s ||
      !item ||
      !Number.isFinite(t)
    ) return;

    const key =
      item.signature + '@' +
      Math.round(t * 10) / 10;

    if (
      !s.samples.some(
        a => a.key === key
      )
    ) {
      s.samples.push({
        ...item,
        t,
        key
      });

      if (s.samples.length > 35) {
        s.samples.shift();
      }
    }

    if (s.model) return;

    // 优先使用已有域名布局。
    const fromCache =
      modelFromCache(item);

    if (fromCache) {
      s.model = fromCache;

      setMode(
        s,
        '已复用域名布局（无需重新学习）'
      );

      return;
    }

    const fitted =
      scoreSamples(s.samples);

    if (fitted) {
      s.model = fitted;
      saveModel(fitted);

      setMode(
        s,
        `已学习 ${fitted.cols}×${fitted.rows}` +
        ` / ${fitted.period}秒`
      );
    }
  }

  // ========================================
  // 预览自动恢复与低频重试
  // ========================================

  function scheduleRecognition(
    delay = 300
  ) {
    if (
      !video ||
      !landscape() ||
      disabledForPage ||
      activeState?.model ||
      activeState?.cues.length
    ) return;

    if (
      recognitionTimer ||
      activeState?.probing
    ) return;

    const token = activation;

    recognitionTimer = setTimeout(
      () => {
        recognitionTimer = 0;

        if (token === activation) {
          recognize(token);
        }
      },
      delay
    );
  }

  async function recognize(token) {
    const v = video;
    const s = activeState;

    if (
      !v ||
      !s ||
      s.probing ||
      !landscape() ||
      token !== activation ||
      !seekable(v) ||
      drag
    ) return;

    s.probing = true;
    s.probeToken = token;
    s.attempts++;

    diagnostics();

    try {
      if (
        await lookForVtt(v, s, token)
      ) return;

      if (
        video !== v ||
        activation !== token
      ) return;

      const bar =
        wrapper?.querySelector(PROGRESS);

      if (
        !bar ||
        !wrapper?.querySelector(THUMBS)
      ) {
        setMode(
          s,
          '播放器预览未就绪，等待后重试'
        );

        return;
      }

      const steps = [
        .04, .21, .43,
        .65, .87, .12,
        .32, .73, .93
      ];

      const index =
        (s.attempts - 1) %
        steps.length;

      const current =
        s.attempts === 1 &&
          profiles().length
          ? clamp(
            v.currentTime || 30,
            1,
            Math.max(1, v.duration - 1)
          )
          : clamp(
            v.duration * steps[index],
            0,
            Math.max(
              0,
              v.duration - .01
            )
          );

      const before = new Set(
        nativeSprites().map(
          x => x.signature
        )
      );

      if (!hoverNative(current)) {
        return;
      }

      await new Promise(
        resolve => setTimeout(resolve, 300)
      );

      if (
        video !== v ||
        activation !== token ||
        drag
      ) return;

      let fresh = nativeSprites().filter(
        x => !before.has(x.signature)
      );

      if (!fresh.length) {
        await new Promise(
          resolve => setTimeout(resolve, 220)
        );

        if (
          video !== v ||
          activation !== token ||
          drag
        ) return;

        fresh = nativeSprites().filter(
          x => !before.has(x.signature)
        );
      }

      const got = fresh.at(-1);

      if (got) {
        registerSample(
          s,
          nativeTime(current),
          got
        );
      } else {
        setMode(
          s,
          '等待缩略图图片更新，自动重试'
        );
      }
    } finally {
      // 避免旧横屏探针覆盖新横屏任务。
      if (s.probeToken !== token) {
        return;
      }

      s.probing = false;
      diagnostics();

      if (
        video === v &&
        activation === token &&
        !s.model &&
        !s.cues.length
      ) {
        // 持续低频重试，但不高速轮询。
        const delays = [
          300,
          550,
          800,
          1300,
          2000,
          3300,
          5000
        ];

        const delay = delays[
          Math.min(s.attempts, 6)
        ];

        scheduleRecognition(delay);
      }
    }
  }

  // ========================================
  // 播放器节点变化监听
  // ========================================

  function observeWrapper() {
    if (wrapperObserver) {
      wrapperObserver.disconnect();
    }

    if (!wrapper) return;

    wrapperObserver = new MutationObserver(
      mutations => {
        if (
          !video ||
          activeState?.model ||
          activeState?.cues.length
        ) return;

        const changed = mutations.some(m => {
          const el = m.target;

          return el instanceof Element && (
            el.matches?.(THUMBS) ||
            el.closest?.(THUMBS) ||
            [
              ...(m.addedNodes || [])
            ].some(
              n => n instanceof Element &&
                (
                  n.matches(THUMBS) ||
                  n.querySelector(THUMBS)
                )
            )
          );
        });

        if (changed) {
          scheduleRecognition(250);
        }
      }
    );

    wrapperObserver.observe(
      wrapper,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'src',
          'style',
          'class'
        ]
      }
    );
  }

  // ========================================
  // 图片缓存与异步加载
  // ========================================

  const imageCache = new Map();

  function fetchImage(url) {
    let entry = imageCache.get(url);

    if (entry) {
      imageCache.delete(url);
      imageCache.set(url, entry);
      return entry;
    }

    const img = new Image();
    img.decoding = 'async';

    entry = {
      status: 'loading',
      img,
      promise: null
    };

    entry.promise = new Promise(
      resolve => {
        img.onload = () => {
          entry.status = 'ready';
          resolve(true);
        };

        img.onerror = () => {
          entry.status = 'error';
          resolve(false);
        };
      }
    );

    img.src = url;

    imageCache.set(url, entry);

    if (imageCache.size > 48) {
      imageCache.delete(
        imageCache.keys().next().value
      );
    }

    return entry;
  }

  let currentCropKey = '';

  function fallback(message) {
    $('frame').hidden = true;
    $('single').hidden = true;
    $('fallback').hidden = false;
    $('fallback').textContent = message;
  }

  // ========================================
  // 精灵图裁剪
  // ========================================

  function drawCrop(url, x, y, w, h) {
    if (
      !(w > 0 && h > 0) ||
      w > 10000 ||
      h > 10000
    ) return false;

    const key = [
      url, x, y, w, h
    ].join('|');

    currentCropKey = key;

    const entry = fetchImage(url);

    if (entry.status === 'error') {
      fallback(
        '此位置的预览图不可用'
      );
      return false;
    }

    if (entry.status === 'loading') {
      fallback(
        '正在加载视频预览…'
      );

      const ticket = previewTicket;

      entry.promise.then(ok => {
        if (
          !drag ||
          ticket !== previewTicket ||
          currentCropKey !== key
        ) return;

        if (ok) {
          drawCrop(
            url,
            x, y, w, h
          );
        } else {
          fallback(
            '图片加载失败'
          );
        }
      });

      return true;
    }

    const frame = $('frame');
    const img = $('cropImage');

    const scale = Math.min(
      166 / w,
      94 / h
    );

    frame.style.cssText = `
        width:${w}px;
        height:${h}px;
        left:${(166 - w * scale) / 2}px;
        top:${(94 - h * scale) / 2}px;
        transform:scale(${scale});
        background:none;
      `;

    img.style.cssText = `
        display:block;
        position:absolute;
        left:${-x}px;
        top:${-y}px;
        max-width:none;
        max-height:none;
      `;

    if (img.src !== url) {
      img.src = url;
    }

    $('single').hidden = true;
    frame.hidden = false;
    $('fallback').hidden = true;

    return true;
  }

  function drawSingle(url) {
    $('single').src = url;
    $('single').hidden = false;
    $('frame').hidden = true;
    $('fallback').hidden = true;

    return true;
  }

  function drawSprite(t) {
    const m = activeState?.model;

    if (
      !m ||
      !seekable(video)
    ) return false;

    const index = Math.floor(
      (
        clamp(
          t,
          0,
          video.duration - .0001
        ) - m.offset
      ) / m.period
    );

    if (index < 0) return false;

    const sheet = Math.floor(
      index / m.frameCount
    );

    const tile =
      index % m.frameCount;

    const row = Math.floor(
      tile / m.cols
    );

    const col =
      tile % m.cols;

    const url =
      m.observedUrls.get(sheet) ||
      m.series.build(sheet);

    if (!url) return false;

    const ok = drawCrop(
      url,
      col * m.tileW,
      row * m.tileH,
      m.tileW,
      m.tileH
    );

    // 预加载相邻图片。
    if (m.lastPrefetch !== sheet) {
      m.lastPrefetch = sheet;

      for (const n of [
        sheet - 1,
        sheet + 1
      ]) {
        const other =
          m.series.build(n);

        if (other) {
          fetchImage(other);
        }
      }
    }

    return ok;
  }

  // ========================================
  // DOM 预览兜底
  // ========================================

  function drawNative() {
    for (
      const box of wrapper?.querySelectorAll(
        THUMBS
      ) || []
    ) {
      const img =
        box.querySelector('img[src]');

      if (!img) continue;

      const frame =
        img.parentElement;

      if (!frame) continue;

      const a =
        img.getBoundingClientRect();

      const b =
        frame.getBoundingClientRect();

      if (
        b.width <= 20 ||
        b.height <= 15 ||
        a.width <= 0
      ) return false;

      const factor = Math.min(
        166 / b.width,
        94 / b.height
      );

      const container = $('frame');
      const out = $('cropImage');

      container.style.cssText = `
          width:${b.width}px;
          height:${b.height}px;
          left:${(166 - b.width * factor) / 2}px;
          top:${(94 - b.height * factor) / 2}px;
          transform:scale(${factor});
          background:none;
        `;

      out.style.cssText = `
          display:block;
          position:absolute;
          width:${a.width}px;
          height:${a.height}px;
          left:${a.left - b.left}px;
          top:${a.top - b.top}px;
          max-width:none;
          max-height:none;
        `;

      out.src =
        img.currentSrc || img.src;

      container.hidden = false;
      $('single').hidden = true;
      $('fallback').hidden = true;

      return true;
    }

    return false;
  }

  // ========================================
  // 统一预览入口
  // ========================================

  function previewAt(t) {
    $('previewTime').textContent =
      timeText(t);

    const cue = cueAt(t);

    if (cue) {
      if (cue.crop) {
        const [x, y, w, h] =
          cue.crop;

        if (
          drawCrop(
            cue.url,
            x, y, w, h
          )
        ) return;
      } else if (
        !activeState.cues.some(
          c => c !== cue &&
            c.url === cue.url
        )
      ) {
        if (drawSingle(cue.url)) {
          return;
        }
      }
    }

    if (drawSprite(t)) return;

    if (!wrapper) {
      fallback(
        '正在恢复播放器预览…'
      );
      return;
    }

    const before = new Set(
      nativeSprites().map(
        x => x.signature
      )
    );

    if (hoverNative(t)) {
      const v = video;
      const token = activation;
      const stamp = ++previewTicket;

      setTimeout(
        () => {
          if (
            !drag ||
            video !== v ||
            token !== activation ||
            stamp !== previewTicket
          ) return;

          const fresh = nativeSprites()
            .filter(
              s => !before.has(
                s.signature
              )
            );

          if (fresh.length) {
            registerSample(
              activeState,
              nativeTime(t),
              fresh.at(-1)
            );
          }

          if (
            !drawSprite(drag.target)
          ) {
            drawNative();
          }
        },
        240
      );
    }

    if (!drawNative()) {
      fallback(
        '正在识别预览图片…'
      );
    }

    scheduleRecognition(450);
  }

  // ========================================
  // 苹果式进度条拖动
  // ========================================

  function precision(up) {
    return up >= 125
      ? {
        factor: .1,
        label: '⅒× 超精细'
      }
      : up >= 75
        ? {
          factor: .25,
          label: '¼× 精细'
        }
        : up >= 35
          ? {
            factor: .5,
            label: '½× 慢速'
          }
          : {
            factor: 1,
            label: '1× 正常'
          };
  }

  function movePreview(t) {
    const w =
      $('rail').getBoundingClientRect()
        .width;

    $('preview').style.left =
      clamp(
        w * t / drag.duration,
        Math.min(w / 2, 90),
        Math.max(w / 2, w - 90)
      ) + 'px';
  }

  $('railHit').addEventListener(
    'pointerdown',
    e => {
      if (
        !e.isPrimary ||
        !seekable(video) ||
        !landscape()
      ) return;

      e.preventDefault();
      e.stopPropagation();
      clearHideTimer();

      drag = {
        id: e.pointerId,
        v: video,
        target: video.currentTime,
        lastX: e.clientX,
        startY: e.clientY,
        duration: video.duration,
        width: Math.max(
          1,
          $('rail').clientWidth
        )
      };

      try {
        $('railHit').setPointerCapture(
          e.pointerId
        );
      } catch (_) { }

      $('rail').classList.add('drag');
      $('preview').hidden = false;
      $('level').textContent = '1× 正常';

      movePreview(drag.target);
      previewAt(drag.target);

      render(
        drag.target,
        drag.duration
      );
    }
  );

  $('railHit').addEventListener(
    'pointermove',
    e => {
      if (
        !drag ||
        drag.id !== e.pointerId
      ) return;

      e.preventDefault();
      e.stopPropagation();

      const p = precision(
        Math.max(
          0,
          drag.startY - e.clientY
        )
      );

      drag.target = clamp(
        drag.target +
        (
          e.clientX - drag.lastX
        ) /
        drag.width *
        drag.duration *
        p.factor,
        0,
        drag.duration
      );

      drag.lastX = e.clientX;

      $('level').textContent =
        p.label;

      render(
        drag.target,
        drag.duration
      );

      movePreview(drag.target);
      previewAt(drag.target);
    }
  );

  function finishDrag(e, commit) {
    if (
      !drag ||
      drag.id !== e.pointerId
    ) return;

    e.preventDefault();
    e.stopPropagation();

    const d = drag;
    drag = null;

    if (
      commit &&
      d.v.isConnected
    ) {
      try {
        d.v.currentTime = d.target;
      } catch (_) { }
    }

    resetPreview();

    $('rail').classList.remove(
      'drag'
    );

    render();
    startHideTimer();

    if (
      !activeState?.model &&
      !activeState?.cues.length
    ) {
      scheduleRecognition(300);
    }
  }

  $('railHit').addEventListener(
    'pointerup',
    e => finishDrag(e, true)
  );

  $('railHit').addEventListener(
    'pointercancel',
    e => finishDrag(e, false)
  );

  $('railHit').addEventListener(
    'lostpointercapture',
    e => finishDrag(e, false)
  );

  // ========================================
  // 阻止控制器事件传给网站
  // ========================================

  for (const type of [
    'click',
    'dblclick',
    'pointerdown',
    'pointermove',
    'pointerup',
    'touchstart',
    'touchmove',
    'touchend',
    'mousedown',
    'mousemove',
    'mouseup',
    'wheel'
  ]) {
    host.addEventListener(
      type,
      e => e.stopPropagation(),
      { passive: false }
    );
  }

  // ========================================
  // 横竖屏、全屏、视频状态同步
  // ========================================

  function sync() {
    if (
      disabledForPage ||
      !landscape() ||
      document.fullscreenElement?.tagName ===
      'VIDEO'
    ) {
      if (video) {
        deactivate();
      }

      return;
    }

    const candidates =
      visibleVideos();

    const selected =
      candidates.includes(video)
        ? video
        : candidates[0] || null;

    if (!selected) {
      if (video) {
        deactivate();
      }
      return;
    }

    if (selected !== video) {
      attach(selected);
    }

    checkSource();

    if (video?.controls) {
      try {
        video.controls = false;
      } catch (_) { }
    }

    layout();

    if (
      isShown &&
      !drag
    ) {
      render();
    }
  }

  window.addEventListener(
    'resize',
    sync,
    { passive: true }
  );

  window.addEventListener(
    'orientationchange',
    () => setTimeout(sync, 80)
  );

  window.addEventListener(
    'scroll',
    sync,
    { passive: true }
  );

  document.addEventListener(
    'fullscreenchange',
    () => {
      stopPress();
      drag = null;
      resetPreview();
      setPanel(false);

      // 全屏切换时尺寸可能短暂为 0。
      // 多次延迟恢复，不再只执行一次。
      sync();

      setTimeout(sync, 120);
      setTimeout(sync, 500);
    }
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        stopPress();
        drag = null;
        resetPreview();
        setPanel(false);
        hide();
      } else {
        sync();
        scheduleRecognition(200);
      }
    }
  );

  document.addEventListener(
    'loadedmetadata',
    e => {
      if (e.target === video) {
        checkSource();
        scheduleRecognition(150);
      }
    },
    true
  );

  document.addEventListener(
    'canplay',
    e => {
      if (e.target === video) {
        scheduleRecognition(200);
      }
    },
    true
  );

  document.addEventListener(
    'loadstart',
    e => {
      if (e.target === video) {
        checkSource();
        scheduleRecognition(200);
      }
    },
    true
  );

  // 视频节点变化低频检测；
  // 缩略图由专用识别器负责重试。
  setInterval(sync, 900);

  sync();
})();
