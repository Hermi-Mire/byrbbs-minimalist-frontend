// ==UserScript==
// @name         北邮人论坛 · 简约版
// @namespace    https://bbs.byr.cn/
// @version      0.8.0
// @description  将北邮人论坛帖子详情页重构为响应式简约布局（卡片式楼层、浮动标题/路径栏、底部快捷回复、舒适排版），支持跟随系统的黑夜模式。
// @author       Hermi2024
// @match        https://bbs.byr.cn/*
// @match        http://bbs.byr.cn/*
// @updateURL    https://raw.githubusercontent.com/Hermi-Mire/byrbbs-minimalist-frontend/main/byrbbs-minimalist-frontend.user.js
// @downloadURL  https://raw.githubusercontent.com/Hermi-Mire/byrbbs-minimalist-frontend/main/byrbbs-minimalist-frontend.user.js
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* 目录
   * 0. 配置与主题
   * 1. 路由判断：只在帖子详情页启用
   * 2. 样式：按页面结构拆成 CSS_BASE … CSS_DARK，末尾拼成 CSS
   * 3. 左下角控制条：简约版 / 主题 / 版面菜单
   * 4. 轻量 DOM 增强：徽标、meta、用户操作
   * 5. 浮动标题 / 路径栏、底栏表情按钮
   * 6. 启动、路由与 DOM 监听
   */

  /* ------------------------------------------------------------------ *
   * 0. 配置与主题
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'bym-enabled';
  const THEME_KEY = 'bym-theme';
  const TOGGLE_KEY = 'm'; // Alt+M 切换

  // 关键尺寸 / 节流参数，避免魔法数字散落在各处
  const COMPOSER_MIN_H = 38;
  const COMPOSER_MAX_H = 112;
  const FLOATBAR_MIN_SCROLL = 20;
  const FLOATBAR_HEAD_GAP = 56;

  const state = {
    enabled: readEnabled(),
    theme: readTheme(), // 'auto' | 'light' | 'dark'
  };

  function readEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch (e) {
      return true;
    }
  }

  function saveEnabled(v) {
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function readTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function saveTheme(v) {
    try {
      localStorage.setItem(THEME_KEY, v);
    } catch (e) { /* ignore */ }
  }

  const darkQuery = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function systemDark() {
    return !!(darkQuery && darkQuery.matches);
  }

  function effectiveDark() {
    return state.theme === 'dark' || (state.theme === 'auto' && systemDark());
  }

  /* ------------------------------------------------------------------ *
   * 1. 路由判断：只在帖子详情页启用
   *    BYR 是 hash 路由：#!article/版面/文章ID
   * ------------------------------------------------------------------ */
  function isArticlePage() {
    return (
      /^#!article\//.test(location.hash) ||
      /^#!article$/.test(location.hash) ||
      /^\/article\//.test(location.pathname)
    );
  }

  // 从 hash / pathname 里取出当前文章 ID
  function getArticleId() {
    const m =
      location.hash.match(/^#!article\/(?:[^/?#]+)\/(\d+)/) ||
      location.pathname.match(/\/article\/(?:[^/?#]+)\/(\d+)/);
    return m ? m[1] : '';
  }

  // 当前版面名（用于生成「只看此ID」链接）
  function getBoard() {
    const m =
      location.hash.match(/^#!article\/([^/?#]+)/) ||
      location.pathname.match(/\/article\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  // 只有当前文章 DOM 真正出现后才启用卡片样式，避免在跳转前的旧页面上
  // 先套一遍新布局（BYR 是 hash SPA，hash 先变、内容后到）。
  // 页面顶部的 #a_share 带有当前文章地址；翻页后仍然存在。
  function hasArticleContent() {
    const id = getArticleId();
    if (id) {
      return !!(
        document.querySelector(`#body #a_share[_u*="/article/"][_u*="/${id}"]`) ||
        document.querySelector(`#body a[href*="/ajax_cross/${id}.json"]`) ||
        document.querySelector(`#body a[href*="/article/post/${id}"]`) ||
        document.querySelector(`#body [class~="body${id}"]`)
      );
    }
    return !!(
      document.querySelector('#body table.article') ||
      document.querySelector('#body .b-content .a-wrap')
    );
  }

  // 当前是否处于「帖子页 + 简约版开启」的状态
  function isModern() {
    return !!(document.body && document.body.classList.contains('bym-on'));
  }

  function applyRoute() {
    const body = document.body;
    if (!body) return;
    const article = isArticlePage();
    const wasArticle = body.classList.contains('bym-is-article');
    const ready = article && hasArticleContent();
    body.classList.toggle('bym-is-article', article);
    body.classList.toggle('bym-ready', ready);
    if (!article || !state.enabled) {
      body.classList.remove('bym-on');
    } else if (ready) {
      body.classList.add('bym-on');
    } else if (wasArticle) {
      // 文章页之间切换（翻页 / 只看此ID）时，新内容还没到：
      // 保留简约版样式，避免旧内容先闪回经典布局再重新套壳。
      // 真正离开文章页时上面的分支会立即移除。
    } else {
      body.classList.remove('bym-on');
    }
    if (!(ready && state.enabled)) {
      body.classList.remove('bym-menu-open');
      syncMenu();
      if (floatbar) floatbar.classList.remove('bym-visible');
      if (floorTopBtn) floorTopBtn.classList.remove('bym-visible');
      floorTopTarget = null;
    }
    applyTheme();
  }

  /* ------------------------------------------------------------------ *
   * 2. 注入样式（document-start 即注入，避免闪烁）
   * ------------------------------------------------------------------ */
  const CSS_BASE = String.raw`
/* ==================================================================
   北邮人论坛 · 简约版
   仅作用于 body.bym-on（帖子详情页且用户开启）
   ================================================================== */

/* 设计变量：浅色色板集中在这里，深色模式在末尾单独覆盖。
   使用 :root 而非 body.bym-on，经典版下的控制条也能取到值。 */
:root {
  --bym-accent: #2f6fd0;
  --bym-accent-strong: #2159b0;
  --bym-accent-soft: #eef2f9;
  --bym-bg: #f4f6fa;
  --bym-surface-soft: #fbfcff;
  --bym-surface-tint: #f8fafc;
  --bym-border: #e4e9f2;
  --bym-surface-muted: #eef2f7;
  --bym-border-strong: #dbe2ee;
  --bym-text: #1f2937;
  --bym-text-mid: #475569;
  --bym-text-muted: #64748b;
  --bym-text-faint: #94a3b8;
  --bym-link: #2563eb;
}

/* ---------- 页面底色与基础 ---------- */
body.bym-on {
  width: auto !important;
  min-width: 0 !important;
  background: var(--bym-bg) !important;
  color: var(--bym-text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ---------- 顶部：收起广告横幅，压缩为工具条 ---------- */
body.bym-on #top_head {
  height: auto !important;
  min-height: 60px;
  max-width: 1120px;
  margin: 0 auto !important;
  padding: 10px 16px 0 !important;
  display: flex !important;
  align-items: center !important;
  gap: 16px;
  background: transparent !important;
  overflow: visible !important;
  border: 0 !important;
}

body.bym-on #top_logo {
  order: 1;
  flex: 0 0 auto;
  margin: 0 !important;
}
body.bym-on #top_logo img {
  display: block;
  height: 34px !important;
  width: auto !important;
}

body.bym-on #ban_ner { display: none !important; }

body.bym-on #top_menu {
  order: 2;
  margin-left: auto !important;
  float: none !important;
}
body.bym-on #top_menu ul {
  display: flex !important;
  align-items: center;
  gap: 18px;
  margin: 0 !important;
  padding: 0 !important;
}
body.bym-on #top_menu li {
  margin: 0 !important;
  list-style: none;
}
body.bym-on #top_menu a {
  color: var(--bym-text-muted) !important;
  font-size: 12px !important;
  text-decoration: none !important;
  transition: color .15s ease;
}
body.bym-on #top_menu a:hover { color: var(--bym-accent) !important; }

/* ---------- 左侧栏 / 广告：阅读页默认隐藏，菜单收进抽屉 ---------- */
body.bym-on #menu,
body.bym-on #left_adv,
body.bym-on #left_line {
  display: none !important;
}

body.bym-on.bym-menu-open #menu {
  display: block !important;
  position: fixed !important;
  top: 76px !important;
  left: 16px !important;
  bottom: 52px !important;
  width: 240px !important;
  max-width: calc(100vw - 32px) !important;
  margin: 0 !important;
  padding: 10px !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: none;
  -ms-overflow-style: none;
  z-index: 2147482998 !important;
  background: #fff !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: 14px !important;
  box-shadow: 0 24px 70px -20px rgba(15, 23, 42, .45) !important;
  box-sizing: border-box;
}
body.bym-on.bym-menu-open #menu::-webkit-scrollbar,
body.bym-on.bym-menu-open #menu *::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
}
body.bym-on.bym-menu-open #menu #left_adv,
body.bym-on.bym-menu-open #menu .m-hide { display: none !important; }
body.bym-on.bym-menu-open #menu #xlist,
body.bym-on.bym-menu-open #menu #u_login {
  width: auto !important;
  margin: 0 0 10px !important;
  border-radius: 10px !important;
  overflow: hidden;
}
body.bym-on.bym-menu-open #menu a {
  color: var(--bym-text-mid) !important;
  text-decoration: none !important;
}
body.bym-on.bym-menu-open #menu a:hover { color: var(--bym-accent) !important; }

#bym-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147482997;
  display: none;
  background: rgba(15, 23, 42, .36);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}
body.bym-menu-open #bym-overlay { display: block; }

/* ---------- 主容器：居中自适应 ---------- */
body.bym-on #main {
  margin: 8px auto 48px !important;
  width: calc(100% - 32px) !important;
  max-width: 1120px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}

/* ---------- 面包屑 ---------- */
body.bym-on #notice {
  padding: 6px 4px 10px !important;
  border: 0 !important;
  background: transparent !important;
  font-size: 12px !important;
  line-height: 1.6;
  color: var(--bym-text-faint) !important;
}
body.bym-on #notice a {
  color: var(--bym-text-muted) !important;
  text-decoration: none !important;
}
body.bym-on #notice a:hover { color: var(--bym-accent) !important; }

/* ---------- 内容区不再裁剪 ---------- */
body.bym-on #body {
  width: 100% !important;
  overflow: visible !important;
}
body.bym-on #body .b-content {
  overflow: visible !important;
}

`;

  const CSS_TOOLBARS = String.raw`
/* ---------- 顶部 / 底部操作条 ---------- */
body.bym-on #body > .t-pre,
body.bym-on #body > .t-pre-bottom {
  position: static !important;
  top: auto;
  z-index: auto;
  display: flex !important;
  align-items: center !important;
  flex-wrap: wrap;
  gap: 10px;
  width: 100% !important;
  min-height: 46px;
  margin: 0 0 12px !important;
  padding: 7px 12px !important;
  box-sizing: border-box !important;
  background: rgba(255, 255, 255, .92) !important;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  border: 1px solid var(--bym-border) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 28px -22px rgba(15, 23, 42, .45);
}
body.bym-on #body > .t-pre-bottom {
  margin: 14px 0 0 !important;
}
/* 底部工具条：搜索在左，分页在右 */
body.bym-on #body > .t-pre-bottom .t-btn {
  order: 1;
  flex: 1 1 auto;
  min-width: 0;
}
body.bym-on #body > .t-pre-bottom .page {
  order: 2;
}

body.bym-on #body > .t-pre .page,
body.bym-on #body > .t-pre-bottom .page {
  float: none !important;
  margin-left: auto !important;
  padding: 0 !important;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 顶部工具条：分页靠左，发文按钮靠右，左右平衡 */
body.bym-on #body > .t-pre .page { margin-left: 0 !important; }
body.bym-on #body > .t-pre .t-btn { margin-left: auto; }

body.bym-on .t-btn {
  display: flex !important;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
body.bym-on .t-btn a {
  display: inline-flex !important;
  align-items: center;
  padding: 5px 12px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: var(--bym-accent) !important;
  color: #fff !important;
  font-size: 13px !important;
  line-height: 1.4;
  text-decoration: none !important;
  transition: background .15s ease, transform .15s ease;
}
body.bym-on .t-btn a:hover {
  background: var(--bym-accent-strong) !important;
  color: #fff !important;
  transform: translateY(-1px);
}

/* 底部搜索表单（保留原有搜索 / 精华帖 / 带附件等筛选功能） */
body.bym-on #f_search {
  display: flex !important;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 !important;
  padding: 0 !important;
}
body.bym-on #f_search .input-text {
  width: 12em !important;
  max-width: 40vw;
  height: 28px;
  box-sizing: border-box;
}
body.bym-on #f_search label {
  display: inline-flex;
  align-items: center;
  gap: 0;
  margin: 0 2px 0 0;
  color: var(--bym-text-muted) !important;
  font-size: 12px !important;
  white-space: nowrap;
}
/* 复选框与「精华帖 / 带附件」之间只留一点距离 */
body.bym-on #f_search input[type="checkbox"] {
  margin: 0 -3px 0 0 !important;
  accent-color: var(--bym-accent);
}
body.bym-on #f_search .button { margin-left: 2px; }

/* 输入框 / 按钮 */
body.bym-on .input-text {
  border: 1px solid var(--bym-border-strong) !important;
  border-radius: 8px !important;
  background: #fff !important;
  padding: 4px 8px !important;
  font-size: 12px !important;
  color: #334155 !important;
}
body.bym-on .button {
  border: 0 !important;
  border-radius: 8px !important;
  background: var(--bym-accent-soft) !important;
  color: var(--bym-text-mid) !important;
  padding: 5px 10px !important;
  font-size: 12px !important;
  cursor: pointer;
}
body.bym-on .button:hover { background: #e2e8f3 !important; }

/* ---------- 分页 ---------- */
body.bym-on .pagination {
  display: flex !important;
  align-items: center;
  gap: 5px;
  margin: 0 !important;
  padding: 0 !important;
  font-size: 12px !important;
  color: var(--bym-text-muted) !important;
  list-style: none;
}
body.bym-on .page-main {
  display: flex !important;
  align-items: center;
  gap: 4px;
  margin: 0 !important;
  padding: 0 !important;
}
body.bym-on .page-main li { list-style: none; }
body.bym-on .page-main a {
  display: inline-block;
  padding: 3px 9px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: var(--bym-surface-muted) !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
  line-height: 1.5;
  text-decoration: none !important;
  transition: background .15s ease, color .15s ease;
}
body.bym-on .page-select a {
  background: var(--bym-accent) !important;
  color: #fff !important;
}
body.bym-on .page-normal a:hover {
  background: #dbe7fb !important;
  color: var(--bym-accent-strong) !important;
}
body.bym-on .page-jump input[type="text"] { width: 26px !important; }

`;

  const CSS_HEAD = String.raw`
/* ---------- 文章标题条 ---------- */
body.bym-on #body > .b-head {
  display: flex !important;
  align-items: center !important;
  gap: 14px;
  height: auto !important;
  margin: 0 0 12px !important;
  padding: 16px 20px !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: 14px !important;
  background: #fff !important;
  color: #0f172a !important;
  font-size: 16px !important;
  font-weight: 650 !important;
  line-height: 1.45;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 16px 40px -34px rgba(15, 23, 42, .5);
}
body.bym-on #body > .b-head .n-left {
  display: block;
  order: 1;
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
body.bym-on #body > .b-head .n-right {
  float: none !important;
  order: 2;
  margin-left: auto !important;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  font-size: 11px !important;
  font-weight: 400 !important;
  color: var(--bym-text-faint) !important;
}
body.bym-on #body > .b-head .n-right img { opacity: .55; }
/* 站点给「分享到:」写了内联 color:#eee，浅色下几乎看不见 */
body.bym-on #body > .b-head #a_share {
  color: var(--bym-text-faint) !important;
  font-size: 11px !important;
}

`;

  const CSS_FLOORS = String.raw`
/* ---------- 楼层卡片 ---------- */
body.bym-on .b-content {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  border-radius: 0 !important;
  margin: 0 !important;
  overflow: visible !important;
}

body.bym-on .a-wrap {
  margin: 0 0 7px !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: 14px !important;
  background: #fff !important;
  overflow: hidden !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 18px 44px -40px rgba(15, 23, 42, .55);
}
body.bym-on .a-wrap.kb {
  border-color: var(--bym-accent) !important;
  box-shadow: 0 0 0 3px rgba(47, 111, 208, .14) !important;
}

/* 把楼层表格改成 flex 布局：彻底摆脱表格列宽联动 */
body.bym-on table.article,
body.bym-on table.article > tbody {
  display: block !important;
  width: 100% !important;
  border-collapse: collapse !important;
  background: transparent !important;
}
body.bym-on table.article td:not(:where(.markdown td)) {
  background: transparent !important;
  vertical-align: top !important;
}
/* 注意：被折叠楼层的占位单元格由站点 JS 控制 display，
   这里不要强制 display，否则「手贱想看」按钮永远不出现 */

/* 正文里的 markdown 表格：站点 gfm 样式写死了白底和 #ccc 边框，
   这里换成主题色。不加 !important，帖子里自带的单元格底色仍然优先 */
body.bym-on .a-content-wrap .markdown table tr,
body.bym-on .a-content-wrap .markdown table tr td {
  background: #fff;
}
body.bym-on .a-content-wrap .markdown table thead tr,
body.bym-on .a-content-wrap .markdown table thead tr td {
  background: var(--bym-surface-muted);
}
body.bym-on .a-content-wrap .markdown table tbody tr:nth-child(2n) td {
  background: var(--bym-surface-tint);
}
body.bym-on .a-content-wrap .markdown table td,
body.bym-on .a-content-wrap .markdown table th {
  border-color: var(--bym-border);
}

/* 楼层头：作者 + 操作 */
body.bym-on .a-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  flex-wrap: wrap;
  gap: 6px 20px;
  height: auto !important;
  padding: 0 !important;
  background: var(--bym-surface-tint) !important;
  border-bottom: 1px solid var(--bym-surface-muted) !important;
}
body.bym-on .a-head td {
  padding: 9px 16px !important;
  border: 0 !important;
  vertical-align: middle !important;
}
body.bym-on .a-head > td:first-child {
  flex: 0 0 auto;
}
body.bym-on .a-head > td:last-child {
  flex: 1 1 auto;
  min-width: 0;
  display: flex !important;
  justify-content: flex-end;
}
body.bym-on .a-head .a-left {
  display: flex !important;
  align-items: center;
  width: auto !important;
  border-right: 0 !important;
  white-space: nowrap;
}
body.bym-on .a-head .a-left .a-pos {
  margin-left: 8px;
}
body.bym-on .a-u-name {
  font-size: 13px !important;
  font-weight: 700 !important;
  color: var(--bym-accent-strong) !important;
}
body.bym-on .a-u-sex { opacity: .7; }

body.bym-on .a-func {
  float: none !important;
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 2px 14px !important;
  font-size: 0;
}
body.bym-on .a-head .a-func { justify-content: flex-end; }
body.bym-on .a-func li {
  display: inline-flex !important;
  align-items: center;
  margin: 0 !important;
}
body.bym-on .a-func li a {
  color: var(--bym-text-muted) !important;
  font-size: 12px !important;
  text-decoration: none !important;
  transition: color .15s ease;
}
body.bym-on .a-func li a:hover { color: var(--bym-accent) !important; }
body.bym-on .a-func samp { opacity: .55; }

/* 楼主 / 沙发等徽标 */
body.bym-on .a-pos {
  display: inline-block;
  padding: 1px 8px !important;
  border-radius: 999px !important;
  background: var(--bym-accent) !important;
  color: #fff !important;
  font-size: 11px !important;
  font-weight: 600;
  line-height: 1.7;
}

/* 正文行：头像列 + 内容列 */
body.bym-on .a-body {
  display: flex !important;
  align-items: stretch;
}
body.bym-on .a-body > * { box-sizing: border-box; }
body.bym-on .a-body > .a-content {
  flex: 1 1 auto;
  min-width: 0;
}

/* 头像列 */
body.bym-on .a-body .a-left {
  flex: 0 0 184px;
  width: 184px !important;
  padding: 10px !important;
  border-right: 1px solid #f1f5f9 !important;
  background: var(--bym-surface-soft) !important;
  text-align: center;
  box-sizing: border-box;
  overflow: visible !important;
}
/* 普通楼层不再画右侧分隔线：用户资料点开头像即可查看，左栏尽量干净 */
body.bym-on .a-wrap:not(.bym-anon) .a-body .a-left {
  border-right: 0 !important;
}
body.bym-on .a-body .a-left > div {
  width: auto !important;
  margin: 0 !important;
  padding: 0 !important;
}
body.bym-on .a-body .a-left .a-u-img {
  width: auto !important;
  margin: 0 auto 8px !important;
  overflow: visible !important;
}
body.bym-on .a-body .a-left img {
  display: block;
  width: 84px !important;
  height: 84px !important;
  margin: 0 auto !important;
  padding: 4px !important;
  border: 1px solid #eef2f8 !important;
  border-radius: 12px !important;
  background: #fff !important;
  object-fit: contain;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(15, 23, 42, .08);
}
/* 保留「关注」小按钮（站点 iframe），压成紧凑尺寸 */
body.bym-on .a-body .a-left iframe {
  display: block !important;
  width: 63px !important;
  height: 24px !important;
  margin: 4px auto 6px !important;
  border: 0 !important;
}

/* 匿名帖（IWhisper 等）和普通帖保持同样的用户栏宽度，
   正文与底部赞踩才能从同一位置开始 */
body.bym-on .a-wrap.bym-anon .a-body .a-left img {
  width: 64px !important;
  height: 64px !important;
}

/* 用户名 + 等级/文章/积分：从站点的 120px 浮动列表改为不裁切的网格 */
body.bym-on .a-body .a-left .a-u-uid {
  width: auto !important;
  margin: 0 0 6px !important;
  overflow: visible !important;
  color: #334155 !important;
  font-size: 12px !important;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
  overflow-wrap: anywhere;
}
body.bym-on .a-body .a-left .a-u-uid a {
  color: inherit !important;
  text-decoration: none !important;
}
body.bym-on .a-body .a-left .a-u-uid a:hover { color: var(--bym-accent) !important; }
body.bym-on .a-body .a-left .a-u-info {
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1px 8px;
  width: auto !important;
  max-width: 100% !important;
  margin: 0 0 8px !important;
  padding: 0 2px !important;
  overflow: visible !important;
  font-size: 11.5px;
  line-height: 1.6;
  text-align: left;
}
body.bym-on .a-body .a-left .a-u-info dt,
body.bym-on .a-body .a-left .a-u-info dd {
  float: none !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  white-space: normal;
}
body.bym-on .a-body .a-left .a-u-info dt { color: var(--bym-text-faint) !important; white-space: nowrap; }
body.bym-on .a-body .a-left .a-u-info dd { color: var(--bym-text-mid) !important; overflow-wrap: anywhere; }
/* 等级 / 文章数 / 积分等信息点开头像就能看到，楼层里不再重复占位 */
body.bym-on .a-body .a-left .a-u-info { display: none !important; }

/* 查看 / 发信 / 加好友：由脚本移入左栏，横向排在用户信息下方
   图标是 <a> 的兄弟节点，背景放在 <li> 上，避免图标被按钮底色盖住 */
body.bym-on .a-body .a-left .a-func-info {
  display: flex !important;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  width: 100% !important;
  margin: 10px 0 0 !important;
  padding: 10px 0 0 !important;
  gap: 4px !important;
  border-top: 1px dashed var(--bym-surface-muted);
  font-size: 11px;
}
body.bym-on .a-body .a-left .a-func-info li {
  position: relative;
  display: flex !important;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  width: auto !important;
  min-width: 0;
  margin: 0 !important;
  padding: 4px 2px !important;
  box-sizing: border-box;
  border-radius: 8px !important;
  background: var(--bym-accent-soft) !important;
  transition: background .15s ease;
}
body.bym-on .a-body .a-left .a-func-info li:hover { background: #dbe7fb !important; }
body.bym-on .a-body .a-left .a-func-info li a {
  position: static !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: auto !important;
  padding: 0 !important;
  box-sizing: border-box;
  border-radius: 0 !important;
  background: none !important;
  color: var(--bym-text-mid) !important;
  font-size: 11px !important;
  line-height: 1.4;
  white-space: nowrap;
  text-align: center;
  transition: color .15s ease;
}
/* 整颗胶囊（含左侧图标）都可点击 */
body.bym-on .a-body .a-left .a-func-info li a::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 8px;
}
body.bym-on .a-body .a-left .a-func-info li:hover a { color: var(--bym-accent-strong) !important; }
body.bym-on .a-body .a-left .a-func-info samp {
  flex: 0 0 16px;
  position: relative;
  z-index: 1;
  width: 16px !important;
  height: 16px !important;
  margin: 0 2px 0 0 !important;
  opacity: .75;
  pointer-events: none;
}
/* 查看功能移到头像点击；加好友稍微加宽 */
body.bym-on .a-func-info li.bym-action-view { display: none !important; }
body.bym-on .a-body .a-left .a-func-info li.bym-action-friend { flex-grow: 1.35; }
/* 头像本身包一层真实链接，点击时由站点自己的 /user/query/ 处理器打开资料对话框 */
body.bym-on .a-body .a-left .a-u-img > .bym-avatar-link {
  display: block !important;
  width: fit-content;
  margin: 0 auto !important;
  border-radius: 12px;
  cursor: pointer;
  text-decoration: none !important;
}

/* 正文 */
body.bym-on .a-content {
  padding: 16px 20px 18px !important;
  color: var(--bym-text) !important;
  /* 正文字号 14px；行距比旧版紧凑一些 */
  font-size: 14px !important;
  line-height: 1.6 !important;
  word-break: break-word;
  overflow-wrap: anywhere;
}
body.bym-on .a-content-wrap {
  color: inherit !important;
  font-size: inherit !important;
  overflow: visible !important;
}
/* 落款移走后遗留的空行 */
body.bym-on .bym-tail-blank { display: none !important; }
/* 发信人 / 标题 / 发信站：弱化为辅助信息 */
body.bym-on .bym-meta {
  margin: 0 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--bym-surface-muted);
  color: var(--bym-text-faint);
  font-size: 12px;
  line-height: 1.5;
}
body.bym-on .bym-meta font { color: inherit !important; }
/* 默认只显示「发信站」一行，点右侧小箭头展开发信人 / 标题 */
body.bym-on .bym-meta-extra { display: none; }
body.bym-on .bym-meta.bym-meta-open .bym-meta-extra { display: inline; }
/* 「※ 来源 / 修改」也并入发信信息：放在发信站下面，折叠时同样隐藏 */
body.bym-on .bym-meta-source { display: none; }
body.bym-on .bym-meta.bym-meta-open .bym-meta-source { display: inline; }
body.bym-on .bym-meta-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin: 0 0 0 4px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--bym-text-faint);
  font: 14px/1 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  vertical-align: -2px;
  cursor: pointer;
  opacity: .65;
  transform: rotate(90deg);
  transition: transform .15s ease, background .15s ease, color .15s ease;
}
body.bym-on .bym-meta-toggle:hover {
  background: var(--bym-surface-muted);
  color: var(--bym-text-mid);
  opacity: 1;
}
body.bym-on .bym-meta.bym-meta-open .bym-meta-toggle { transform: rotate(-90deg); }
body.bym-on .a-content-wrap font {
  font-size: inherit !important;
  line-height: inherit !important;
}
body.bym-on .a-content-wrap a {
  color: var(--bym-link) !important;
  text-decoration: none !important;
}
body.bym-on .a-content-wrap a:hover { text-decoration: underline !important; }
/* ※ 来源 / 发信站：进一步弱化 */
body.bym-on .a-content-wrap .bym-source {
  color: #a8b3c2 !important;
  font-size: 11.5px !important;
  line-height: 1.5;
}
body.bym-on .a-content-wrap .bym-source a {
  color: #a8b3c2 !important;
  text-decoration: none !important;
}
body.bym-on .a-content-wrap .bym-source a:hover { text-decoration: underline !important; }
body.bym-on .a-content-wrap img {
  max-width: 100% !important;
  height: auto !important;
  border-radius: 8px;
}
/* 站内小表情不要被放大成正文那么大。
   表情的 alt 有 ema2 也有 em12，统一由脚本打上 bym-emoji-img 标记。 */
body.bym-on .a-content-wrap img[alt^="ema"],
body.bym-on .a-content-wrap img.bym-emoji-img {
  height: 1.6em !important;
  width: auto !important;
  vertical-align: -0.3em;
  border-radius: 0 !important;
}

/* 被折叠楼层的「手贱想看」占位 */
body.bym-on .a-body > .a-content2 {
  flex: 1 1 auto;
  padding: 16px 20px !important;
}
body.bym-on .a-content2 .a-background {
  width: auto !important;
  max-width: 420px;
  margin: 0 !important;
  padding: 14px 18px !important;
  border: 1px dashed var(--bym-border-strong) !important;
  border-radius: 10px !important;
  background: var(--bym-surface-tint) !important;
}
body.bym-on .a-content2 .a-background p {
  margin: 0 0 6px !important;
  color: var(--bym-text-muted) !important;
  font-family: inherit !important;
  font-size: 13px !important;
  line-height: 1.7;
}
body.bym-on .a-content2 .a-func-dispCai {
  margin-top: 6px !important;
  padding: 4px 12px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: var(--bym-surface-muted) !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
  cursor: pointer;
}

/* 楼层底部：赞/踩/返回顶部 */
body.bym-on .a-bottom {
  display: flex !important;
  /* 站点给这一行写死了 23px；不放开的话，单元格的内边距只会向上下溢出，行高不会真的变大 */
  height: auto !important;
  /* 两栏等高，分隔线才不会在左栏下方错位 */
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
}
body.bym-on .a-bottom td {
  display: flex !important;
  align-items: center;
  gap: 12px;
  padding: 12px 16px !important;
  border-top: 1px solid #f1f5f9 !important;
  background: var(--bym-surface-soft) !important;
}
/* 按钮在头像列里（窄屏 / 匿名帖）时，空出来的底部左单元格不再占位 */
body.bym-on .a-wrap.bym-actions-moved:not(.bym-actions-bottom) .a-bottom > .a-left,
body.bym-on .a-wrap.bym-actions-empty .a-bottom > .a-left { display: none !important; }
body.bym-on .a-bottom > td:last-child {
  flex: 1 1 auto;
  min-width: 0;
}
/* 宽屏：发信 / 加好友落在头像列正下方，赞踩跟在它们左边；
   不再占用户的额外高度，也不跑到赞踩右边 */
body.bym-on .a-wrap.bym-actions-bottom .a-bottom > .a-left {
  display: flex !important;
  flex: 0 0 184px;
  width: 184px !important;
  box-sizing: border-box;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom > td:last-child {
  /* 底部两栏之间有 12px gap；再补 8px，正好和正文文字左边缘对齐 */
  padding-left: 8px !important;
}
/* 按钮不在底部时，状态栏仍与正文左边缘对齐 */
body.bym-on .a-wrap.bym-actions-moved:not(.bym-actions-bottom) .a-bottom > td:last-child,
body.bym-on .a-wrap.bym-actions-empty .a-bottom > td:last-child {
  padding-left: calc(184px + 20px) !important;
}
body.bym-on .a-status {
  float: none !important;
  display: inline-flex !important;
  align-items: center;
  gap: 4px 14px;
  margin: 0 auto 0 0 !important;
  padding: 0 !important;
}
body.bym-on .a-status li {
  display: inline-flex !important;
  align-items: center;
  margin: 0 !important;
}
body.bym-on .a-status a {
  display: inline-flex !important;
  align-items: center;
  color: var(--bym-text-muted) !important;
  font-size: 12px !important;
  line-height: 1.6;
  text-decoration: none !important;
}
body.bym-on .a-status a:hover { color: var(--bym-accent) !important; }
/* 统一卡片底部与精彩回复：图标 16×16，和文字垂直居中对齐 */
body.bym-on .a-status samp,
body.bym-on .a-nice-comment-func samp {
  flex: 0 0 16px;
  width: 16px !important;
  height: 16px !important;
  margin: 0 4px 0 0 !important;
  vertical-align: middle !important;
}
body.bym-on .a-back {
  float: right !important;
  color: var(--bym-text-faint) !important;
  font-size: 12px !important;
  text-decoration: none !important;
}
body.bym-on .a-back:hover { color: var(--bym-accent) !important; }

/* 宽屏非匿名楼层：发信 / 加好友并到赞踩这一行，减少卡片高度。
   窄屏（<=900px）由脚本把按钮放回用户框，行为与之前一致。 */
body.bym-on .a-wrap.bym-actions-bottom .a-status { margin-right: 0 !important; }
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info {
  display: inline-flex !important;
  flex: 0 0 auto;
  flex-flow: row nowrap;
  align-items: center;
  gap: 6px !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  font-size: 11.5px;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info li {
  position: relative;
  display: inline-flex !important;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: auto !important;
  margin: 0 !important;
  padding: 4px 9px !important;
  box-sizing: border-box;
  border-radius: 8px !important;
  background: var(--bym-accent-soft) !important;
  transition: background .15s ease;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info li:hover {
  background: #dbe7fb !important;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info li a {
  position: static !important;
  display: inline-flex !important;
  align-items: center;
  gap: 2px;
  width: auto !important;
  padding: 0 !important;
  border-radius: 0 !important;
  background: none !important;
  color: var(--bym-text-mid) !important;
  font-size: 11.5px !important;
  line-height: 1.4;
  white-space: nowrap;
  text-decoration: none !important;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info li a::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 8px;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info li:hover a {
  color: var(--bym-accent-strong) !important;
}
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info samp {
  flex: 0 0 16px;
  position: relative;
  z-index: 1;
  width: 16px !important;
  height: 16px !important;
  margin: 0 2px 0 0 !important;
  opacity: .75;
  pointer-events: none;
}
body.bym-on .a-wrap.bym-actions-bottom .a-back {
  float: none !important;
  margin-left: auto !important;
}
/* 两种落点都要压住上面的 li 布局规则 */
body.bym-on .a-body .a-left .a-func-info li.bym-action-view,
body.bym-on .a-wrap.bym-actions-bottom .a-bottom .a-func-info li.bym-action-view {
  display: none !important;
}

/* ---------- 媒体外链卡片：先占位，点击后才加载播放器 ---------- */
body.bym-on .bym-embed {
  margin: 10px 0 12px;
  border: 1px solid var(--bym-surface-muted);
  border-radius: 10px;
  background: var(--bym-surface);
  overflow: hidden;
  box-sizing: border-box;
}
body.bym-on .bym-embed-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 12px;
  border-bottom: 1px solid var(--bym-surface-muted);
  background: var(--bym-surface-soft);
  font-size: 12px;
  line-height: 1.5;
}
body.bym-on .bym-embed-badge {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bym-accent-soft);
  color: var(--bym-accent-strong);
  font-size: 11px;
}
body.bym-on .bym-embed-origin {
  min-width: 0;
  overflow: hidden;
  color: var(--bym-text-muted) !important;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: none !important;
}
body.bym-on .bym-embed-origin:hover { color: var(--bym-accent-strong) !important; }
body.bym-on .bym-embed-body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 0;
  background: #0f172a;
  color: #cbd5e1;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.5;
  cursor: pointer;
}
body.bym-on .bym-embed-body:hover { color: #fff; }
body.bym-on .bym-embed-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding-left: 3px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .14);
  font-size: 18px;
  box-sizing: border-box;
}
body.bym-on .bym-embed-tip { opacity: .7; }
body.bym-on .bym-embed-loaded .bym-embed-body {
  aspect-ratio: 16 / 9;
  background: #000;
}
body.bym-on .bym-embed-body iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
body.bym-on .bym-embed-audio .bym-embed-body {
  aspect-ratio: auto;
  height: 66px;
  background: var(--bym-surface-soft);
}
body.bym-on .bym-embed-audio .bym-embed-play { display: none; }

`;

  const CSS_NICE = String.raw`
/* ---------- 精彩回复：核心修复 ---------- */
body.bym-on #nice_view {
  width: auto !important;
  max-width: 100% !important;
  margin: 26px 0 0 !important;
  padding: 0 !important;
  border: 1px solid #f6e3c5 !important;
  border-radius: 12px !important;
  background: linear-gradient(180deg, #fffdf8 0%, #fff9ef 100%) !important;
  overflow: hidden !important;
  box-sizing: border-box;
}

body.bym-on .a-nice-comment-divline {
  display: flex !important;
  align-items: center;
  gap: 8px;
  width: auto !important;
  max-width: 100% !important;
  height: auto !important;
  margin: 0 !important;
  padding: 12px 16px 8px !important;
  border: 0 !important;
  position: static !important;
  box-sizing: border-box;
}
body.bym-on .a-nice-comment-divline h3 {
  width: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  color: #b45309 !important;
  font-size: 14px !important;
  font-weight: 700;
}
body.bym-on .a-nice-comment-divline h3 span::before {
  content: "💬 ";
  font-size: 14px;
}
body.bym-on .a-nice-comment-divline h5 {
  width: auto !important;
  margin: 0 0 0 auto !important;
  background: transparent !important;
  text-align: right;
  font-size: 12px !important;
}
body.bym-on .a-nice-comment-divline h5 a {
  color: #9a6b2f !important;
  text-decoration: none !important;
}
body.bym-on .a-nice-comment-divline h5 a:hover { text-decoration: underline !important; }

body.bym-on .a-nice-comment {
  width: auto !important;
  max-width: 100% !important;
  margin: 0 12px 10px !important;
  border: 0 !important;
  background: transparent !important;
  box-sizing: border-box;
}
body.bym-on .a-nice-comment img { max-width: 100% !important; height: auto !important; }

body.bym-on .a-nice-comment-item {
  display: flex !important;
  align-items: flex-start !important;
  gap: 18px;
  width: auto !important;
  max-width: 100% !important;
  margin: 0 !important;
  padding: 6px 14px !important;
  box-sizing: border-box;
}
body.bym-on .a-nice-comment-item + .a-nice-comment-item {
  border-top: 1px dashed #f0d9b5 !important;
}
/* 头像固定尺寸，文字 / ID 单独一列，不再随头像大小错位
   图片本身使用和楼层头像完全相同的边框、内边距与 object-fit:contain，不裁切 */
body.bym-on .a-nice-comment-face {
  display: block !important;
  flex: 0 0 84px !important;
  width: 84px !important;
  height: 84px !important;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}
body.bym-on .a-nice-comment-face img {
  display: block !important;
  width: 84px !important;
  height: 84px !important;
  margin: 0 !important;
  padding: 4px !important;
  border: 1px solid #eef2f8 !important;
  border-radius: 12px !important;
  background: #fff !important;
  object-fit: contain !important;
  box-sizing: border-box;
  box-shadow: 0 2px 10px rgba(15, 23, 42, .08);
}
body.bym-on .a-nice-comment-cell {
  flex: 1 1 auto;
  min-width: 0 !important;
  margin-left: 0 !important;
  min-height: 0 !important;
}
body.bym-on .a-nice-comment-id { margin-bottom: 6px !important; }
body.bym-on .a-nice-comment-id a {
  color: #8a6a3b !important;
  font-size: 12px !important;
}
body.bym-on .a-nice-comment-content {
  margin-bottom: 6px !important;
  color: #3f3a33 !important;
  font-size: 14px !important;
  /* 和普通楼层正文保持一致的行距 */
  line-height: 1.6 !important;
  word-break: break-word;
  overflow-wrap: anywhere;
}
body.bym-on .a-nice-comment-func {
  float: none !important;
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px !important;
}
body.bym-on .a-nice-comment-func li {
  display: inline-flex !important;
  align-items: center;
  margin: 0 !important;
}
body.bym-on .a-nice-comment-func a {
  display: inline-flex !important;
  align-items: center;
  color: #9a7b52 !important;
  font-size: 12px !important;
  line-height: 1.4;
  text-decoration: none !important;
}
body.bym-on .a-nice-comment-func a:hover { color: #b45309 !important; }
body.bym-on .a-nice-comment-floor {
  margin: 0 !important;
  color: #a8a29e !important;
}

`;

  const CSS_COMPOSER = String.raw`
/* ---------- 快捷回复：固定在底部，压缩成一行 ---------- */
body.bym-on .a-comment {
  position: fixed !important;
  left: 50% !important;
  bottom: 10px !important;
  transform: translateX(-50%);
  z-index: 74;
  width: min(1120px, calc(100vw - 32px)) !important;
  margin: 0 !important;
  padding: 8px 10px !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: 14px !important;
  background: #fff !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 18px 44px -40px rgba(15, 23, 42, .55);
  box-sizing: border-box;
}
/* 输入框与「快捷回复」按钮同一行、同一高度 */
body.bym-on #quick_post {
  display: flex !important;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 8px;
}
body.bym-on .a-comment-txt {
  order: 1;
  flex: 1 1 0;
  width: auto !important;
  min-width: 0;
  margin-right: 0 !important;
}
body.bym-on .a-comment-btn {
  order: 2;
  float: none !important;
  display: flex !important;
  align-items: flex-end;
  flex: 0 0 auto;
  gap: 6px;
}
body.bym-on .a-comment-txt textarea {
  display: block;
  width: 100% !important;
  height: auto !important;
  min-height: 38px !important;
  max-height: 112px !important;
  padding: 8px 12px !important;
  border: 1px solid var(--bym-border-strong) !important;
  border-radius: 10px !important;
  background: var(--bym-surface-soft) !important;
  color: var(--bym-text) !important;
  font-size: 13.5px !important;
  line-height: 1.4 !important;
  box-sizing: border-box;
  overflow-y: hidden !important;
  resize: none;
}
body.bym-on .a-comment-txt textarea:focus {
  outline: 2px solid #c7daf7 !important;
  border-color: #7aa7e8 !important;
  background: #fff !important;
}
body.bym-on .a-comment-btn .button {
  width: 88px !important;
  height: 38px !important;
  min-height: 38px !important;
  align-self: center;
  border: 0 !important;
  border-radius: 10px !important;
  background: var(--bym-accent) !important;
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease;
}
body.bym-on .a-comment-btn .button:hover { background: var(--bym-accent-strong) !important; }

/* 表情面板默认收起，点「😊」后在输入框上方浮出，保留原有表情功能 */
#bym-emoji-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid var(--bym-border-strong);
  border-radius: 10px;
  background: #f4f7fc;
  color: var(--bym-text-mid);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
body.bym-on #bym-emoji-toggle { display: inline-flex; }
#bym-emoji-toggle:hover { background: #e8eef9; }
#bym-emoji-toggle[aria-expanded="true"] {
  background: var(--bym-accent);
  border-color: var(--bym-accent);
}

body.bym-on #em_img { display: none !important; }
body.bym-on .a-comment.bym-emoji-open #em_img {
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  bottom: calc(100% + 8px) !important;
  max-height: 230px;
  margin: 0 !important;
  padding: 10px 12px !important;
  /* 面板本身不滚动，滚动条只交给下面的表情框 */
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  background: #fff !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: 12px !important;
  box-shadow: 0 18px 44px -22px rgba(15, 23, 42, .45) !important;
  box-sizing: border-box;
  z-index: 76;
}
/* 具体表情：唯一可滚动的区域 */
body.bym-on #em_img .ubb-img {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 !important;
  padding: 0 2px 0 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
}
/* 四个分类按钮固定在表情框下方，靠右，不随表情滚动 */
body.bym-on .ubb-img-tab {
  flex: 0 0 auto;
  display: flex !important;
  justify-content: flex-end;
  width: 100% !important;
  gap: 6px;
  margin: 8px 0 0 !important;
  padding: 0 !important;
  overflow: visible !important;
}
body.bym-on .ubb-img-tab li {
  padding: 3px 10px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: var(--bym-surface-muted) !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
  cursor: pointer;
}
body.bym-on .ubb-img-tab li div { color: inherit !important; }
body.bym-on .ubb-img-tab li[_cur="1"] {
  background: var(--bym-accent) !important;
  color: #fff !important;
}
body.bym-on .ubb-img-tab li[_cur="1"] div { color: #fff !important; }

`;

  const CSS_FOOTER = String.raw`
/* ---------- 页脚 ---------- */
body.bym-on #bot_foot {
  max-width: 1120px !important;
  margin: 36px auto 40px !important;
  padding: 0 16px !important;
  display: flex !important;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: auto !important;
  border: 0 !important;
  background: transparent !important;
  opacity: .7;
}
body.bym-on #bot_logo img { height: 26px !important; width: auto !important; }
body.bym-on #bot_info {
  font-size: 11px !important;
  line-height: 1.7;
  color: var(--bym-text-faint) !important;
}

`;

  const CSS_RESPONSIVE = String.raw`
/* ---------- 窄屏适配 ---------- */
@media (max-width: 899.98px) {
  body.bym-on #top_menu { display: block !important; margin-left: auto !important; }
  body.bym-on #top_menu ul {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 12px !important;
  }
  body.bym-on #top_menu a { font-size: 11px !important; }
  body.bym-on #top_head { min-height: 52px; padding: 8px 12px 0 !important; }
  body.bym-on #main { width: calc(100% - 20px) !important; margin-top: 4px !important; }
  body.bym-on #notice { padding: 4px 2px 8px !important; }
  body.bym-on #body > .t-pre,
  body.bym-on #body > .t-pre-bottom { padding: 6px 8px !important; gap: 6px; }
  body.bym-on .t-btn a { padding: 4px 9px !important; font-size: 12px !important; }
  body.bym-on #body > .b-head { font-size: 16px !important; padding: 13px 16px !important; }
  body.bym-on.bym-menu-open #menu {
    top: 60px !important;
    left: 10px !important;
    bottom: 52px !important;
    width: 240px !important;
    max-width: calc(100vw - 20px) !important;
  }

  /* 头像列不再隐藏，改为卡片顶部的一条横向用户信息条 */
  body.bym-on .a-body { flex-direction: column; }
  body.bym-on .a-body .a-left {
    display: flex !important;
    flex: 0 0 auto;
    align-items: center;
    flex-wrap: wrap;
    width: 100% !important;
    gap: 4px 10px;
    padding: 10px 12px !important;
    border-right: 0 !important;
    border-bottom: 1px solid #f1f5f9 !important;
    text-align: left;
  }
  body.bym-on .a-body .a-left .a-u-img { flex: 0 0 auto; margin: 0 !important; }
  body.bym-on .a-body .a-left .a-u-img img {
    width: 48px !important;
    height: 48px !important;
    margin: 0 !important;
    padding: 2px !important;
    border-radius: 9px !important;
  }
  /* 匿名帖没有可展示的用户信息，窄屏直接隐藏头像栏 */
  body.bym-on .a-wrap.bym-anon .a-body .a-left { display: none !important; }
  body.bym-on .a-body .a-left .a-u-uid {
    flex: 0 0 auto;
    margin: 0 !important;
    text-align: left;
  }
  body.bym-on .a-body .a-left .a-u-info {
    flex: 0 1 auto;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  body.bym-on .a-body .a-left .a-func-info {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    width: auto !important;
    margin: 0 0 0 auto !important;
    padding: 0 !important;
    border-top: 0 !important;
    gap: 6px !important;
  }
  body.bym-on .a-body .a-left .a-func-info li {
    flex: 0 0 auto;
    width: auto !important;
    padding: 4px 7px !important;
  }
  body.bym-on .a-body .a-left .a-func-info li.bym-action-friend {
    flex-grow: 0;
    padding-left: 9px !important;
    padding-right: 9px !important;
  }
  body.bym-on .a-body .a-left .a-func-info li a {
    width: auto !important;
    padding: 0 !important;
  }

  body.bym-on .a-head td { padding: 8px 12px !important; }
  body.bym-on .a-func { gap: 2px 10px !important; }
  body.bym-on .a-content { padding: 14px 16px 16px !important; }
  body.bym-on .a-nice-comment { margin: 0 8px 8px !important; }
  body.bym-on .a-nice-comment-item { padding: 6px 10px !important; gap: 12px; }
  body.bym-on .a-nice-comment-face {
    flex-basis: 48px !important;
    width: 48px !important;
    height: 48px !important;
  }
  body.bym-on .a-nice-comment-face img {
    width: 48px !important;
    height: 48px !important;
    padding: 2px !important;
    border-radius: 9px !important;
  }
  /* 窄屏头像列已变成顶部横条，底部状态恢复通栏。
     :not(.bym-actions-bottom) 是为了压过上面宽屏缩进规则的同名选择器优先级 */
  body.bym-on .a-wrap.bym-actions-moved:not(.bym-actions-bottom) .a-bottom > td:last-child,
  body.bym-on .a-wrap.bym-actions-empty .a-bottom > td:last-child,
  body.bym-on .a-wrap.bym-anon .a-bottom > td:last-child {
    padding-left: 16px !important;
  }
  body.bym-on .a-comment { padding: 8px 10px !important; }
}

@media (max-width: 560px) {
  body.bym-on .a-comment-btn { width: auto !important; }
  body.bym-on .a-comment-btn .button {
    width: 78px !important;
    height: 38px !important;
    min-height: 38px !important;
    font-size: 12.5px !important;
  }
  #bym-emoji-toggle { width: 36px; height: 38px; flex: 0 0 36px; }
  body.bym-on .a-body .a-left .a-func-info {
    width: 100% !important;
    margin-left: 0 !important;
  }
  body.bym-on .a-body .a-left .a-func-info li,
  body.bym-on .a-body .a-left .a-func-info li.bym-action-friend {
    flex: 1 1 0;
    min-width: 0;
  }
  body.bym-on .a-body .a-left .a-func-info li a { max-width: 100%; }
}

`;

  const CSS_DOCK = String.raw`
/* ---------- 左下角控制条：简约版 / 主题 ---------- */
#bym-dock {
  position: fixed;
  left: 14px;
  bottom: 14px;
  z-index: 2147483000;
  display: none;
  align-items: center;
  gap: 6px;
}
body.bym-is-article.bym-ready #bym-dock { display: flex; }
#bym-dock button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid var(--bym-border-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, .92);
  color: var(--bym-text-mid);
  font: 12px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  cursor: pointer;
  box-shadow: 0 6px 20px -10px rgba(15, 23, 42, .5);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  opacity: .6;
  transition: opacity .15s ease, transform .15s ease;
}
#bym-dock button:hover { opacity: 1; transform: translateY(-1px); }
#bym-toggle.bym-off { color: var(--bym-text-faint); }
#bym-toggle .bym-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
}
#bym-toggle.bym-off .bym-dot { background: #cbd5e1; }
#bym-menu,
#bym-theme {
  padding: 6px 9px;
  font-size: 14px;
  line-height: 1;
}
/* 经典版下站点自己的菜单是可见的，不需要抽屉和主题按钮 */
body.bym-is-article:not(.bym-on) #bym-menu,
body.bym-is-article:not(.bym-on) #bym-theme {
  display: none;
}
/* 抽屉打开时收起左下角控制条，避免盖住菜单底部；点遮罩或按 Esc 关闭 */
body.bym-is-article.bym-ready.bym-menu-open #bym-dock {
  display: none;
}

`;

  const CSS_FLOATBAR = String.raw`
/* ==================================================================
   0.4.0：浮动标题 / 路径栏 + 底部工具栏与快捷回复
   ================================================================== */
/* 读文章时，滚动超过标题后出现的浮动栏：向下滚显示标题，向上滚显示路径 */
#bym-floatbar {
  display: none;
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translate(-50%, -10px);
  width: min(1120px, calc(100vw - 32px));
  height: 42px;
  z-index: 70;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  background: rgba(255, 255, 255, .94);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1px solid var(--bym-border);
  border-radius: 12px;
  box-shadow: 0 10px 30px -22px rgba(15, 23, 42, .55);
  box-sizing: border-box;
  transition: opacity .18s ease, transform .18s ease;
}
body.bym-on #bym-floatbar { display: block; }
#bym-floatbar.bym-visible {
  opacity: 1;
  transform: translate(-50%, 0);
  pointer-events: auto;
}
.bym-float-row {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  box-sizing: border-box;
  transition: transform .24s cubic-bezier(.2, .8, .2, 1), opacity .2s ease;
  will-change: transform;
}
.bym-float-title { transform: translateY(-110%); opacity: 0; cursor: pointer; }
.bym-float-path { transform: translateY(110%); opacity: 0; }
#bym-floatbar.bym-mode-title .bym-float-title { transform: translateY(0); opacity: 1; }
#bym-floatbar.bym-mode-path .bym-float-path { transform: translateY(0); opacity: 1; }
.bym-float-tag {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bym-accent-soft);
  color: var(--bym-text-muted);
  font-size: 11px;
  line-height: 1.6;
}
.bym-float-title-text,
.bym-float-path-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.bym-float-title-text {
  color: var(--bym-text);
  font-size: 13.5px;
  font-weight: 600;
}
.bym-float-path-text {
  color: var(--bym-text-muted);
  font-size: 12px;
}
.bym-float-path-text #notice_nav,
.bym-float-path-text > div {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
#bym-floatbar a {
  color: var(--bym-text-muted) !important;
  text-decoration: none !important;
}
#bym-floatbar a:hover { color: var(--bym-accent) !important; }

/* 右下角：回到本楼顶部。只在楼层很高、楼顶已经滚出视口时出现 */
#bym-floor-top {
  position: fixed;
  right: 14px;
  bottom: calc(var(--bym-composer-h, 54px) + 72px);
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border: 1px solid var(--bym-border-strong);
  border-radius: 999px;
  background: rgba(255, 255, 255, .94);
  color: var(--bym-text-mid);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 8px 22px -16px rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  opacity: 0;
  visibility: hidden;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity .16s ease, transform .16s ease, visibility .16s ease;
}
#bym-floor-top.bym-visible {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  pointer-events: auto;
}
#bym-floor-top .bym-floor-top-arrow {
  padding: 0px 0px 3.5px;
  font-size: 13px;
  line-height: 1;
  color: var(--bym-accent);
}
#bym-floor-top.bym-visible:hover {
  background: #fff;
  border-color: var(--bym-accent);
}

/* 桌面端：底部工具栏吸底，快捷回复只占一行 */
@media (min-width: 900px) {
  body.bym-on #body > .t-pre-bottom {
    position: fixed !important;
    left: 50% !important;
    bottom: calc(var(--bym-composer-h, 54px) + 18px) !important;
    transform: translateX(-50%);
    z-index: 72;
    width: min(1120px, calc(100vw - 32px)) !important;
    min-height: 40px;
    margin: 0 !important;
    padding: 5px 10px !important;
  }
  /* 滚到页面末尾后，工具栏回到最后一张卡片之后，不再悬浮遮挡 */
  body.bym-on.bym-bottom-flow #body > .t-pre-bottom {
    position: static !important;
    left: auto !important;
    bottom: auto !important;
    transform: none !important;
    width: auto !important;
    margin: 10px 0 0 !important;
    z-index: auto;
  }
  body.bym-on #bym-dock { bottom: calc(var(--bym-composer-h, 54px) + 72px); }
}

/* 底部浮层会遮住末尾内容，给页面和页脚留出空间 */
body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 38px) !important; }
body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 42px) !important; }
@media (min-width: 900px) {
  body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 92px) !important; }
  body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 102px) !important; }
}
@media (max-width: 899.98px) {
  body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 38px) !important; }
  body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 42px) !important; }
  body.bym-on #bym-dock { bottom: calc(var(--bym-composer-h, 54px) + 22px); }
  body.bym-on .a-comment { bottom: 8px !important; width: calc(100vw - 20px) !important; }
  #bym-floatbar {
    top: 6px;
    width: calc(100vw - 20px);
    height: 38px;
  }
  #bym-floor-top {
    right: 10px;
    bottom: calc(var(--bym-composer-h, 54px) + 22px);
  }
}

`;

  const CSS_DIALOG = String.raw`
/* ==================================================================
   页内弹窗：把站点自带的 jQuery UI 对话框统一成简约版卡片风格
   （转载 / 转寄 / 用户资料 / 各类确认与提示都走这套结构）
   ================================================================== */
body.bym-on .ui-dialog {
  padding: 0 !important;
  box-sizing: border-box !important;
  max-width: calc(100vw - 20px) !important;
  max-height: calc(100vh - 20px) !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: var(--bym-dlg-radius, 12px) !important;
  background: var(--bym-surface-soft) !important;
  box-shadow: 0 16px 42px -26px rgba(15, 23, 42, .38) !important;
  overflow: hidden !important;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif !important;
}
/* 窗口越小，圆角越小；用户资料框保持原来的大圆角 */
body.bym-on .ui-dialog[data-bym-dialog-size="sm"] {
  --bym-dlg-radius: 8px;
  --bym-dlg-inner-radius: 6px;
}
body.bym-on .ui-dialog[data-bym-dialog-size="md"] {
  --bym-dlg-radius: 10px;
  --bym-dlg-inner-radius: 7px;
}
body.bym-on .ui-dialog[data-bym-dialog-size="lg"] {
  --bym-dlg-radius: 12px;
  --bym-dlg-inner-radius: 8px;
}
body.bym-on .ui-dialog.bym-dialog-profile {
  --bym-dlg-radius: 14px;
  --bym-dlg-inner-radius: 10px;
}
body.bym-on .ui-dialog .ui-dialog-titlebar {
  padding: 10px 44px 10px 18px !important;
  border: 0 !important;
  border-bottom: 1px solid var(--bym-surface-muted) !important;
  border-radius: 0 !important;
  background: var(--bym-surface-soft) !important;
  background-image: none !important;
  color: var(--bym-text) !important;
}
body.bym-on .ui-dialog .ui-dialog-title {
  font-size: 13px !important;
  font-weight: 600 !important;
  color: var(--bym-text) !important;
  line-height: 1.5 !important;
}
body.bym-on .ui-dialog .ui-dialog-titlebar-close {
  top: 50% !important;
  right: 12px !important;
  width: 24px !important;
  height: 24px !important;
  margin: -12px 0 0 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 6px !important;
  background: transparent !important;
  background-image: none !important;
}
body.bym-on .ui-dialog .ui-dialog-titlebar-close:hover { background: var(--bym-surface-muted) !important; }
body.bym-on .ui-dialog .ui-dialog-titlebar-close .ui-icon { display: none !important; }
body.bym-on .ui-dialog .ui-dialog-titlebar-close::after {
  content: '×';
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--bym-text-muted);
  font: 18px/1 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
body.bym-on .ui-dialog .ui-dialog-content {
  padding: 14px 18px !important;
  box-sizing: border-box !important;
  border: 0 !important;
  background: transparent !important;
  background-image: none !important;
  color: var(--bym-text-mid) !important;
  font-size: 13px !important;
  line-height: 1.7 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  max-height: calc(100vh - 150px) !important;
}
body.bym-on .ui-dialog .ui-dialog-content a { color: var(--bym-link) !important; }
/* 站点对成功 / 提示类弹窗调用 autoVerMiddle()，会把内容区高度写成固定像素；
   改为随内容自适应，避免短消息下方多出一块空白或莫名滚动条 */
body.bym-on .ui-dialog .ui-dialog-content.ui-widget-content.ui-state-highlight,
body.bym-on .ui-dialog .ui-dialog-content.ui-widget-content.ui-state-error {
  height: auto !important;
}
/* 内容很长时才出现滚动条；滚动条收细，避免默认样式显得笨重 */
body.bym-on .ui-dialog .ui-dialog-content {
  scrollbar-width: thin;
  scrollbar-color: var(--bym-border-strong) transparent;
}
body.bym-on .ui-dialog .ui-dialog-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
body.bym-on .ui-dialog .ui-dialog-content::-webkit-scrollbar-track { background: transparent; }
body.bym-on .ui-dialog .ui-dialog-content::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 4px;
  background-color: var(--bym-border-strong);
  background-clip: padding-box;
}
body.bym-on .ui-dialog .ui-dialog-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--bym-text-faint);
  background-clip: padding-box;
}
body.bym-on .ui-dialog .ui-dialog-buttonpane {
  margin: 0 !important;
  padding: 9px 18px !important;
  border: 0 !important;
  border-top: 1px solid var(--bym-surface-muted) !important;
  background: var(--bym-surface-soft) !important;
  background-image: none !important;
}
body.bym-on .ui-dialog .ui-dialog-buttonpane .ui-dialog-buttonset {
  float: none !important;
  width: auto !important;
  display: flex !important;
  justify-content: flex-end !important;
  align-items: center !important;
  gap: 8px !important;
}
body.bym-on .ui-dialog .ui-dialog-buttonpane button {
  margin: 0 !important;
  padding: 5px 14px !important;
  border: 1px solid var(--bym-border-strong) !important;
  border-radius: var(--bym-dlg-inner-radius, 8px) !important;
  background: #fff !important;
  background-image: none !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
  font-family: inherit !important;
  cursor: pointer;
}
body.bym-on .ui-dialog .ui-dialog-buttonpane button:hover {
  border-color: var(--bym-accent) !important;
  color: var(--bym-accent) !important;
}
body.bym-on .ui-dialog .ui-dialog-buttonpane button.ui-state-hover {
  background: var(--bym-accent-soft) !important;
}
/* 两个按钮时，第一个（确认）用主色；单个按钮（取消）保持中性 */
body.bym-on .ui-dialog .ui-dialog-buttonpane button:first-child:not(:only-child) {
  border-color: var(--bym-accent) !important;
  background: var(--bym-accent) !important;
  color: #fff !important;
}
body.bym-on .ui-dialog .ui-dialog-buttonpane button:first-child:not(:only-child):hover {
  background: var(--bym-accent-strong) !important;
  color: #fff !important;
}
body.bym-on .ui-widget-overlay {
  background: #0f172a !important;
  background-image: none !important;
  opacity: .38 !important;
}

/* 弹窗里的表单控件 */
body.bym-on .ui-dialog select {
  height: 28px;
  border: 1px solid var(--bym-border-strong) !important;
  border-radius: var(--bym-dlg-inner-radius, 8px) !important;
  background: #fff !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
}
body.bym-on .ui-dialog input[type="text"],
body.bym-on .ui-dialog input[type="password"],
body.bym-on .ui-dialog input[type="search"],
body.bym-on .ui-dialog textarea {
  border: 1px solid var(--bym-border-strong) !important;
  border-radius: var(--bym-dlg-inner-radius, 8px) !important;
  background: #fff !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
  padding: 5px 9px !important;
}
body.bym-on .ui-dialog .button {
  border: 0 !important;
  border-radius: var(--bym-dlg-inner-radius, 8px) !important;
  background: var(--bym-accent-soft) !important;
  color: var(--bym-text-mid) !important;
  padding: 5px 12px !important;
  font-size: 12px !important;
}
body.bym-on .ui-dialog .warning {
  color: #b45309 !important;
  background: #fff7ed !important;
  border: 1px solid #f0d6ad !important;
  border-radius: calc(var(--bym-dlg-inner-radius, 8px) + 2px) !important;
  padding: 9px 12px !important;
  line-height: 1.7 !important;
}
body.bym-on .ui-dialog .warning span { color: #b45309 !important; }

/* 用户资料弹窗（/user/query/）：压缩高度和留白，头像与资料并排 */
body.bym-on .ui-dialog .u-query { color: var(--bym-text-mid) !important; }
body.bym-on .ui-dialog .u-name {
  background: transparent !important;
  border-bottom: 1px solid var(--bym-surface-muted) !important;
  color: var(--bym-text) !important;
}
body.bym-on .ui-dialog .u-name a { color: var(--bym-link) !important; }

body.bym-on .ui-dialog.bym-dialog-profile .ui-dialog-content { padding: 10px 12px !important; }
body.bym-on .ui-dialog.bym-dialog-profile .u-query { padding: 0 !important; }
body.bym-on .ui-dialog.bym-dialog-profile .u-name {
  padding: 0 2px 6px !important;
  font-size: 13px !important;
  line-height: 1.45 !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-name a { padding: 0 6px !important; }

/* 头像固定在左列，昵称、性别等紧贴右侧；论坛属性单独一张卡 */
body.bym-on .ui-dialog.bym-dialog-profile .u-info {
  display: grid !important;
  grid-template-columns: 96px minmax(0, 1fr);
  grid-template-areas:
    "head head"
    "figure dl";
  align-items: start;
  column-gap: 12px;
  row-gap: 2px;
  margin: 0 0 6px !important;
  padding: 6px 10px 8px !important;
  border: 1px solid var(--bym-border) !important;
  border-radius: var(--bym-dlg-inner-radius, 8px) !important;
  background: #fff !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info > header {
  grid-area: head;
  margin: 0 !important;
  /* 标题文字缩进，和下面的字段错开 */
  padding: 0 0 4px 8px !important;
  border: 0 !important;
  background: var(--bym-surface-tint) !important;
  color: var(--bym-text-mid) !important;
  font-size: 12px !important;
  line-height: 1.5 !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info > figure {
  grid-area: figure;
  float: none !important;
  width: 96px !important;
  margin: 0 !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info > figure img {
  display: block;
  width: 100% !important;
  height: auto !important;
  max-height: 132px;
  object-fit: contain;
  box-sizing: border-box;
  padding: 2px !important;
  border: 1px solid var(--bym-accent) !important;
  border-radius: calc(var(--bym-dlg-inner-radius, 8px) - 2px) !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info > dl {
  grid-area: dl;
  display: grid !important;
  grid-template-columns: 58px minmax(0, 1fr);
  align-content: start;
  column-gap: 8px;
  float: none !important;
  width: auto !important;
  min-width: 0;
  margin: 0 !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info dt,
body.bym-on .ui-dialog.bym-dialog-profile .u-info dd {
  float: none !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  padding: 0 !important;
  line-height: 1.6 !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info dt {
  text-align: right;
  padding-right: 0 !important;
  color: var(--bym-text-faint) !important;
}
body.bym-on .ui-dialog.bym-dialog-profile .u-info dd {
  min-width: 0;
  color: var(--bym-text) !important;
}
/* 第二张卡没有头像，整行给论坛属性 */
body.bym-on .ui-dialog.bym-dialog-profile .u-info.u-detail {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    "head"
    "dl";
}
body.bym-on .ui-dialog.bym-dialog-profile .u-detail > dl {
  grid-template-columns: 76px minmax(0, 1fr);
}
body.bym-on .ui-dialog.bym-dialog-profile .u-search {
  padding-top: 6px !important;
  border-top: 1px solid var(--bym-surface-muted) !important;
  color: var(--bym-text-muted) !important;
}
/* 「查询用户:」和输入框之间留出明确的间距，并让三者垂直居中 */
body.bym-on .ui-dialog .u-search form {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 10px !important;
}
body.bym-on .ui-dialog .u-search label {
  padding-left: 0 !important;
  padding-right: 0 !important;
  white-space: nowrap;
}
body.bym-on .ui-dialog .u-search .input-text { margin-right: 0 !important; }
/* 很窄的窗口里（资料框本身只有三百多像素）稍微收窄头像和标签列，
   但仍然保持「头像在左、资料在右」 */
@media (max-width: 460px) {
  body.bym-on .ui-dialog.bym-dialog-profile .u-info {
    grid-template-columns: 76px minmax(0, 1fr);
    column-gap: 9px;
    padding: 5px 8px 7px !important;
  }
  body.bym-on .ui-dialog.bym-dialog-profile .u-info > figure { width: 76px !important; }
  body.bym-on .ui-dialog.bym-dialog-profile .u-info > figure img { max-height: 104px; }
  body.bym-on .ui-dialog.bym-dialog-profile .u-info > dl { grid-template-columns: 50px minmax(0, 1fr); column-gap: 6px; }
  body.bym-on .ui-dialog.bym-dialog-profile .u-detail > dl { grid-template-columns: 68px minmax(0, 1fr); }
  body.bym-on .ui-dialog .u-search form { flex-wrap: wrap; }
}

/* 匿名帖里按 ID 搜索没有对象，隐藏；赞 / 踩保留，由站点决定是否可用 */
body.bym-on li.bym-hide-search { display: none !important; }

/* 收藏状态：显示「已收藏」时用主色，操作中降低存在感 */
body.bym-on .a-func-collect.bym-collected { color: var(--bym-accent) !important; }
body.bym-on .a-func-collect.bym-collected samp { opacity: .65; }
body.bym-on .a-func-collect.bym-collect-busy { opacity: .55; pointer-events: none; }

/* 赞 / 踩：请求中降低存在感；已投过的楼主好评 / 差评用主色提示 */
body.bym-on .a-func-like.bym-vote-busy,
body.bym-on .a-func-cai.bym-vote-busy,
body.bym-on .a-func-support.bym-vote-busy,
body.bym-on .a-func-oppose.bym-vote-busy { opacity: .55; pointer-events: none; }
body.bym-on a.bym-voted { color: var(--bym-accent) !important; }

/* 弹窗打开时锁住页面滚动，避免页面和弹窗同时出现滚动条；
   scrollbar-gutter 保留滚动条占位，防止锁定瞬间页面横向跳动 */
html.bym-dialog-open { scrollbar-gutter: stable !important; }
html.bym-dialog-open,
html.bym-dialog-open body { overflow: hidden !important; }

`;

  const CSS_DARK = String.raw`
/* ==================================================================
   黑夜模式：跟随系统，或由左下角太阳/月亮按钮手动覆盖
   （只在帖子页且简约版开启时给 html 加 .bym-dark）
   ================================================================== */
html.bym-dark { background: #0d1117; color-scheme: dark; }

html.bym-dark body.bym-on { background: #0d1117 !important; color: #d7dee8; }
html.bym-dark body.bym-on #top_menu a { color: var(--bym-text-faint) !important; }
html.bym-dark body.bym-on #top_menu a:hover { color: #7fb0f5 !important; }
html.bym-dark body.bym-on #notice { color: #7d8a9c !important; }
html.bym-dark body.bym-on #notice a { color: #9aa7b8 !important; }
html.bym-dark body.bym-on #notice a:hover { color: #7fb0f5 !important; }

html.bym-dark body.bym-on #body > .t-pre,
html.bym-dark body.bym-on #body > .t-pre-bottom {
  background: rgba(22, 29, 39, .94) !important;
  border-color: #263041 !important;
  box-shadow: 0 8px 28px -22px rgba(0, 0, 0, .8);
}
html.bym-dark body.bym-on .page-main a {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .page-select a {
  background: var(--bym-accent) !important;
  color: #fff !important;
}
html.bym-dark body.bym-on .page-normal a:hover {
  background: #26364a !important;
  color: #cfe0ff !important;
}
html.bym-dark body.bym-on .pagination { color: var(--bym-text-faint) !important; }
html.bym-dark body.bym-on .input-text {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  color: #d7dee8 !important;
}
html.bym-dark body.bym-on .button {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .button:hover { background: #26364a !important; }
html.bym-dark body.bym-on #f_search label { color: var(--bym-text-faint) !important; }

html.bym-dark body.bym-on #body > .b-head {
  background: #161d27 !important;
  border-color: #263041 !important;
  color: #e6edf6 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 16px 40px -34px rgba(0, 0, 0, .9);
}
html.bym-dark body.bym-on #body > .b-head .n-right { color: #7d8a9c !important; }

html.bym-dark body.bym-on .a-wrap {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 18px 44px -40px rgba(0, 0, 0, .9);
}
html.bym-dark body.bym-on .a-wrap.kb {
  border-color: var(--bym-accent) !important;
  box-shadow: 0 0 0 3px rgba(47, 111, 208, .22) !important;
}
html.bym-dark body.bym-on .a-head {
  background: #131a23 !important;
  border-bottom-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-u-name,
html.bym-dark body.bym-on .a-u-name a { color: #a9c8fa !important; }
html.bym-dark body.bym-on .a-u-name a:hover { color: #dbe9ff !important; }
html.bym-dark body.bym-on .a-func li a { color: var(--bym-text-faint) !important; }
html.bym-dark body.bym-on .a-func li a:hover { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .a-body .a-left {
  background: #131a23 !important;
  border-right-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-body .a-left img {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  box-shadow: none;
}
html.bym-dark body.bym-on .a-body .a-left .a-u-uid { color: #d7e1ef !important; }
html.bym-dark body.bym-on .a-body .a-left .a-u-info dt { color: #6f7d90 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-u-info dd { color: #aab6c6 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info { border-top-color: #222c3a !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li { background: #1e2836 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li:hover { background: #26364a !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li a { color: #aab6c6 !important; }
html.bym-dark body.bym-on .a-body .a-left .a-func-info li:hover a { color: #cfe0ff !important; }
html.bym-dark body.bym-on .a-content { color: #d7dee8 !important; }
html.bym-dark body.bym-on .a-content-wrap .markdown table tr,
html.bym-dark body.bym-on .a-content-wrap .markdown table tr td {
  background: #161d27;
}
html.bym-dark body.bym-on .a-content-wrap .markdown table thead tr,
html.bym-dark body.bym-on .a-content-wrap .markdown table thead tr td {
  background: #1e2836;
}
html.bym-dark body.bym-on .a-content-wrap .markdown table tbody tr:nth-child(2n) td {
  background: #1a2230;
}
html.bym-dark body.bym-on .a-content-wrap .markdown table td,
html.bym-dark body.bym-on .a-content-wrap .markdown table th {
  border-color: #2a3444;
}
html.bym-dark body.bym-on .bym-embed {
  border-color: #222c3a;
  background: #131a23;
}
html.bym-dark body.bym-on .bym-embed-head {
  border-bottom-color: #222c3a;
  background: #1a2230;
}
html.bym-dark body.bym-on .bym-embed-origin { color: #94a3b8 !important; }
html.bym-dark body.bym-on .bym-embed-origin:hover { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .bym-embed-audio .bym-embed-body { background: #1a2230; }
html.bym-dark body.bym-on .bym-meta {
  color: #7d8a9c;
  border-bottom-color: #222c3a;
}
html.bym-dark body.bym-on .bym-meta-toggle:hover {
  background: #1e2836;
  color: #aab6c6;
}
html.bym-dark body.bym-on .a-content-wrap a { color: #79aef8 !important; }
html.bym-dark body.bym-on .a-content-wrap blockquote {
  border-left-color: #2a3444 !important;
  background: #131a23 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .a-content2 .a-background {
  background: #131a23 !important;
  border-color: #2a3444 !important;
}
html.bym-dark body.bym-on .a-content2 .a-background p { color: var(--bym-text-faint) !important; }
html.bym-dark body.bym-on .a-content2 .a-func-dispCai {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .a-bottom td {
  background: #131a23 !important;
  border-top-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-status a { color: var(--bym-text-faint) !important; }
html.bym-dark body.bym-on .a-status a:hover { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .a-back { color: #6f7d90 !important; }

html.bym-dark body.bym-on #nice_view {
  background: linear-gradient(180deg, #1a1710 0%, #17140e 100%) !important;
  border-color: #3a2e1c !important;
}
html.bym-dark body.bym-on .a-nice-comment-divline h3 { color: #e0a458 !important; }
html.bym-dark body.bym-on .a-nice-comment-divline h5 a { color: #c08a4a !important; }
html.bym-dark body.bym-on .a-nice-comment-item + .a-nice-comment-item {
  border-top-color: #33291a !important;
}
html.bym-dark body.bym-on .a-nice-comment-face {
  border: 0 !important;
  background: transparent !important;
}
html.bym-dark body.bym-on .a-nice-comment-face img {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  box-shadow: none;
}
/* 精彩回复的用户名带内联红色，深色背景下单独提亮成浅暖色 */
html.bym-dark body.bym-on .a-nice-comment-id a,
html.bym-dark body.bym-on .a-nice-comment-id strong { color: #f3c88f !important; }
html.bym-dark body.bym-on .a-nice-comment-content { color: #ddd5c8 !important; }
html.bym-dark body.bym-on .a-nice-comment-func a { color: #b9a07c !important; }
html.bym-dark body.bym-on .a-nice-comment-func a:hover { color: #e0a458 !important; }
html.bym-dark body.bym-on .a-nice-comment-floor { color: #7d7264 !important; }

html.bym-dark body.bym-on .a-comment {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 18px 44px -40px rgba(0, 0, 0, .9);
}
html.bym-dark body.bym-on .a-comment-txt textarea {
  background: #0f141c !important;
  border-color: #2a3444 !important;
  color: #d7dee8 !important;
}
html.bym-dark body.bym-on .a-comment-txt textarea:focus {
  background: #131a23 !important;
  border-color: #4d7fc4 !important;
  outline-color: #26364a !important;
}
html.bym-dark body.bym-on .ubb-img-tab li {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .ubb-img-tab li[_cur="1"] {
  background: var(--bym-accent) !important;
  color: #fff !important;
}

html.bym-dark body.bym-on #bot_info { color: #6f7d90 !important; }

/* 站点正文里的深色字体：在黑夜模式下提亮 */
html.bym-dark body.bym-on .a-content-wrap .f007 { color: #c7d2e0 !important; }
html.bym-dark body.bym-on .a-content-wrap .f008 { color: #8b98aa !important; }
html.bym-dark body.bym-on .a-content-wrap .f015 { color: #e6edf6 !important; }
html.bym-dark body.bym-on .a-content-wrap .f012 { color: #7fb0f5 !important; }
html.bym-dark body.bym-on .a-content-wrap .f002 { color: #42d66b !important; }
html.bym-dark body.bym-on .a-content-wrap .f010 { color: #35c759 !important; }
html.bym-dark body.bym-on .a-content-wrap .bym-source,
html.bym-dark body.bym-on .a-content-wrap .bym-source a {
  color: #6f7d90 !important;
}

html.bym-dark #bym-dock button {
  background: rgba(22, 29, 39, .94);
  border-color: #2b3648;
  color: #c7d2e0;
}
html.bym-dark body.bym-on.bym-menu-open #menu {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 24px 70px -20px rgba(0, 0, 0, .9) !important;
}
html.bym-dark body.bym-on.bym-menu-open #menu #xlist,
html.bym-dark body.bym-on.bym-menu-open #menu #u_login {
  background: #131a23 !important;
  border-color: #222c3a !important;
}
html.bym-dark body.bym-on.bym-menu-open #menu a { color: #aab6c6 !important; }
html.bym-dark body.bym-on.bym-menu-open #menu a:hover { color: #7fb0f5 !important; }

html.bym-dark #bym-floatbar {
  background: rgba(22, 29, 39, .95);
  border-color: #263041;
  box-shadow: 0 10px 30px -22px rgba(0, 0, 0, .9);
}
html.bym-dark #bym-floatbar .bym-float-tag {
  background: #1e2836;
  color: var(--bym-text-faint);
}
html.bym-dark #bym-floatbar .bym-float-title-text { color: #e6edf6; }
html.bym-dark #bym-floatbar .bym-float-path-text { color: var(--bym-text-faint); }
html.bym-dark #bym-floatbar a { color: #aab6c6 !important; }
html.bym-dark #bym-floatbar a:hover { color: #7fb0f5 !important; }

html.bym-dark #bym-floor-top {
  background: rgba(22, 29, 39, .95);
  border-color: #263041;
  color: #c7d2e0;
  box-shadow: 0 10px 30px -22px rgba(0, 0, 0, .9);
}
html.bym-dark #bym-floor-top.bym-visible:hover {
  background: #1e2836;
  border-color: #3b5a86;
}

#bym-emoji-toggle { background: #f4f7fc; color: var(--bym-text-mid); border-color: var(--bym-border-strong); }
html.bym-dark body.bym-on #bym-emoji-toggle {
  background: #1e2836;
  border-color: #2a3444;
  color: #c7d2e0;
}
html.bym-dark body.bym-on #bym-emoji-toggle:hover { background: #26364a; }
html.bym-dark body.bym-on .a-comment.bym-emoji-open #em_img {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 18px 44px -22px rgba(0, 0, 0, .9) !important;
}

/* 页内弹窗：深色主题 */
html.bym-dark body.bym-on .ui-dialog {
  background: #161d27 !important;
  border-color: #263041 !important;
  box-shadow: 0 18px 48px -26px rgba(0, 0, 0, .9) !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-titlebar {
  background: #161d27 !important;
  border-bottom-color: #263041 !important;
  color: #e6edf6 !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-title { color: #e6edf6 !important; }
html.bym-dark body.bym-on .ui-dialog .ui-dialog-titlebar-close:hover { background: #26364a !important; }
html.bym-dark body.bym-on .ui-dialog .ui-dialog-titlebar-close::after { color: #aab6c6; }
html.bym-dark body.bym-on .ui-dialog .ui-dialog-content { color: #aab6c6 !important; }
html.bym-dark body.bym-on .ui-dialog .ui-dialog-content a { color: #79aef8 !important; }
html.bym-dark body.bym-on .a-func-collect.bym-collected { color: #79aef8 !important; }
html.bym-dark body.bym-on .ui-dialog .ui-dialog-content { scrollbar-color: #31405a transparent; }
html.bym-dark body.bym-on .ui-dialog .ui-dialog-content::-webkit-scrollbar-thumb {
  background-color: #31405a;
  background-clip: padding-box;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-content::-webkit-scrollbar-thumb:hover {
  background-color: #4a5b78;
  background-clip: padding-box;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-buttonpane {
  background: #161d27 !important;
  border-top-color: #263041 !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-buttonpane button {
  background: #202b3a !important;
  border-color: #31405a !important;
  color: #cfdaea !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-buttonpane button:hover {
  border-color: #4d7fc4 !important;
  color: #dbe9ff !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-buttonpane button.ui-state-hover {
  background: #26364a !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-buttonpane button:first-child:not(:only-child) {
  background: var(--bym-accent) !important;
  border-color: var(--bym-accent) !important;
  color: #fff !important;
}
html.bym-dark body.bym-on .ui-dialog .ui-dialog-buttonpane button:first-child:not(:only-child):hover {
  background: var(--bym-accent-strong) !important;
}
html.bym-dark body.bym-on .ui-widget-overlay {
  background: #000 !important;
  opacity: .55 !important;
}
html.bym-dark body.bym-on .ui-dialog select {
  background: #0f141c !important;
  border-color: #31405a !important;
  color: #d7dee8 !important;
}
html.bym-dark body.bym-on .ui-dialog input[type="text"],
html.bym-dark body.bym-on .ui-dialog input[type="password"],
html.bym-dark body.bym-on .ui-dialog input[type="search"],
html.bym-dark body.bym-on .ui-dialog textarea {
  background: #0f141c !important;
  border-color: #31405a !important;
  color: #d7dee8 !important;
}
html.bym-dark body.bym-on .ui-dialog .button {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .ui-dialog .warning {
  color: #f0b35e !important;
  background: #2a2117 !important;
  border-color: #4a3a22 !important;
}
html.bym-dark body.bym-on .ui-dialog .warning span { color: #f0b35e !important; }
html.bym-dark body.bym-on .ui-dialog .u-search { border-top-color: #263041 !important; }
html.bym-dark body.bym-on .ui-dialog .u-info figure img { border-color: #31405a !important; }
html.bym-dark body.bym-on .ui-dialog .u-query { color: #aab6c6 !important; }
html.bym-dark body.bym-on .ui-dialog .u-name {
  background: transparent !important;
  border-bottom-color: #263041 !important;
  color: #e6edf6 !important;
}
html.bym-dark body.bym-on .ui-dialog .u-name a { color: #79aef8 !important; }
html.bym-dark body.bym-on .ui-dialog .u-info {
  background: #131a23 !important;
  border-color: #263041 !important;
}
html.bym-dark body.bym-on .ui-dialog .u-info header {
  background: #1b2431 !important;
  color: #cfdaea !important;
}
html.bym-dark body.bym-on .ui-dialog .u-info dt { color: #6f7d90 !important; }
html.bym-dark body.bym-on .ui-dialog .u-info dd { color: #d7dee8 !important; }
/* 资料卡的网格样式比上面的规则更具体，深色背景需要同步覆盖 */
html.bym-dark body.bym-on .ui-dialog.bym-dialog-profile .u-info {
  background: #131a23 !important;
  border-color: #263041 !important;
}
html.bym-dark body.bym-on .ui-dialog.bym-dialog-profile .u-info > header {
  background: #1b2431 !important;
  color: #cfdaea !important;
}
html.bym-dark body.bym-on .ui-dialog .u-search { color: #7d8a9c !important; }
`;

  const CSS_LIGHTBOX = String.raw`
/* ---------- 图片灯箱：页内浮动预览，多图可翻页 ---------- */
#bym-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2147483100;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 64px 76px 88px;
  background: rgba(8, 12, 18, .93);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  box-sizing: border-box;
  opacity: 0;
  transition: opacity .2s ease;
}
#bym-lightbox.bym-lightbox-open { display: flex; opacity: 1; }
#bym-lightbox.bym-lb-leaving {
  display: flex;
  opacity: 0;
  pointer-events: none;
}
#bym-lightbox .bym-lb-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: inherit;
  box-sizing: border-box;
  overflow: hidden;
}
#bym-lightbox img {
  position: relative;
  z-index: 1;
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: calc(100vh - 152px);
  border-radius: 8px;
  background: #fff;
  object-fit: contain;
  box-shadow: 0 30px 90px -24px rgba(0, 0, 0, .9), 0 0 0 1px rgba(255, 255, 255, .06);
  opacity: 1;
  transition: transform .3s cubic-bezier(.22, .72, .28, 1), opacity .22s ease;
  will-change: transform, opacity;
  user-select: none;
  -webkit-user-drag: none;
  cursor: zoom-in;
  touch-action: none;
}
#bym-lightbox.bym-lb-zoomed img { cursor: zoom-out; }
#bym-lightbox img.bym-lb-dragging { transition: none !important; }
#bym-lightbox img.bym-lb-loading { opacity: 0 !important; transition: none; }
#bym-lightbox img.bym-lb-from-thumb {
  transition: none;
  opacity: .35;
  transform: translate(var(--bym-lb-dx, 0), var(--bym-lb-dy, 0)) scale(var(--bym-lb-sx, 1), var(--bym-lb-sy, 1));
}
#bym-lightbox img.bym-lb-pop {
  transition: none;
  opacity: .35;
  transform: scale(.94);
}
#bym-lightbox img.bym-lb-to-thumb {
  opacity: .2;
  transform: translate(var(--bym-lb-dx, 0), var(--bym-lb-dy, 0)) scale(var(--bym-lb-sx, 1), var(--bym-lb-sy, 1));
}
#bym-lightbox .bym-lb-btn {
  position: absolute;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 50%;
  background: rgba(255, 255, 255, .1);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: #fff;
  cursor: pointer;
  transition: background .15s ease, transform .15s ease;
}
#bym-lightbox .bym-lb-btn:hover { background: rgba(255, 255, 255, .22); }
#bym-lightbox .bym-lb-btn:active { transform: scale(.94); }
#bym-lightbox .bym-lb-btn svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
#bym-lightbox .bym-lb-prev { left: 18px; top: 50%; transform: translateY(-50%); }
#bym-lightbox .bym-lb-prev:active { transform: translateY(-50%) scale(.94); }
#bym-lightbox .bym-lb-next { right: 18px; top: 50%; transform: translateY(-50%); }
#bym-lightbox .bym-lb-next:active { transform: translateY(-50%) scale(.94); }
#bym-lightbox .bym-lb-top {
  position: absolute;
  z-index: 3;
  top: 14px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}
#bym-lightbox .bym-lb-count {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .12);
  color: rgba(255, 255, 255, .9);
  font: 12px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-variant-numeric: tabular-nums;
}
#bym-lightbox .bym-lb-close {
  position: static;
  width: 42px;
  height: 42px;
  pointer-events: auto;
}
#bym-lightbox .bym-lb-caption {
  position: absolute;
  z-index: 3;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  max-width: min(720px, calc(100vw - 150px));
  padding: 6px 15px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .48);
  color: rgba(255, 255, 255, .9);
  font: 12.5px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
#bym-lightbox .bym-lb-caption[hidden] { display: none; }
#bym-lightbox.bym-lb-single .bym-lb-prev,
#bym-lightbox.bym-lb-single .bym-lb-next,
#bym-lightbox.bym-lb-single .bym-lb-count { display: none; }
/* 单图没有计数，关闭按钮仍靠右 */
#bym-lightbox.bym-lb-single .bym-lb-top { justify-content: flex-end; }
html.bym-lightbox-lock { overflow: hidden !important; }
@media (max-width: 560px) {
  #bym-lightbox { padding: 60px 12px 82px; }
  #bym-lightbox .bym-lb-prev { left: 8px; }
  #bym-lightbox .bym-lb-next { right: 8px; }
  #bym-lightbox .bym-lb-caption { max-width: calc(100vw - 40px); }
}
`;

/* 按页面结构拆分，便于定位；顺序与层叠优先级相关，不要随意调整。 */
  const CSS = [
    CSS_BASE,
    CSS_TOOLBARS,
    CSS_HEAD,
    CSS_FLOORS,
    CSS_NICE,
    CSS_COMPOSER,
    CSS_FOOTER,
    CSS_RESPONSIVE,
    CSS_DOCK,
    CSS_FLOATBAR,
    CSS_DIALOG,
    CSS_LIGHTBOX,
    CSS_DARK,
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('bym-style')) return;
    const el = document.createElement('style');
    el.id = 'bym-style';
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ------------------------------------------------------------------ *
   * 3. 左下角控制条：简约版 / 主题 / 版面菜单
   * ------------------------------------------------------------------ */
  let dock = null;
  let toggleBtn = null;
  let themeBtn = null;
  let menuBtn = null;
  let overlay = null;

  function syncToggle() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('bym-off', !state.enabled);
    const label = toggleBtn.querySelector('.bym-label');
    const text = state.enabled ? '简约版' : '经典版';
    if (label && label.textContent !== text) label.textContent = text;
    toggleBtn.title = '切换简约阅读布局（Alt+M）';
  }

  function syncTheme() {
    if (!themeBtn) return;
    const dark = effectiveDark();
    const icon = dark ? '☀️' : '🌙';
    if (themeBtn.textContent !== icon) themeBtn.textContent = icon;
    themeBtn.classList.toggle('bym-auto', state.theme === 'auto');
    themeBtn.title =
      (state.theme === 'auto' ? '当前跟随系统；' : '') +
      (dark ? '深色模式，点击切换为浅色' : '浅色模式，点击切换为深色') +
      '（Shift+点击恢复跟随系统）';
  }

  function applyTheme() {
    // 跟随 body.bym-on：内容还没换过来时不要给旧页面套深色
    const dark = !!(isModern() && state.enabled && effectiveDark());
    document.documentElement.classList.toggle('bym-dark', dark);
    syncTheme();
  }

  function toggleTheme(e) {
    if (e && e.shiftKey) {
      state.theme = 'auto';
    } else {
      state.theme = effectiveDark() ? 'light' : 'dark';
    }
    saveTheme(state.theme);
    applyTheme();
  }

  function toggle() {
    state.enabled = !state.enabled;
    saveEnabled(state.enabled);
    applyRoute();
    syncToggle();
    if (state.enabled) {
      decorateFloors();
      scheduleDecorate();
    } else {
      restoreArticle();
      restoreComposer();
    }
  }

  function syncMenu() {
    if (!menuBtn || !document.body) return;
    menuBtn.setAttribute('aria-expanded', String(document.body.classList.contains('bym-menu-open')));
  }

  function toggleMenu() {
    if (!document.body) return;
    document.body.classList.toggle('bym-menu-open');
    syncMenu();
  }

  function closeMenu() {
    if (!document.body) return;
    document.body.classList.remove('bym-menu-open');
    syncMenu();
  }

  function mountDock() {
    if (dock || !document.body) return;

    dock = document.createElement('div');
    dock.id = 'bym-dock';

    menuBtn = document.createElement('button');
    menuBtn.id = 'bym-menu';
    menuBtn.type = 'button';
    menuBtn.title = '版面菜单（导航 / 登录 / 信箱）';
    menuBtn.setAttribute('aria-label', '版面菜单');
    menuBtn.textContent = '☰';
    menuBtn.addEventListener('click', toggleMenu);

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'bym-toggle';
    toggleBtn.type = 'button';
    toggleBtn.innerHTML = '<span class="bym-dot"></span><span class="bym-label">简约版</span>';
    toggleBtn.addEventListener('click', toggle);

    themeBtn = document.createElement('button');
    themeBtn.id = 'bym-theme';
    themeBtn.type = 'button';
    themeBtn.setAttribute('aria-label', '切换深色 / 浅色模式');
    themeBtn.textContent = '🌙';
    // 普通点击：在深/浅之间切换；Shift+点击：恢复跟随系统
    themeBtn.addEventListener('click', toggleTheme);

    dock.append(menuBtn, toggleBtn, themeBtn);

    overlay = document.createElement('div');
    overlay.id = 'bym-overlay';
    overlay.addEventListener('click', closeMenu);

    document.body.append(dock, overlay);
    syncToggle();
    syncTheme();
    syncMenu();
  }

  function onKeydown(e) {
    // 灯箱打开时优先处理翻页 / 关闭
    if (isLightboxOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        stepLightbox(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        stepLightbox(1);
        return;
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === TOGGLE_KEY) {
      if (isArticlePage()) {
        e.preventDefault();
        toggle();
      }
    }
    if (e.key === 'Escape') closeMenu();
  }

  /* ------------------------------------------------------------------ *
   * 4. 轻量 DOM 增强：徽标、meta 区块、用户操作
   * ------------------------------------------------------------------ */
  let decorateTimer = null;
  const movedActions = new Map(); // .a-func-info -> 原父节点
  const movedBadges = new Map();  // .a-pos -> 原父节点
  const metaTrimmed = new Map();  // .bym-meta -> 为压缩间距移除的节点
  const sourceFolded = new Map(); // .bym-source -> 原位置占位注释
  const strippedTitles = new Map(); // .b-head .n-left -> { node, original }
  const mediaEmbeds = new Map(); // .bym-embed -> { anchor, parent, next }

  // 把正文开头的「发信人 / 标 题 / 发信站」三行收进一个弱化的 meta 区块
  // 把 meta 的前两行包进 .bym-meta-extra，第三行（发信站）留在 .bym-meta-main，
  // 这样默认只显示发信站，展开时再显示完整三行。
  function splitMetaLines(meta) {
    if (meta.querySelector(':scope > .bym-meta-main')) return;
    const extra = document.createElement('span');
    extra.className = 'bym-meta-extra';
    const main = document.createElement('span');
    main.className = 'bym-meta-main';
    let brs = 0;
    for (const node of Array.from(meta.childNodes)) {
      if (brs < 2) {
        extra.appendChild(node);
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') brs += 1;
      } else {
        main.appendChild(node);
      }
    }
    if (!main.childNodes.length) {
      // 结构异常（不足三行）：保持原样，不折叠
      meta.append(...Array.from(extra.childNodes));
      return;
    }
    meta.append(extra, main);
  }

  function ensureMetaToggle(meta) {
    if (meta.querySelector(':scope > .bym-meta-main .bym-meta-toggle')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bym-meta-toggle';
    btn.textContent = '›';
    btn.title = '展开发信人 / 标题';
    btn.setAttribute('aria-label', '展开发信人 / 标题');
    btn.setAttribute('aria-expanded', String(meta.classList.contains('bym-meta-open')));
    btn.addEventListener('click', (event) => {
      // 避免点击冒泡到站点的事件代理，触发额外的重绘 / 跳转
      event.stopPropagation();
      const open = meta.classList.toggle('bym-meta-open');
      btn.setAttribute('aria-expanded', String(open));
      btn.title = open ? '收起发信人 / 标题' : '展开发信人 / 标题';
    });
    const main = meta.querySelector(':scope > .bym-meta-main');
    if (!main) {
      meta.appendChild(btn);
      return;
    }
    const last = main.lastChild;
    if (last && last.nodeType === Node.ELEMENT_NODE && last.tagName === 'BR') {
      main.insertBefore(btn, last);
    } else {
      main.appendChild(btn);
    }
  }

  function decorateMeta(wrap) {
    const content = wrap.querySelector('.a-content-wrap');
    if (!content) return;

    // 三行后面通常还跟着一个空 <br>，会撑出多余的行距，一并去掉。
    // 记下被拿掉的节点，切回经典版时按原顺序放回去。
    function trimAfterMeta(meta) {
      const removed = metaTrimmed.get(meta) || [];
      let next = meta.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && !next.nodeValue.trim()) {
        const after = next.nextSibling;
        removed.push(next);
        next.remove();
        next = after;
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'BR') {
        removed.push(next);
        next.remove();
      }
      // 即使没有移除节点也要登记，切回经典版时才能拆掉包装和折叠按钮
      metaTrimmed.set(meta, removed);
    }

    const existing = content.querySelector(':scope > .bym-meta');
    if (existing) {
      trimAfterMeta(existing);
      splitMetaLines(existing);
      ensureMetaToggle(existing);
      return;
    }

    // 有些版面会在正文最前面插入锚点或空白节点，向后多找几个节点
    const contentNodes = Array.from(content.childNodes);
    const start = contentNodes
      .slice(0, 6)
      .find(
        (node) => node.nodeType === Node.TEXT_NODE && /^\s*发信人[:：]/.test(node.nodeValue)
      );
    if (!start) return;

    const nodes = [];
    let brs = 0;
    for (const node of contentNodes.slice(contentNodes.indexOf(start))) {
      nodes.push(node);
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
        brs += 1;
        if (brs >= 3) break;
      }
    }
    if (brs < 3) return;

    try {
      const range = document.createRange();
      range.setStartBefore(nodes[0]);
      range.setEndAfter(nodes[nodes.length - 1]);
      const meta = document.createElement('div');
      meta.className = 'bym-meta';
      range.surroundContents(meta);
      trimAfterMeta(meta);
      splitMetaLines(meta);
      ensureMetaToggle(meta);
    } catch (e) {
      /* 结构异常时放弃，不影响正文 */
    }
  }

  // 「※ 修改 / ※ 来源」等落款行弱化显示（不改变链接和内容）
  function decorateSource(wrap) {
    wrap.querySelectorAll('.a-content-wrap font').forEach((font) => {
      if (font.classList.contains('bym-source')) return;
      const text = (font.textContent || '').trim();
      if (/^※\s*(?:修改|来源)/.test(text) || /^来源[:：]/.test(text)) {
        font.classList.add('bym-source');
      }
    });
  }

  // 把「※ 来源 / ※ 修改」移进发信信息折叠区，排在发信站之后。
  // 原位置留下注释占位，切回经典版时按原样放回。
  function foldSourceLines(wrap) {
    const meta = wrap.querySelector('.a-content-wrap > .bym-meta');
    const main = meta && meta.querySelector(':scope > .bym-meta-main');
    if (!main || main.querySelector('.bym-meta-source')) return;
    const sources = Array.from(wrap.querySelectorAll('.a-content-wrap .bym-source')).filter(
      (font) => !font.closest('.bym-meta')
    );
    if (!sources.length) return;
    const box = document.createElement('span');
    box.className = 'bym-meta-source';
    sources.forEach((font, index) => {
      if (index) box.appendChild(document.createElement('br'));
      const marker = document.createComment('bym-source');
      if (font.parentNode) font.parentNode.insertBefore(marker, font);
      sourceFolded.set(font, marker);
      box.appendChild(font);
    });
    main.appendChild(box);
  }

  // 表情图的 alt 有 ema2、em8、em12 等多种写法
  const EMOJI_ALT_RE = /^em[a-z]?\d*$/i;

  function markEmojiImages(root) {
    root.querySelectorAll('img[alt]').forEach((img) => {
      if (EMOJI_ALT_RE.test((img.getAttribute('alt') || '').trim())) {
        img.classList.add('bym-emoji-img');
      }
    });
  }

  function isBlankTailNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return !(node.nodeValue || '').trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.tagName === 'BR') return true;
    if (node.matches('img, video, iframe, audio, object, embed, hr, table')) return false;
    if (node.tagName === 'FONT' || node.tagName === 'SPAN') {
      if ((node.textContent || '').trim()) return false;
      return !node.querySelector('img, video, iframe, audio, object, embed, hr');
    }
    return false;
  }

  // 站点在正文末尾固定写了几组 <br>，落款移进元信息后它们就变成空行。
  // 只隐藏不删除，切回经典版时去掉标记即可原样恢复。
  function hideBlankRun(node) {
    let hidden = 0;
    while (node) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node = node.previousSibling;
        continue;
      }
      if (!isBlankTailNode(node)) break;
      if (node.nodeType === Node.ELEMENT_NODE) {
        node.classList.add('bym-tail-blank');
        hidden += 1;
      }
      node = node.previousSibling;
    }
    return hidden;
  }

  function trimTrailingBlank(wrap) {
    const box = wrap.querySelector('.a-content-wrap');
    if (!box || wrap.dataset.bymTailTrimmed === '1') return;
    // 精彩回复区块在楼主卡片正文里，它的前面也会留下落款移走后的空行
    const nice = box.querySelector(':scope > #nice_view');
    let hidden = hideBlankRun(box.lastChild);
    if (nice) hidden += hideBlankRun(nice.previousSibling);
    if (!hidden) return;
    wrap.dataset.bymTailTrimmed = '1';
  }

  // 媒体外链白名单：只接管能稳定嵌入的平台；短链和需要登录的页面保持原样。
  function parseMediaLink(raw) {
    let url;
    try {
      url = new URL(raw, location.href);
    } catch (e) {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname;
    const hash = url.hash || '';

    if (host === 'bilibili.com' || host === 'm.bilibili.com') {
      const m = path.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i);
      if (!m) return null;
      const id = m[1];
      const key = /^bv/i.test(id) ? 'bvid=' + id : 'aid=' + id.slice(2);
      const page = url.searchParams.get('p') || '1';
      return {
        platform: '哔哩哔哩',
        src:
          'https://player.bilibili.com/player.html?' + key +
          '&page=' + encodeURIComponent(page) + '&autoplay=0&high_quality=1',
      };
    }

    if (host === 'douyin.com' || host === 'iesdouyin.com') {
      const m = path.match(/\/(?:share\/)?video\/(\d+)/);
      if (!m) return null;
      return {
        platform: '抖音',
        src: 'https://open.douyin.com/player/video?vid=' + m[1] + '&autoplay=0',
      };
    }

    if (
      host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      let id = '';
      if (host === 'youtu.be') {
        id = (path.split('/')[1] || '').trim();
      } else if (path === '/watch') {
        id = url.searchParams.get('v') || '';
      } else {
        const m = path.match(/^\/(?:embed|shorts|live)\/([0-9A-Za-z_-]+)/);
        if (m) id = m[1];
      }
      if (!/^[0-9A-Za-z_-]{6,}$/.test(id)) return null;
      return { platform: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0' };
    }

    if (host === 'v.qq.com') {
      const m = path.match(/\/([0-9A-Za-z]{6,})\.html$/);
      if (!m) return null;
      return { platform: '腾讯视频', src: 'https://v.qq.com/txp/iframe/player.html?vid=' + m[1] };
    }

    if (host === 'v.youku.com') {
      const m = path.match(/\/v_show\/id_([0-9A-Za-z=]+)\.html/);
      if (!m) return null;
      return { platform: '优酷', src: 'https://player.youku.com/embed/' + m[1] };
    }

    if (host === 'acfun.cn' || host === 'm.acfun.cn') {
      const m = path.match(/\/v\/(ac\d+)/i);
      if (!m) return null;
      return { platform: 'AcFun', src: 'https://www.acfun.cn/player/' + m[1] };
    }

    if (host === 'music.163.com') {
      let kind = '';
      let id = '';
      if ((path === '/song' || path === '/album' || path === '/playlist') && url.searchParams.get('id')) {
        kind = path.slice(1);
        id = url.searchParams.get('id');
      } else {
        const hm = hash.match(/^#!?\/?(song|album|playlist)\?id=(\d+)/);
        const pm = path.match(/\/(song|album|playlist)\/(\d+)/);
        if (hm) {
          kind = hm[1];
          id = hm[2];
        } else if (pm) {
          kind = pm[1];
          id = pm[2];
        }
      }
      if (!/^\d+$/.test(id)) return null;
      const type = kind === 'album' ? 1 : kind === 'playlist' ? 3 : 2;
      return {
        platform: '网易云音乐',
        audio: true,
        src:
          'https://music.163.com/outchain/player?type=' + type +
          '&id=' + id + '&auto=0&height=66',
      };
    }

    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = path.match(/\/(?:video\/)?(\d+)/);
      if (!m) return null;
      return { platform: 'Vimeo', src: 'https://player.vimeo.com/video/' + m[1] };
    }

    return null;
  }

  // 媒体链接先显示成一张轻量卡片，点击后才真正创建 iframe，
  // 避免一个帖子里多个播放器同时加载脚本和封面。
  function decorateMediaLinks(wrap) {
    wrap.querySelectorAll('.a-content-wrap a[href]').forEach((a) => {
      if (a.closest('.bym-meta, .bym-embed')) return;
      const info = parseMediaLink(a.getAttribute('href'));
      if (!info) return;
      const parent = a.parentNode;
      if (!parent) return;

      const box = document.createElement('div');
      box.className = 'bym-embed' + (info.audio ? ' bym-embed-audio' : '');
      box.dataset.src = info.src;

      const head = document.createElement('div');
      head.className = 'bym-embed-head';
      const badge = document.createElement('span');
      badge.className = 'bym-embed-badge';
      badge.textContent = info.platform;
      head.appendChild(badge);
      a.classList.add('bym-embed-origin');

      const body = document.createElement('button');
      body.type = 'button';
      body.className = 'bym-embed-body';
      const play = document.createElement('span');
      play.className = 'bym-embed-play';
      play.textContent = '▶';
      const tip = document.createElement('span');
      tip.className = 'bym-embed-tip';
      tip.textContent = '点击加载' + info.platform + '播放器';
      body.append(play, tip);

      box.append(head, body);
      parent.insertBefore(box, a);
      head.appendChild(a);
      mediaEmbeds.set(box, a);
    });
  }

  function loadEmbed(box) {
    if (!box || box.classList.contains('bym-embed-loaded')) return;
    const src = box.dataset.src;
    const body = box.querySelector('.bym-embed-body');
    if (!src || !body) return;
    const frame = document.createElement('iframe');
    frame.src = src;
    frame.loading = 'lazy';
    frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
    frame.allowFullscreen = true;
    frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    frame.title = '嵌入式播放器';
    box.classList.add('bym-embed-loaded');
    body.textContent = '';
    body.appendChild(frame);
  }

  function onEmbedClick(event) {
    if (!state.enabled || !isModern()) return;
    const btn = event.target.closest && event.target.closest('.bym-embed-body');
    if (!btn) return;
    const box = btn.closest('.bym-embed');
    if (!box) return;
    loadEmbed(box);
  }

  // 标题条默认写成「文章主题: xxx」，简约版直接显示标题本身
  function stripTitlePrefix() {
    const el = document.querySelector('#body .b-head .n-left');
    if (!el || strippedTitles.has(el)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const m = /^(\s*文章主题\s*[:：]\s*)/.exec(node.nodeValue || '');
      if (!m) continue;
      strippedTitles.set(el, { node, original: node.nodeValue });
      node.nodeValue = node.nodeValue.slice(m[1].length);
      break;
    }
  }

  // 宽屏非匿名楼层把发信 / 加好友并到赞踩行；窄屏放回用户框（旧行为）。
  // 用 matchMedia 而不是只量一次宽度：浏览器缩放也会让媒体查询跟着变化。
  const narrowActionsQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 899.98px)') : null;

  function placeUserActions(wrap, info, left) {
    const statusCell = wrap.querySelector('.a-bottom > td:last-child');
    const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
    const hasAction = !!info.querySelector('.bym-action-mess, .bym-action-friend');
    const toBottom =
      !!statusCell && !!bottomLeft && hasAction && !wrap.classList.contains('bym-anon') &&
      !(narrowActionsQuery && narrowActionsQuery.matches);
    if (toBottom) {
      // 宽屏：放在头像列正下方的底部左单元格里，位置在赞踩左侧
      if (info.parentNode !== bottomLeft) bottomLeft.appendChild(info);
      wrap.classList.add('bym-actions-bottom');
      return;
    }
    if (left && info.parentNode !== left) left.appendChild(info);
    wrap.classList.remove('bym-actions-bottom');
  }

  // 查看 / 发信 / 加好友：从楼层底部移出（默认进左侧用户信息栏）
  function decorateUserActions(wrap) {
    const left = wrap.querySelector('.a-body > .a-left');
    // 可能在原来的底部左单元格、左栏，或（宽屏）已并到赞踩行
    const info = wrap.querySelector('.a-func-info');
    if (!left || !info) return;
    if (!movedActions.has(info)) {
      // 记下站点原来的位置（底部左单元格），切回经典版时放回去
      const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
      movedActions.set(info, bottomLeft || info.parentNode);
    }
    wrap.classList.add('bym-actions-moved');

    // 标记「查看 / 发信 / 加好友」：查看按钮隐藏，改由头像点击触发；
    // 加好友稍微加宽
    info.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector('a');
      if (!a) return;
      const text = (a.textContent || '').replace(/\s+/g, '');
      const href = a.getAttribute('href') || '';
      if (text === '查看' || href.includes('/user/query/')) li.classList.add('bym-action-view');
      if (text.includes('发信')) li.classList.add('bym-action-mess');
      if (text.includes('加好友')) li.classList.add('bym-action-friend');
    });

    placeUserActions(wrap, info, left);

    // 头像本身包一层真实链接（和精彩回复头像一样），
    // 这样用户点的是普通 <a>，站点自己的 click_a 会打开用户资料对话框。
    // 不要用合成 click 去点隐藏的「查看」链接：线上它可能不经过站点的事件代理，
    // 结果变成整页跳转。
    const userLink = wrap.querySelector(
      '.a-func-info a[href*="/user/query/"], .a-head .a-u-name a[href*="/user/query/"]'
    );
    const face = wrap.querySelector('.a-body .a-u-img');
    if (userLink && face) {
      let anchor = face.querySelector(':scope > a.bym-avatar-link');
      if (!anchor) {
        anchor = document.createElement('a');
        anchor.className = 'bym-avatar-link';
        anchor.title = '查看用户资料';
        while (face.firstChild) anchor.appendChild(face.firstChild);
        face.appendChild(anchor);
      }
      if (anchor.getAttribute('href') !== userLink.href) anchor.href = userLink.href;
    }
  }

  // IWhisper 的匿名 ID 带 #（如 IWhisper#175）。站点生成的
  // ?au=IWhisper#175 会把 # 当成 URL fragment，导致「只看此ID」失效；
  // 把查询值里的 # 编码成 %23 即可。
  function fixOnlyIdLinks(root) {
    if (!root) return;
    root.querySelectorAll('a[href*="au="]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      const fixed = href.replace(/([?&]au=)([^&]*)/, (m, prefix, value) =>
        prefix + value.replace(/#/g, '%23')
      );
      if (fixed !== href) a.setAttribute('href', fixed);
    });
  }

  // 按「第 N 楼」里的帖子 ID 找对应楼层。
  // 不能直接在整棵文档里 querySelector：精彩回复区块本身也在楼主卡片内，
  // 回复链接又排在真正的楼层之前，closest('.a-wrap') 会落到楼主卡片上，
  // 结果「只看此ID」筛成了楼主。这里只在楼层表头的操作区里找。
  function findFloorByPostId(postId) {
    const wraps = document.querySelectorAll('#body .a-wrap');
    for (const wrap of wraps) {
      const links = wrap.querySelectorAll('.a-head a[href*="/post/"]');
      for (const a of links) {
        const m = (a.getAttribute('href') || '').match(/\/post\/(\d+)/);
        if (m && m[1] === postId) return wrap;
      }
    }
    return null;
  }

  // 精彩回复：补一个和楼层一致的「只看此ID」；匿名帖补上作者 ID
  function decorateNiceReplies() {
    const board = getBoard();
    const id = getArticleId();
    if (!board || !id) return;
    document.querySelectorAll('#body .a-nice-comment-item').forEach((item) => {
      const func = item.querySelector('.a-nice-comment-func');
      if (!func) return;
      const idLink = item.querySelector('.a-nice-comment-id a');
      let author = idLink ? (idLink.textContent || '').trim() : '';
      // 匿名帖的精彩回复不显示作者 ID，用「第 N 楼」链接反查对应楼层的作者
      if (!author) {
        const floorLink = item.querySelector('.a-nice-comment-floor');
        const m = floorLink && (floorLink.getAttribute('href') || '').match(/[?&]s=(\d+)/);
        if (m) {
          const floor = findFloorByPostId(m[1]);
          const name = floor && floor.querySelector('.a-head .a-u-name');
          author = name ? (name.textContent || '').trim() : '';
        }
        // 站点给匿名 IDs 留的是空链接，把作者 ID 补出来并指向同一个筛选视图
        if (author && idLink && !(idLink.textContent || '').trim()) {
          idLink.textContent = author;
          idLink.href = `/article/${board}/${id}?au=${encodeURIComponent(author)}`;
          idLink.title = '只看此ID';
          idLink.classList.add('bym-nice-id');
        }
      }
      if (!author) return;
      // encodeURIComponent 会同时处理 IWhisper#175 里的 #
      const href = `/article/${board}/${id}?au=${encodeURIComponent(author)}`;
      const existing = func.querySelector('.bym-nice-only a');
      if (existing) {
        // 旧版本写入过错误链接时顺手纠正
        if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
        return;
      }
      const li = document.createElement('li');
      li.className = 'bym-nice-only';
      const icon = document.createElement('samp');
      icon.className = 'ico-pos-user';
      const a = document.createElement('a');
      a.href = href;
      a.textContent = '只看此ID';
      li.append(icon, a);
      func.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. 赞 / 踩、页内弹窗与收藏
   *
   * 站点的赞踩有三处问题：
   *   1. 每次点击都先弹一个确认框（匿名帖确认后还会弹「未知的论坛ID」）；
   *   2. 匿名帖里站点客户端可能在发请求前就中断，表现为第一次点击没反应；
   *   3. 同一楼层的赞 / 踩链接在顶部操作区、底部状态区和精彩回复里各有一份，
   *      站点只更新其中一份，其余副本要刷新后才变，第二次点击又因为读到旧状态而逻辑混乱。
   *
   * 因此赞 / 踩改由脚本在捕获阶段接管：直接请求接口，自己更新所有副本，
   * 不再弹确认框；「未知的论坛ID」和重复赞踩提示也不会出现。
   * ------------------------------------------------------------------ */
  const VOTE_NOISE_RE = /未知的论坛\s*ID/;

  // 赞 / 踩完全由脚本接管：直接请求接口，不再弹确认框。
  // 这样既避开了站点在匿名帖里「未知的论坛ID」的客户端分支，
  // 也避开了站点只更新第一份链接、其余副本要刷新才变的问题。
  const voteBusy = new Set();
  const myOpVotes = new Set();

  function voteInfoOf(a) {
    const href = a && a.getAttribute ? a.getAttribute('href') || '' : '';
    const m = /ajax_(voteup|votedown|support|oppose)\/(\d+)\.json/.exec(href);
    return m ? { endpoint: m[1], id: m[2] } : null;
  }

  // 同一楼层的赞 / 踩链接在操作区和状态区各有一份，id 还不完全一样，
  // 所以按「接口 + 文章 ID」从 href 里找齐所有副本。
  function votePeers(endpoint, id) {
    return Array.from(
      document.querySelectorAll('#body a[href*="ajax_' + endpoint + '/' + id + '.json"]')
    ).filter((a) => {
      const info = voteInfoOf(a);
      return !!info && info.endpoint === endpoint && info.id === id;
    });
  }

  function floorVoteActive(endpoint, peers) {
    const cls = endpoint === 'voteup' ? 'ico-pos-zanactive' : 'ico-pos-caiactive';
    return peers.some((a) => !!a.querySelector('samp.' + cls));
  }

  // 楼层正文和底部状态栏里的两份是服务端同时渲染的，计数可信；
  // 「精彩回复」里的副本可能是更早的快照，用它做加减会把楼层计数带偏。
  function voteMainPeers(endpoint, id) {
    const peers = votePeers(endpoint, id);
    const main = peers.filter((a) => !a.closest('.a-nice-comment-func') && !a.closest('.a-nice-comment'));
    return main.length ? main : peers;
  }

  function voteCountFor(endpoint, id) {
    const peers = voteMainPeers(endpoint, id);
    for (const a of peers) {
      const count = voteCountOf(a);
      if (count != null) return count;
    }
    return null;
  }

  function voteCountOf(a) {
    if (!a) return null;
    const m = /\((\d+)\)\s*$/.exec((a.textContent || '').replace(/\s+/g, ' ').trim());
    return m ? Number(m[1]) : null;
  }

  // 只替换文字，保留原有的图标节点（图标里有 id / 内联样式）
  function writeVoteLabel(a, label) {
    const samp = a.querySelector('samp');
    Array.from(a.childNodes).forEach((node) => {
      if (node !== samp) a.removeChild(node);
    });
    if (samp) a.appendChild(document.createTextNode(label));
    else a.textContent = label;
  }

  function paintFloorVote(endpoint, id, active, count) {
    const label = endpoint === 'voteup' ? '赞' : '踩';
    const onCls = endpoint === 'voteup' ? 'ico-pos-zanactive' : 'ico-pos-caiactive';
    const offCls = endpoint === 'voteup' ? 'ico-pos-zaninactive' : 'ico-pos-caiinactive';
    const all = ['ico-pos-zanactive', 'ico-pos-zaninactive', 'ico-pos-caiactive', 'ico-pos-caiinactive'];
    votePeers(endpoint, id).forEach((a) => {
      let samp = a.querySelector('samp');
      if (!samp) {
        samp = document.createElement('samp');
        a.insertBefore(samp, a.firstChild);
      }
      all.forEach((cls) => samp.classList.remove(cls));
      samp.classList.add(active ? onCls : offCls);
      writeVoteLabel(a, label + '(' + count + ')');
    });
  }

  // 楼层赞踩完全以图标状态为准：点已激活的那一边直接忽略；
  // 点另一边时把它点亮并 +1，另一边的计数 -1 并熄灭。
  // 先改界面再发请求（乐观更新），请求失败时用 snapshot 回滚。
  function snapshotFloorVote(id) {
    return {
      likeCount: voteCountFor('voteup', id),
      caiCount: voteCountFor('votedown', id),
      likeActive: floorVoteActive('voteup', voteMainPeers('voteup', id)),
      caiActive: floorVoteActive('votedown', voteMainPeers('votedown', id)),
    };
  }

  function restoreFloorVote(id, snap) {
    if (!snap) return;
    paintFloorVote('voteup', id, snap.likeActive, snap.likeCount == null ? 0 : snap.likeCount);
    paintFloorVote('votedown', id, snap.caiActive, snap.caiCount == null ? 0 : snap.caiCount);
  }

  // 立即应用一次点击，返回点击前的快照供失败回滚
  function applyFloorVote(endpoint, id) {
    const snap = snapshotFloorVote(id);
    let likeCount = snap.likeCount == null ? 0 : snap.likeCount;
    let caiCount = snap.caiCount == null ? 0 : snap.caiCount;

    if (endpoint === 'voteup') {
      likeCount += 1;
      if (snap.caiActive) caiCount = Math.max(0, caiCount - 1);
      paintFloorVote('voteup', id, true, likeCount);
      paintFloorVote('votedown', id, false, caiCount);
    } else {
      caiCount += 1;
      if (snap.likeActive) likeCount = Math.max(0, likeCount - 1);
      paintFloorVote('votedown', id, true, caiCount);
      paintFloorVote('voteup', id, false, likeCount);
    }
    return snap;
  }

  // 服务端说「已经投过」：去掉刚才预支的 +1，只把图标同步成已投。
  // 快照里另一边是激活的，说明本地状态过期，服务端已用这一票顶掉了它。
  function settleDuplicateFloorVote(endpoint, id, snap) {
    if (!snap) return;
    let likeCount = snap.likeCount == null ? 0 : snap.likeCount;
    let caiCount = snap.caiCount == null ? 0 : snap.caiCount;
    if (endpoint === 'voteup') {
      if (snap.caiActive) caiCount = Math.max(0, caiCount - 1);
      paintFloorVote('voteup', id, true, likeCount);
      paintFloorVote('votedown', id, false, caiCount);
    } else {
      if (snap.likeActive) likeCount = Math.max(0, likeCount - 1);
      paintFloorVote('votedown', id, true, caiCount);
      paintFloorVote('voteup', id, false, likeCount);
    }
  }

  function opCountOf(a) {
    const m = /\(\+?(\d+)\)/.exec(a.textContent || '');
    return m ? Number(m[1]) : null;
  }

  function opCountFor(endpoint, id) {
    for (const a of votePeers(endpoint, id)) {
      const count = opCountOf(a);
      if (count != null) return count;
    }
    return null;
  }

  // 楼主赞踩的锚点在服务端渲染时图标一直是「active」色，不能靠图标判断已投，
  // 用脚本自己加的 bym-voted 作为状态。
  function opVoteActive(endpoint, id) {
    return votePeers(endpoint, id).some((a) => a.classList.contains('bym-voted'));
  }

  function paintOpVote(endpoint, id, active, count) {
    const isSupport = endpoint === 'support';
    votePeers(endpoint, id).forEach((a) => {
      a.classList.toggle('bym-voted', active);
      a.title = active
        ? isSupport
          ? '已送楼主积分表示支持'
          : '已踩过楼主'
        : isSupport
          ? '送楼主积分以表支持'
          : '消耗3积分反对楼主(楼主不加分)';
      if (count != null) {
        writeVoteLabel(a, (isSupport ? '楼主好评' : '楼主差评') + ' (+' + count + ')');
      }
    });
  }

  // 楼主好评 / 差评与楼层赞 / 踩用同一套加减规则：
  // 成功的这一方向 +1，和另一方向互斥，切换时把另一方向减 1。
  // 括号里是人数，点一次加一人；3 积分只是点击者付出的代价，不是显示计数。
  function applyOpVote(endpoint, id, opts) {
    const bump = !opts || opts.bump !== false;
    const isSupport = endpoint === 'support';
    let likeCount = opCountFor('support', id);
    let caiCount = opCountFor('oppose', id);
    const likeActive = opVoteActive('support', id);
    const caiActive = opVoteActive('oppose', id);
    if (likeCount == null) likeCount = 0;
    if (caiCount == null) caiCount = 0;

    if (isSupport) {
      if (bump && !likeActive) likeCount += 1;
      if (caiActive) caiCount = Math.max(0, caiCount - 1);
      paintOpVote('support', id, true, likeCount);
      paintOpVote('oppose', id, false, caiCount);
      myOpVotes.delete('oppose:' + id);
      myOpVotes.add('support:' + id);
    } else {
      if (bump && !caiActive) caiCount += 1;
      if (likeActive) likeCount = Math.max(0, likeCount - 1);
      paintOpVote('oppose', id, true, caiCount);
      paintOpVote('support', id, false, likeCount);
      myOpVotes.delete('support:' + id);
      myOpVotes.add('oppose:' + id);
    }
  }

  // 赞踩接口通常用 GET；万一服务端要求 POST（收藏接口就是这样），
  // 收到「请求方式错误」后自动改用 POST 重试一次。
  async function voteRequest(href) {
    const url = withUid(href);
    const json = await requestJSON(url);
    if (json && /请求方式错误/.test(String(json.ajax_msg || ''))) {
      const uid = currentUid();
      return requestJSON(url, { method: 'POST', data: uid ? { _uid: uid } : null });
    }
    return json;
  }

  // 只有匿名帖第一次点击时的「未知的论坛ID」值得静默补发；
  // 积分不足、已赞过等失败重试也没用，直接交给调用方处理。
  function voteNeedsRetry(json) {
    const st = Number(json && json.ajax_st);
    const msg = String((json && json.ajax_msg) || '');
    return st !== 1 && /未知的论坛\s*ID/.test(msg);
  }

  // 站点用这些提示表示服务端已经记过这一票。
  // 必须先看提示再看 ajax_st：重复赞 / 踩时服务端也可能返回 st=1，
  // 若先按成功处理，刷新页面后再点一次会让计数无脑 +1。
  function voteAlreadyDone(msg) {
    // 只认重复投票特有的措辞：带「过」或「不能更 / 不能再」。
    // 成功投票也可能返回「已赞了」之类的文案，不能把「了」当成重复。
    return /已(?:经)?(?:赞|踩|好评|差评)过|不能更|不能(?:再)?(?:赞|踩|差|好评|差评)/.test(
      String(msg || '')
    );
  }

  // 实测匿名回复可能已计票却返回 0500「未知的论坛ID」，随后重试返回
  // 「已赞过 / 已踩过」。保留本次请求链的上下文，不能把这种确认结果
  // 当成点击前就投过，否则会错误撤销本次的 +1。
  // 0500 本身不算成功；仍需后续响应确认，不假设 Cookie 初始化行为。
  const VOTE_RETRY_DELAYS = [120, 240];
  async function voteRequestWithRetry(href, context) {
    if (context) context.unknownIdSeen = false;
    let json;
    try {
      json = await voteRequest(href);
    } catch (e) {
      json = await voteRequest(href);
    }
    for (const delay of VOTE_RETRY_DELAYS) {
      if (!voteNeedsRetry(json)) return json;
      if (context && String(json.ajax_code) === '0500') context.unknownIdSeen = true;
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const retry = await voteRequest(href);
        if (retry) json = retry;
      } catch (e) {
        // 网络抖动：保留上一次响应，继续下一次补发
      }
    }
    return json;
  }

  async function handleVoteClick(a) {
    const info = voteInfoOf(a);
    if (!info) return;
    const { endpoint, id } = info;
    const isFloor = endpoint === 'voteup' || endpoint === 'votedown';
    // 同一楼层的赞和踩共用一把锁：请求进行中再点另一边，
    // 两次请求交错会让「回滚」覆盖掉后一次乐观更新。
    const key = isFloor ? 'floor:' + id : endpoint + ':' + id;
    if (voteBusy.has(key)) return;

    let snap = null;
    if (isFloor) {
      // 楼层赞踩只看图标：点已经点亮的一边直接没反应
      if (floorVoteActive(endpoint, voteMainPeers(endpoint, id))) return;
      // 先即时更新界面，再发请求；失败时用快照回滚
      snap = applyFloorVote(endpoint, id);
    } else if (myOpVotes.has(key)) {
      // 楼主卡片的两个图标服务端一直渲染成激活色，只能用脚本记录的 bym-voted
      return;
    }

    const href = a.getAttribute('href');
    if (!href) {
      restoreFloorVote(id, snap);
      return;
    }

    voteBusy.add(key);
    a.classList.add('bym-vote-busy');
    try {
      const requestContext = {};
      const json = await voteRequestWithRetry(href, requestContext);
      const st = Number(json && json.ajax_st);
      const msg = String((json && json.ajax_msg) || '');

      if (isFloor) {
        if (voteAlreadyDone(msg)) {
          // 匿名回复本次先返回 0500，再确认已经投过：保留本次乐观更新。
          // 重复提示本身与 ajax_st 无关（0 / 1 都出现过），不能拿 st 当条件。
          // 首次响应就是重复投票时，仍撤销预加的 +1，避免刷新后重复加票。
          if (requestContext.unknownIdSeen &&
              /\/article\/IWhisper\/ajax_(?:voteup|votedown)\//.test(href)) return;
          settleDuplicateFloorVote(endpoint, id, snap);
          return;
        }
        if (st === 1) return; // 成功，乐观更新已经生效
        restoreFloorVote(id, snap); // 其他失败：回滚界面
        if (/未知的论坛\s*ID/.test(msg)) {
          a.title = '该楼层暂时无法赞踩';
        } else if (json && msg) {
          if (window.DIALOG && typeof DIALOG.alertDialog === 'function') DIALOG.alertDialog(msg);
          else a.title = '操作失败：' + msg;
        }
        return;
      }

      // 楼主赞踩不参与乐观更新，仍按服务端提示处理
      if (voteAlreadyDone(msg)) {
        applyOpVote(endpoint, id, { bump: false });
        return;
      }
      if (st === 1) {
        myOpVotes.add(key);
        applyOpVote(endpoint, id);
        return;
      }
      if (/未知的论坛\s*ID/.test(msg)) {
        a.title = '该楼层暂时无法赞踩';
        return;
      }
      if (json && msg) {
        if (window.DIALOG && typeof DIALOG.alertDialog === 'function') DIALOG.alertDialog(msg);
        else a.title = '操作失败：' + msg;
      }
    } catch (e) {
      restoreFloorVote(id, snap);
      a.title = '操作失败：' + (e && e.message ? e.message : '网络错误');
    } finally {
      voteBusy.delete(key);
      a.classList.remove('bym-vote-busy');
    }
  }

  function installVoteActions() {
    if (document.__bymVoteActions) return;
    document.__bymVoteActions = true;
    document.addEventListener(
      'click',
      (event) => {
        if (!state.enabled || !isModern()) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target;
        const a = target && target.closest
          ? target.closest('a.a-func-like, a.a-func-cai, a.a-func-support, a.a-func-oppose')
          : null;
        if (!a || !a.closest('#body') || !voteInfoOf(a)) return;
        // 未登录时仍交给站点自己弹登录提示
        if (!currentUid()) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        handleVoteClick(a);
      },
      true
    );
  }

  function dialogTextOf(el) {
    if (el == null) return '';
    if (typeof el === 'string') return el;
    if (typeof el.text === 'function') return el.text();
    return el.textContent || '';
  }

  // 和 text() 不同，这里保留标签，用来识别模板类型（a_cross / a_forward / u-query）
  function dialogHtmlOf(el) {
    if (el == null) return '';
    if (typeof el === 'string') return el;
    if (el.jquery) return el.html() || el.prop('outerHTML') || '';
    if (el.nodeType === 1) return el.outerHTML || el.innerHTML || '';
    return '';
  }

  function isGenericDialogTitle(title) {
    if (!title) return true;
    const generic = ['提示', '消息', '系统提示'];
    if (window.SYS && SYS.code && SYS.code.COM_TITLE) generic.push(String(SYS.code.COM_TITLE));
    return generic.indexOf(String(title)) !== -1;
  }

  // 赞 / 踩由 installVoteActions 直接接管，这里只剩两件事：
  //   1. 「未知的论坛ID」和重复赞踩提示静默丢弃（兜底，防止站点别的分支再弹）；
  //   2. 给「转载 / 转寄 / 用户资料」补上对应标题。
  function patchDialogs() {
    installVoteActions();
    const D = window.DIALOG;
    if (!D) return;

    if (typeof D.alertDialog === 'function' && !D.__bymNoisePatched) {
      const origAlert = D.alertDialog;
      D.alertDialog = function (el) {
        const text = dialogTextOf(el);
        if (state.enabled && isModern() && (VOTE_NOISE_RE.test(text) || voteAlreadyDone(text))) {
          return null;
        }
        return origAlert.apply(this, arguments);
      };
      D.__bymNoisePatched = true;
    }

    if (typeof D.open === 'function' && !D.__bymTitlePatched) {
      const origOpen = D.open;
      D.open = function (el, option) {
        if (state.enabled && isModern()) {
          const html = dialogHtmlOf(el);
          const opt = Object.assign({}, option || {});
          if (isGenericDialogTitle(opt.title)) {
            if (/id=["']a_cross["']/.test(html)) opt.title = '转载';
            else if (/id=["']a_forward["']/.test(html)) opt.title = '转寄';
            else if (/class=["'][^"']*\bu-query\b/.test(html)) opt.title = '用户资料';
          }
          const ret = origOpen.call(this, el, opt);
          scheduleDialogDecorate();
          return ret;
        }
        const ret = origOpen.apply(this, arguments);
        scheduleDialogDecorate();
        return ret;
      };
      D.__bymTitlePatched = true;
    }
  }

  // 根据弹窗实际宽度设置圆角档位；用户资料框用单独的大圆角
  function decorateDialogs() {
    document.querySelectorAll('.ui-dialog').forEach((dlg) => {
      if (dlg.querySelector('.u-query')) dlg.classList.add('bym-dialog-profile');
      else dlg.classList.remove('bym-dialog-profile');
      let width = parseFloat(dlg.style.width);
      if (!width) {
        const rect = dlg.getBoundingClientRect();
        width = rect && rect.width;
      }
      const size = !width ? 'lg' : width < 300 ? 'sm' : width < 420 ? 'md' : 'lg';
      if (dlg.dataset.bymDialogSize !== size) dlg.dataset.bymDialogSize = size;
    });
  }

  let dialogDecorateTimer = 0;
  function scheduleDialogDecorate() {
    if (dialogDecorateTimer) return;
    dialogDecorateTimer = requestAnimationFrame(() => {
      dialogDecorateTimer = 0;
      decorateDialogs();
      syncDialogOpenState();
    });
  }

  // 弹窗打开时给 html/body 加锁，关掉页面本身的滚动条
  function syncDialogOpenState() {
    if (!document.body) return;
    let open = false;
    if (state.enabled && isModern()) {
      open = Array.from(document.querySelectorAll('.ui-dialog')).some((dlg) => {
        const cs = getComputedStyle(dlg);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        const rect = dlg.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }
    document.documentElement.classList.toggle('bym-dialog-open', open);
    document.body.classList.toggle('bym-dialog-open', open);
  }

  function bindDialogEvents() {
    const $ = window.jQuery;
    if (!$ || document.__bymDialogEvents) return;
    document.__bymDialogEvents = true;
    $(document).on('dialogopen dialogclose dialogresize', scheduleDialogDecorate);
  }

  // 同一楼层的顶部 / 底部赞踩链接 id 相同，把刚变化的那一份同步给其余副本
  function mirrorLikeState(records) {
    if (!state.enabled || !isModern()) return;
    const sources = new Map();
    const collect = (node) => {
      if (!node || node.nodeType !== 1) return;
      // 只认节点自身或它的祖先里最近的赞踩链接。不能对任意祖先做
      // querySelectorAll：站点或脚本改动 <body> 的 class 时会一次
      // 抓到整页所有链接，反而把旧状态当成新状态。
      const a = node.closest && node.closest('a[id^="list"]');
      if (a && /^(list(_oppose)?|listCai|like_list)\d+$/.test(a.id)) sources.set(a.id, a);
    };
    records.forEach((record) => {
      const target = record.target;
      collect(target && target.nodeType === 1 ? target : target && target.parentElement);
      // 站点如果整体替换了 <li> 里的链接，从新增节点里找新链接
      if (record.addedNodes) {
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          collect(node.matches && node.matches('a[id^="list"]') ? node : node.firstElementChild);
        });
      }
    });
    sources.forEach((src, id) => {
      if (!src.isConnected) return;
      document.querySelectorAll('#body a[id="' + id + '"]').forEach((peer) => {
        if (peer === src) return;
        if (peer.innerHTML !== src.innerHTML) peer.innerHTML = src.innerHTML;
        if (peer.getAttribute('href') !== src.getAttribute('href')) {
          peer.setAttribute('href', src.getAttribute('href') || '');
        }
        if (peer.className !== src.className) peer.className = src.className;
      });
    });
  }

  let likeObserver = null;

  function installLikeSync() {
    if (likeObserver || !document.body) return;
    likeObserver = new MutationObserver((records) => mirrorLikeState(records));
    likeObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'href'],
    });
  }

  /* ---------------------------- 收藏 ---------------------------- */

  // 服务端把「已收藏」的文字渲染成什么并不能完全确定，这里两种都认。
  // 只提供收藏；取消收藏仍请到站点的「我的收录文章」里操作。
  const collectedArticles = new Set();
  const busyCollectIds = new Set();

  function collectIdOf(a) {
    const href = a.getAttribute('href') || '';
    const byHref = /\/ajax_add2collection\/(\d+)\.json/.exec(href);
    if (byHref) return byHref[1];
    const byId = /^artco(\d+)$/.exec(a.id || '');
    return byId ? byId[1] : '';
  }

  function isCollectLink(a) {
    if (!a || a.querySelector('.a-pos')) return false;
    const label = (a.textContent || '').replace(/\s+/g, '');
    return (
      label === '收藏' ||
      label === '已收藏' ||
      label === '取消收藏' ||
      label === '已收录' ||
      label === '取消收录'
    );
  }

  function applyCollectState(a, collected) {
    const label = collected ? '已收藏' : '收藏';
    const current = (a.textContent || '').trim();
    if (current === label && (a.dataset.bymCollected || '') === (collected ? '1' : '')) {
      a.title = collected ? '已收藏' : '将文章收录';
      return;
    }
    const icon = a.querySelector('samp');
    if (icon) icon.remove();
    a.textContent = '';
    if (icon) a.appendChild(icon);
    a.appendChild(document.createTextNode(label));
    if (collected) a.dataset.bymCollected = '1';
    else delete a.dataset.bymCollected;
    a.classList.toggle('bym-collected', collected);
    a.title = collected ? '已收藏' : '将文章收录';
  }

  function decorateCollectLinks(root) {
    (root || document).querySelectorAll('#body a.a-func-collect, #body a[id^="artco"]').forEach((a) => {
      if (!isCollectLink(a)) return;
      const id = collectIdOf(a);
      if (!id) return;
      const label = (a.textContent || '').replace(/\s+/g, '');
      if (label === '已收藏' || label === '取消收藏' || label === '已收录' || label === '取消收录') {
        collectedArticles.add(id);
        applyCollectState(a, true);
      } else if (collectedArticles.has(id)) {
        applyCollectState(a, true);
      }
    });
  }

  function currentUid() {
    if (window.SESSION && typeof SESSION.get === 'function') {
      const id = SESSION.get('id');
      if (id && id !== 'guest') return String(id);
    }
    if (window.SYS && SYS.uid && SYS.uid !== 'guest') return String(SYS.uid);
    return '';
  }

  function withUid(url) {
    const u = new URL(url, location.href);
    if (!u.searchParams.has('_uid')) {
      const uid = currentUid();
      if (uid) u.searchParams.set('_uid', uid);
    }
    return u.href;
  }

  function requestJSON(url, options) {
    const opts = options || {};
    const method = opts.method || 'GET';
    const data = opts.data || null;
    const $ = window.jQuery;
    if ($) {
      return new Promise((resolve, reject) => {
        $.ajax({ url, type: method, data, dataType: 'json', cache: false, timeout: 12000 })
          .done(resolve)
          .fail((xhr, status, err) => reject(new Error(status || err || 'request failed')));
      });
    }
    const init = {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    };
    if (data) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      init.body = Object.keys(data)
        .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
        .join('&');
    }
    return fetch(url, init)
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then((text) => JSON.parse(text));
  }

  // 收藏接口要求 POST；同时把 _uid 放进表单体，兼容只读 POST 参数的服务端
  function collectPost(url) {
    const uid = currentUid();
    return requestJSON(url, {
      method: 'POST',
      data: uid ? { _uid: uid } : null,
    });
  }

  function applyCollectStateToId(id, collected) {
    document.querySelectorAll('#body a[id="artco' + id + '"]').forEach((a) => {
      if (isCollectLink(a)) applyCollectState(a, collected);
    });
  }

  // 只做收藏，不提供取消收藏：站点没有公开稳定的删除接口，
  // 与其猜测地址，不如让「已收藏」保持为静态状态，取消请到「我的收录文章」。
  async function toggleCollection(a) {
    const id = collectIdOf(a);
    if (!id || busyCollectIds.has(id)) return;
    const wasCollected =
      collectedArticles.has(id) ||
      a.dataset.bymCollected === '1' ||
      /已收藏|取消收藏|已收录|取消收录/.test(a.textContent || '');
    if (wasCollected) {
      applyCollectState(a, true);
      return;
    }
    const href = a.getAttribute('href') || '';
    if (!href) return;

    busyCollectIds.add(id);
    a.classList.add('bym-collect-busy');
    try {
      const json = await collectPost(withUid(href));
      const st = Number(json && json.ajax_st);
      const msg = String((json && json.ajax_msg) || '');
      if (st === 1 || /已(?:经)?(?:收录|收藏)/.test(msg)) {
        collectedArticles.add(id);
        applyCollectStateToId(id, true);
      } else if (json) {
        console.warn('[BYR 简约版] 收藏失败:', msg || json);
        a.title = json && String(json.ajax_code) === '0002'
          ? '登录后才能收藏'
          : '收藏失败：' + (msg || '请稍后再试');
      }
    } catch (e) {
      console.warn('[BYR 简约版] 收藏操作失败:', e);
    } finally {
      busyCollectIds.delete(id);
      a.classList.remove('bym-collect-busy');
    }
  }

  function installCollectToggle() {
    if (document.__bymCollectToggle) return;
    document.__bymCollectToggle = true;
    document.addEventListener(
      'click',
      (event) => {
        if (!state.enabled || !isModern()) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target;
        const a = target && target.closest ? target.closest('a.a-func-collect, a[id^="artco"]') : null;
        if (!a || !isCollectLink(a)) return;
        // 未登录时交给站点自己弹出登录提示
        if (!currentUid()) return;
        event.preventDefault();
        event.stopPropagation();
        toggleCollection(a);
      },
      true
    );
  }

  // 点击遮罩（弹窗以外的部分）关闭最上层弹窗，等价于「取消」
  function closeTopDialog() {
    const D = window.DIALOG;
    if (D && typeof D.getTop === 'function') {
      try {
        const top = D.getTop();
        if (top && typeof top.dialog === 'function') {
          top.dialog('close');
          scheduleDialogDecorate();
          return;
        }
      } catch (e) {
        /* 继续用 DOM 兜底 */
      }
    }
    const dialogs = document.querySelectorAll('.ui-dialog');
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const dlg = dialogs[i];
      if (!dlg.offsetParent) continue;
      const close = dlg.querySelector('.ui-dialog-titlebar-close');
      if (close) {
        close.click();
      } else if (window.jQuery) {
        window.jQuery(dlg).hide();
      }
      scheduleDialogDecorate();
      return;
    }
  }

  function installDialogOutsideClose() {
    if (document.__bymDialogOutside) return;
    document.__bymDialogOutside = true;
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!target || !target.classList || !target.classList.contains('ui-widget-overlay')) return;
        if (!state.enabled || !isModern()) return;
        closeTopDialog();
      },
      true
    );
  }

  // 区分两处搜索：底部工具栏是「本版搜索」，卡片上的搜索是「搜此 ID 的文章」
  function decorateSearchLabels() {
    const submit = document.querySelector('#f_search input[type="submit"]');
    if (submit) {
      if (submit.dataset.bymSearchLabel !== '1') {
        submit.dataset.bymSearchLabel = '1';
        submit.dataset.bymSearchOrigin = submit.value;
        submit.dataset.bymSearchTitle = submit.title || '';
      }
      if (submit.value !== '搜本版文章') submit.value = '搜本版文章';
      const title = '在当前版面内按关键字 / 作者搜索文章';
      if (submit.title !== title) submit.title = title;
    }
    document.querySelectorAll('#body a[href*="/s/article"][href*="au="]').forEach((a) => {
      if (a.dataset.bymSearchLabel !== '1') {
        a.dataset.bymSearchLabel = '1';
        a.dataset.bymSearchOrigin = a.textContent;
        a.dataset.bymSearchTitle = a.title || '';
      }
      if (a.textContent !== '搜此ID文章') a.textContent = '搜此ID文章';
      const title = '搜索该 ID 在版面内发表的文章';
      if (a.title !== title) a.title = title;
    });
  }

  // 所有版面：与楼主同 ID 的非首楼卡片，在原有徽标后补一个「楼主」
  function decorateFloorOpBadge(wrap, isOp) {
    const existing = wrap.querySelector('.a-head .bym-pos-op');
    if (!isOp) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const badge = document.createElement('span');
    badge.className = 'a-pos bym-pos-op';
    badge.textContent = '楼主';
    const headLeft = wrap.querySelector('.a-head .a-left') || wrap.querySelector('.a-head');
    if (!headLeft) return;
    const pos = headLeft.querySelector('.a-pos:not(.bym-pos-op)');
    if (pos) pos.after(badge);
    else headLeft.appendChild(badge);
  }

  // 切回经典版时把移动过的节点放回原处（用户操作、徽标、meta 区块）
  function restoreArticle() {
    closeLightbox();

    // 拆掉头像外面新增的链接，恢复站点原来的 div > img 结构
    document.querySelectorAll('.a-u-img > a.bym-avatar-link').forEach((a) => {
      const face = a.parentNode;
      if (!face) return;
      while (a.firstChild) face.insertBefore(a.firstChild, a);
      a.remove();
    });

    movedActions.forEach((parent, info) => {
      if (info.isConnected && parent && info.parentNode !== parent) parent.appendChild(info);
      const wrap = info.closest ? info.closest('.a-wrap') : null;
      if (wrap) wrap.classList.remove('bym-actions-moved');
    });
    movedActions.clear();

    movedBadges.forEach((parent, badge) => {
      if (badge.isConnected && parent && badge.parentNode !== parent) parent.appendChild(badge);
    });
    movedBadges.clear();

    // 还原「发信人 / 标题 / 发信站」区块：先拆掉折叠包装和按钮，
    // 再放回被移除的空行，最后拆掉包装 div
    metaTrimmed.forEach((nodes, meta) => {
      if (!meta.isConnected) return;
      meta.querySelectorAll('.bym-meta-toggle').forEach((btn) => btn.remove());
      meta.querySelectorAll(':scope > .bym-meta-extra, :scope > .bym-meta-main').forEach((span) => {
        span.replaceWith(...Array.from(span.childNodes));
      });
      meta.classList.remove('bym-meta-open');
      if (nodes.length) meta.after(...nodes);
      meta.replaceWith(...Array.from(meta.childNodes));
    });
    metaTrimmed.clear();

    // 把移进发信信息折叠区的「※ 来源 / 修改」放回正文原位置
    sourceFolded.forEach((marker, font) => {
      if (marker.parentNode) {
        marker.replaceWith(font);
      } else if (font.parentNode) {
        // 原占位点已随页面重绘消失：至少放回正文末尾，避免丢内容
        const content = document.querySelector('#body .a-content-wrap');
        if (content) content.appendChild(font);
      }
    });
    sourceFolded.clear();
    document.querySelectorAll('.bym-meta-source').forEach((box) => box.remove());

    // 正文末尾原本的空行恢复显示
    document.querySelectorAll('#body .bym-tail-blank').forEach((el) => {
      el.classList.remove('bym-tail-blank');
    });
    document.querySelectorAll('#body .a-wrap').forEach((wrap) => {
      delete wrap.dataset.bymTailTrimmed;
    });

    // 媒体外链恢复成原始链接，去掉占位的播放器卡片
    mediaEmbeds.forEach((anchor, box) => {
      if (box.isConnected && anchor) box.replaceWith(anchor);
    });
    mediaEmbeds.clear();
    document.querySelectorAll('#body .bym-embed-origin').forEach((a) => {
      a.classList.remove('bym-embed-origin');
    });
    document.querySelectorAll('#body img.bym-emoji-img').forEach((img) => {
      img.classList.remove('bym-emoji-img');
    });

    // 标题条恢复「文章主题:」前缀
    strippedTitles.forEach((entry) => {
      if (entry.node.isConnected) entry.node.nodeValue = entry.original;
    });
    strippedTitles.clear();

    // 脚本添加的类 / 徽标在经典版下没有意义，一并清掉
    document.querySelectorAll('#body .bym-source').forEach((el) => {
      el.classList.remove('bym-source');
    });
    document.querySelectorAll('#body .bym-pos-op').forEach((el) => el.remove());
    document.querySelectorAll('#body .bym-nice-only').forEach((el) => el.remove());
    document.querySelectorAll('.bym-hide-search').forEach((el) => {
      el.classList.remove('bym-hide-search');
    });
    // 收藏按钮恢复站点原来的文案
    document.querySelectorAll('#body a.a-func-collect').forEach((a) => {
      if (!isCollectLink(a)) return;
      const icon = a.querySelector('samp');
      if (icon) icon.remove();
      a.textContent = '';
      if (icon) a.appendChild(icon);
      a.appendChild(document.createTextNode('收藏'));
      a.title = '将文章收录';
      a.classList.remove('bym-collected', 'bym-collect-busy');
      delete a.dataset.bymCollected;
    });
    // 赞踩的临时状态类在经典版下没有意义
    document.querySelectorAll('#body a.bym-voted, #body a.bym-vote-busy').forEach((a) => {
      a.classList.remove('bym-voted', 'bym-vote-busy');
    });
    document.documentElement.classList.remove('bym-dialog-open');
    document.body.classList.remove('bym-dialog-open');
    // 恢复两处搜索按钮原来的文字
    document.querySelectorAll('[data-bym-search-label="1"]').forEach((el) => {
      if (el.dataset.bymSearchOrigin !== undefined) {
        if (el.tagName === 'INPUT') el.value = el.dataset.bymSearchOrigin;
        else el.textContent = el.dataset.bymSearchOrigin;
      }
      el.title = el.dataset.bymSearchTitle || '';
      delete el.dataset.bymSearchLabel;
      delete el.dataset.bymSearchOrigin;
      delete el.dataset.bymSearchTitle;
    });
    document.querySelectorAll('#body .a-wrap').forEach((wrap) => {
      wrap.classList.remove('bym-anon', 'bym-actions-empty', 'bym-actions-moved', 'bym-actions-bottom');
    });
  }

  function decorateFloors() {
    if (!state.enabled || !isArticlePage() || !hasArticleContent()) return;

    // 站点是 hash SPA，翻页时旧节点会被整体替换；
    // 丢掉已经离线的节点，避免 Map 无限增长，也避免还原到旧页面
    movedActions.forEach((parent, info) => {
      if (!info.isConnected) movedActions.delete(info);
    });
    movedBadges.forEach((parent, badge) => {
      if (!badge.isConnected) movedBadges.delete(badge);
    });
    metaTrimmed.forEach((nodes, meta) => {
      if (!meta.isConnected) metaTrimmed.delete(meta);
    });
    sourceFolded.forEach((marker, font) => {
      if (!font.isConnected || !marker.isConnected) sourceFolded.delete(font);
    });
    strippedTitles.forEach((entry, el) => {
      if (!el.isConnected || !entry.node.isConnected) strippedTitles.delete(el);
    });
    mediaEmbeds.forEach((anchor, box) => {
      if (!box.isConnected) mediaEmbeds.delete(box);
    });

    const wraps = Array.from(document.querySelectorAll('#body .a-wrap'));
    // 站点已经在楼主楼层标了「楼主」（匿名帖也一样），以它为准；
    // 翻到没有楼主的后续页时就不标注，避免把首个楼层误认成楼主。
    const opName = (() => {
      const opWrap = wraps.find((wrap) => {
        const pos = wrap.querySelector('.a-head .a-pos:not(.bym-pos-op)');
        return pos && (pos.textContent || '').trim() === '楼主';
      });
      const name = opWrap && opWrap.querySelector('.a-head .a-u-name');
      return name ? (name.textContent || '').trim() : '';
    })();

    wraps.forEach((wrap, index) => {
      const author = wrap.querySelector('.a-head .a-left');
      const badge = wrap.querySelector('.a-head .a-pos');
      if (author && badge && !author.contains(badge)) {
        if (!movedBadges.has(badge)) movedBadges.set(badge, badge.parentNode);
        author.appendChild(badge);
      }
      decorateMeta(wrap);
      decorateSource(wrap);
      foldSourceLines(wrap);
      trimTrailingBlank(wrap);
      markEmojiImages(wrap);
      decorateMediaLinks(wrap);
      decorateUserActions(wrap);

      // 底部左侧单元格为空（匿名帖 / 按钮已移走）时不再占位
      const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
      if (bottomLeft) {
        const hasElement = !!bottomLeft.querySelector('img, a, ul, iframe, div');
        const text = (bottomLeft.textContent || '').replace(/[\s ]/g, '');
        wrap.classList.toggle('bym-actions-empty', !hasElement && !text);
      }

      // 匿名帖没有用户名 / 等级信息，左栏收窄
      const hasUser = !!wrap.querySelector('.a-body .a-u-uid, .a-body .a-u-info, .a-func-info');
      wrap.classList.toggle('bym-anon', !hasUser);
      // 等匿名标记确定后再决定发信 / 加好友的落点
      const actionInfo = wrap.querySelector('.a-func-info');
      const actionLeft = wrap.querySelector('.a-body > .a-left');
      if (actionInfo && actionLeft) placeUserActions(wrap, actionInfo, actionLeft);

      // 匿名帖没有真实用户 ID，按 ID 搜索没有对象，隐藏；
      // 赞 / 踩保留（IWhisper 也能点，只是站点可能返回「未知的论坛ID」，
      // 该提示已在 patchDialogs() 里静默掉）。
      wrap.querySelectorAll('a[href*="/s/article"][href*="au="]').forEach((a) => {
        const li = a.closest('li');
        if (li) li.classList.toggle('bym-hide-search', !hasUser);
      });

      // 除楼主卡片外，同 ID 的楼层补一个「楼主」徽标（所有版面）
      const nameNode = wrap.querySelector('.a-head .a-u-name');
      const name = nameNode ? (nameNode.textContent || '').trim() : '';
      decorateFloorOpBadge(wrap, index > 0 && !!opName && name === opName);
    });

    stripTitlePrefix();
    decorateCollectLinks(document.querySelector('#body'));
    decorateSearchLabels();
    fixOnlyIdLinks(document.querySelector('#body'));
    decorateNiceReplies();

    mountComposer();
    syncFloatbar();
    updateFloatbarVisibility();
    updateBottomBarFlow();
    mountFloorTopButton();
    updateFloorTopButton();
  }

  function scheduleDecorate() {
    // 在下一帧绘制前完成装饰：新内容插入后不会先以「未装饰」的样子
    // 出现在屏幕上再跳一下，同时也能合并同一批 DOM 变更。
    if (decorateTimer) return;
    decorateTimer = requestAnimationFrame(() => {
      decorateTimer = null;
      decorateFloors();
    });
  }

  /* ------------------------------------------------------------------ *
   * 5. 浮动标题 / 路径栏、底栏表情按钮、头像点击
   * ------------------------------------------------------------------ */
  let floatbar = null;
  let floatTitle = null;
  let floatPath = null;
  let floatMode = 'title';
  let lastScrollY = window.scrollY || 0;

  function setFloatMode(mode) {
    if (!floatbar) return;
    if (floatMode === mode && floatbar.classList.contains('bym-mode-' + mode)) return;
    floatMode = mode;
    floatbar.classList.remove('bym-mode-title', 'bym-mode-path');
    floatbar.classList.add('bym-mode-' + mode);
  }

  function mountFloatbar() {
    if (!document.body) return;
    const existing = document.getElementById('bym-floatbar');
    if (existing && existing !== floatbar) floatbar = existing;
    if (!floatbar) {
      floatbar = document.createElement('div');
      floatbar.id = 'bym-floatbar';
      floatbar.classList.add('bym-mode-title');

      const titleRow = document.createElement('div');
      titleRow.className = 'bym-float-row bym-float-title';
      titleRow.title = '回到顶部';
      const titleTag = document.createElement('span');
      titleTag.className = 'bym-float-tag';
      titleTag.textContent = '标题';
      floatTitle = document.createElement('span');
      floatTitle.className = 'bym-float-title-text';
      titleRow.append(titleTag, floatTitle);
      titleRow.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const pathRow = document.createElement('div');
      pathRow.className = 'bym-float-row bym-float-path';
      const pathTag = document.createElement('span');
      pathTag.className = 'bym-float-tag';
      pathTag.textContent = '位置';
      floatPath = document.createElement('div');
      floatPath.className = 'bym-float-path-text';
      pathRow.append(pathTag, floatPath);

      floatbar.append(titleRow, pathRow);
    }
    if (!document.body.contains(floatbar)) document.body.appendChild(floatbar);
    if (!floatTitle) floatTitle = floatbar.querySelector('.bym-float-title-text');
    if (!floatPath) floatPath = floatbar.querySelector('.bym-float-path-text');
    setFloatMode(floatMode);
  }

  function syncFloatbar() {
    if (!document.body) return;
    if (!floatbar) return;
    const titleNode = document.querySelector('#body .b-head .n-left');
    if (titleNode && floatTitle) {
      const text = (titleNode.textContent || '')
        .replace(/^文章主题\s*[:：]\s*/, '')
        .trim();
      if (floatTitle.textContent !== text) floatTitle.textContent = text;
    }
    const nav = document.querySelector('#notice_nav');
    if (nav && floatPath) {
      const html = nav.innerHTML;
      if (floatPath.dataset.srchtml !== html) {
        const clone = nav.cloneNode(true);
        clone.removeAttribute('id');
        floatPath.textContent = '';
        floatPath.appendChild(clone);
        floatPath.dataset.srchtml = html;
      }
    }
  }

  function updateFloatbarVisibility() {
    if (!floatbar) return;
    const y = window.scrollY || window.pageYOffset || 0;
    const modern = isModern();
    const head = modern ? document.querySelector('#body .b-head') : null;
    if (!head || y < FLOATBAR_MIN_SCROLL) {
      floatbar.classList.remove('bym-visible');
      lastScrollY = y;
      return;
    }
    const show = head.getBoundingClientRect().bottom < FLOATBAR_HEAD_GAP;
    if (show) {
      if (y > lastScrollY + 1) setFloatMode('title');
      else if (y < lastScrollY - 1) setFloatMode('path');
      floatbar.classList.add('bym-visible');
    } else {
      floatbar.classList.remove('bym-visible');
    }
    lastScrollY = y;
  }

  // 右下角「回到本楼顶部」：楼层明显高于视口、楼顶已经滚出屏幕时出现。
  // 用视口中线判断当前楼层；滚动事件按帧合并，长列表里也不会反复重排。
  let floorTopBtn = null;
  let floorTopLabel = null;
  let floorTopTarget = null;
  let floorTopFrame = 0;

  function mountFloorTopButton() {
    if (!document.body) return;
    if (!floorTopBtn) {
      floorTopBtn = document.createElement('button');
      floorTopBtn.id = 'bym-floor-top';
      floorTopBtn.type = 'button';
      const arrow = document.createElement('span');
      arrow.className = 'bym-floor-top-arrow';
      arrow.textContent = '↑';
      floorTopLabel = document.createElement('span');
      floorTopLabel.className = 'bym-floor-top-label';
      floorTopBtn.append(arrow, floorTopLabel);
      floorTopBtn.addEventListener('click', () => {
        const target = floorTopTarget;
        if (!target || !target.isConnected) return;
        const y = window.scrollY || window.pageYOffset || 0;
        const top = target.getBoundingClientRect().top + y;
        // 顶部浮动栏会挡住楼层标题，跳转时给它留出位置
        const offset = floatbar && floatbar.classList.contains('bym-visible') ? 58 : 12;
        window.scrollTo({ top: Math.max(0, top - offset), behavior: 'smooth' });
      });
    }
    if (!document.body.contains(floorTopBtn)) document.body.appendChild(floorTopBtn);
  }

  function currentFloorForTop() {
    const wraps = document.querySelectorAll('#body .a-wrap');
    if (!wraps.length) return null;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const mid = vh * 0.5;
    let active = null;
    let rect = null;
    for (let i = 0; i < wraps.length; i += 1) {
      const current = wraps[i].getBoundingClientRect();
      // 跳过被站点隐藏的楼层，否则它的 0 尺寸会把当前楼层带偏
      if (!current.width && !current.height) continue;
      if (current.top <= mid) {
        active = wraps[i];
        rect = current;
      } else {
        break;
      }
    }
    if (!active || !rect) return null;
    // 只服务真正很高的楼层；短楼层顶部本来就在附近，不需要这个按钮
    if (rect.height <= vh * 0.9) return null;
    if (rect.top > -120 || rect.bottom < 24) return null;
    return active;
  }

  function updateFloorTopButton() {
    if (!floorTopBtn) return;
    const target = state.enabled && isModern() ? currentFloorForTop() : null;
    floorTopTarget = target;
    if (!target) {
      floorTopBtn.classList.remove('bym-visible');
      return;
    }
    const pos = target.querySelector('.a-head .a-pos');
    const text = pos ? (pos.textContent || '').trim() : '';
    if (floorTopLabel && floorTopLabel.textContent !== text) floorTopLabel.textContent = text;
    const name = text || '本楼';
    floorTopBtn.setAttribute('aria-label', '回到' + name + '顶部');
    floorTopBtn.title = '回到' + name + '顶部';
    floorTopBtn.classList.add('bym-visible');
  }

  function scheduleFloorTopUpdate() {
    if (floorTopFrame) return;
    floorTopFrame = requestAnimationFrame(() => {
      floorTopFrame = 0;
      updateFloorTopButton();
    });
  }

  // 底部工具栏：默认悬浮；滚到页面末尾时回到最后一张卡片之后
  function updateBottomBarFlow() {
    if (!document.body) return;
    const bar = document.querySelector('#body > .t-pre-bottom');
    const wraps = document.querySelectorAll('#body .a-wrap');
    let flow = false;
    if (isModern() && bar && wraps.length) {
      const last = wraps[wraps.length - 1];
      const composerH =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--bym-composer-h')
        ) || 54;
      flow = last.getBoundingClientRect().bottom <= window.innerHeight - composerH - 12;
    }
    document.body.classList.toggle('bym-bottom-flow', flow);
  }

  // 输入框随内容自动换行、增高；底栏和左下角控制条跟着上移
  function resizeComposer() {
    // 切回经典版后不再接管输入框尺寸
    if (!isModern()) return;
    const comment = document.querySelector('.a-comment');
    const ta = comment && comment.querySelector('.a-comment-txt textarea');
    if (!comment || !ta) return;
    ta.style.setProperty('height', 'auto', 'important');
    const h = Math.max(COMPOSER_MIN_H, Math.min(ta.scrollHeight, COMPOSER_MAX_H));
    ta.style.setProperty('height', h + 'px', 'important');
    ta.style.setProperty(
      'overflow-y',
      ta.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden',
      'important'
    );
    const box = Math.round(comment.getBoundingClientRect().height);
    if (box > 0) {
      document.documentElement.style.setProperty('--bym-composer-h', box + 'px');
    }
    updateBottomBarFlow();
  }

  // 表情面板默认收起，保留站点的 UBB 表情功能
  function mountComposer() {
    if (!document.body || !state.enabled) return;
    const comment = document.querySelector('.a-comment');
    if (!comment) return;
    const form = comment.querySelector('#quick_post');
    if (!form) return;
    let btn = form.querySelector('#bym-emoji-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'bym-emoji-toggle';
      btn.type = 'button';
      btn.textContent = '😊';
      btn.title = '表情';
      btn.setAttribute('aria-label', '表情');
      btn.addEventListener('click', () => {
        const open = comment.classList.toggle('bym-emoji-open');
        btn.setAttribute('aria-expanded', String(open));
      });
    }
    const actions = form.querySelector('.a-comment-btn');
    const submit = actions ? actions.querySelector('input[type="submit"], .button') : null;
    // 表情按钮放在「快捷回复」之前
    if (actions) {
      if (btn.parentNode !== actions || (submit && btn.nextElementSibling !== submit)) {
        actions.insertBefore(btn, submit || actions.firstChild);
      }
    } else if (btn.parentNode !== form) {
      form.appendChild(btn);
    }
    btn.setAttribute('aria-expanded', String(comment.classList.contains('bym-emoji-open')));

    // 具体表情显示在「经典 / 悠嘻猴 / 兔斯基 / 洋葱头」四个分类按钮之上
    const em = comment.querySelector('#em_img');
    if (em) {
      const tabs = em.querySelector('.ubb-img-tab');
      const list = em.querySelector('.ubb-img');
      if (tabs && list && list.nextElementSibling !== tabs) {
        em.insertBefore(list, tabs);
      }
    }

    const ta = comment.querySelector('.a-comment-txt textarea');
    if (ta) {
      // 记住站点原来的 rows（通常是默认 2 行），切回经典版时还原
      if (ta.dataset.bymRowsSaved !== '1') {
        ta.dataset.bymRowsSaved = '1';
        ta.dataset.bymOrigRows = ta.getAttribute('rows') || '';
      }
      ta.rows = 1;
      if (!ta.dataset.bymGrow) {
        ta.dataset.bymGrow = '1';
        ta.addEventListener('input', resizeComposer);
      }
    }
    resizeComposer();
  }

  // 切回经典版：把快捷回复区恢复成站点原来的结构和尺寸
  function restoreComposer() {
    const comment = document.querySelector('.a-comment');
    if (comment) {
      comment.classList.remove('bym-emoji-open');

      const ta = comment.querySelector('.a-comment-txt textarea');
      if (ta) {
        ta.style.removeProperty('height');
        ta.style.removeProperty('overflow-y');
        if (ta.dataset.bymRowsSaved === '1') {
          if (ta.dataset.bymOrigRows) ta.setAttribute('rows', ta.dataset.bymOrigRows);
          else ta.removeAttribute('rows');
        }
        if (ta.dataset.bymGrow === '1') {
          ta.removeEventListener('input', resizeComposer);
          delete ta.dataset.bymGrow;
        }
      }

      // 恢复表情面板顺序：站点原始顺序是「分类按钮在上，表情在下」
      const em = comment.querySelector('#em_img');
      const tabs = em && em.querySelector('.ubb-img-tab');
      const list = em && em.querySelector('.ubb-img');
      if (em && tabs && list && list.nextElementSibling === tabs) {
        em.insertBefore(tabs, list);
      }

      const emojiBtn = comment.querySelector('#bym-emoji-toggle');
      if (emojiBtn) emojiBtn.remove();
    }
    document.documentElement.style.removeProperty('--bym-composer-h');
  }

  // 表情面板打开后，点面板和快捷回复区以外的地方视为关闭
  function closeEmojiPanel(comment) {
    if (!comment || !comment.classList.contains('bym-emoji-open')) return;
    comment.classList.remove('bym-emoji-open');
    const btn = comment.querySelector('#bym-emoji-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function onDocumentClickOutsideEmoji(event) {
    if (!state.enabled || !isModern()) return;
    const comment = document.querySelector('.a-comment');
    if (!comment || !comment.classList.contains('bym-emoji-open')) return;
    if (comment.contains(event.target)) return;
    closeEmojiPanel(comment);
  }

  /* 图片灯箱：正文 / 精彩回复里的图片点击后在页内浮层预览，多图可翻页。
     交互参照 Fancybox 的缩略图放大 / 说明文字 / 上下张切换，但不引入
     jQuery + Fancybox（约 170KB），只保留和帖子页相关的部分。 */
  let lightboxEl = null;
  let lightboxImg = null;
  let lightboxCount = null;
  let lightboxCaption = null;
  let lightboxPrev = null;
  let lightboxNext = null;
  let lightboxClose = null;
  let lightboxItems = [];
  let lightboxIndex = 0;
  let lightboxReturn = null;
  let lightboxClosing = false;
  // 灯箱内点击放大：以点击位置为中心缩放，放大后可以拖动查看
  const LIGHTBOX_ZOOM = 2.2;
  let lightboxZoom = 1;
  let lightboxPanX = 0;
  let lightboxPanY = 0;
  let lightboxDrag = null;

  function imageGroup(img) {
    return img.closest('.a-nice-comment-content') || img.closest('.a-content');
  }

  // 只接管正文和精彩回复里的图片；头像、表情、站内图标都跳过
  function lightboxEligible(img) {
    if (!img || img.tagName !== 'IMG' || img.closest('#bym-lightbox')) return false;
    if (!imageGroup(img)) return false;
    if (img.closest('.a-u-img, .a-nice-comment-face, .a-head, .a-bottom, .a-left, .a-comment, .bym-embed')) {
      return false;
    }
    const alt = (img.getAttribute('alt') || '').trim();
    if (
      EMOJI_ALT_RE.test(alt) || img.classList.contains('bym-emoji-img') ||
      img.classList.contains('emoji')
    ) {
      return false;
    }
    // 线上偶尔有没写 alt 的小表情，按原始尺寸兜底
    if (img.naturalWidth && img.naturalHeight && img.naturalWidth <= 32 && img.naturalHeight <= 32) {
      return false;
    }
    const src = img.getAttribute('src') || '';
    return !!src && !/^data:/i.test(src);
  }

  // 图片外面有时包着指向原图 / 大图的链接，优先用链接目标
  function lightboxSrc(img) {
    const anchor = img.closest('a[href]');
    const href = anchor && anchor.getAttribute('href');
    if (
      href &&
      !/^javascript:/i.test(href) &&
      /\.(?:jpe?g|png|gif|webp|bmp|avif|svg)(?:[?#].*)?$/i.test(href)
    ) {
      try {
        return new URL(href, location.href).href;
      } catch (e) {
        /* 继续用图片自身的地址 */
      }
    }
    return img.currentSrc || img.src;
  }

  function lightboxCaptionText(img) {
    const alt = (img.getAttribute('alt') || '').trim();
    if (alt && !/^(?:image|图片|img)\b/i.test(alt)) return alt;
    const anchor = img.closest('a[href]');
    return (img.getAttribute('title') || (anchor && anchor.getAttribute('title')) || '').trim();
  }

  function isLightboxOpen() {
    return !!lightboxEl && lightboxEl.isConnected && !lightboxClosing &&
      lightboxEl.classList.contains('bym-lightbox-open');
  }

  function clampLightboxPan() {
    if (!lightboxImg || lightboxZoom <= 1) {
      lightboxPanX = 0;
      lightboxPanY = 0;
      return;
    }
    const maxX = (lightboxZoom - 1) * lightboxImg.clientWidth;
    const maxY = (lightboxZoom - 1) * lightboxImg.clientHeight;
    lightboxPanX = Math.min(0, Math.max(-maxX, lightboxPanX));
    lightboxPanY = Math.min(0, Math.max(-maxY, lightboxPanY));
  }

  function applyLightboxZoom() {
    if (!lightboxImg) return;
    if (lightboxZoom <= 1) {
      lightboxImg.style.transform = '';
      lightboxImg.style.transformOrigin = '';
      return;
    }
    // 以图片左上角为原点，点击处保持不动：
    // translate(px * (1 - scale)) 与 scale 组合后，点击点仍在原坐标
    lightboxImg.style.transformOrigin = '0 0';
    lightboxImg.style.transform = 'translate(' + lightboxPanX.toFixed(1) + 'px,' +
      lightboxPanY.toFixed(1) + 'px) scale(' + lightboxZoom + ')';
  }

  function resetLightboxZoom() {
    lightboxZoom = 1;
    lightboxPanX = 0;
    lightboxPanY = 0;
    lightboxDrag = null;
    if (lightboxEl) lightboxEl.classList.remove('bym-lb-zoomed');
    if (!lightboxImg) return;
    lightboxImg.classList.remove('bym-lb-dragging');
    lightboxImg.style.transform = '';
    lightboxImg.style.removeProperty('transform-origin');
  }

  function toggleLightboxZoom(clientX, clientY) {
    if (!isLightboxOpen() || !lightboxImg) return;
    // 首张图还在做缩略图放大动画时先不接管，避免两套 transform 打架
    if (lightboxImg.classList.contains('bym-lb-loading')) return;
    if (lightboxZoom > 1) {
      lightboxZoom = 1;
      lightboxPanX = 0;
      lightboxPanY = 0;
      lightboxEl.classList.remove('bym-lb-zoomed');
      applyLightboxZoom();
      return;
    }
    const rect = lightboxImg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const py = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    lightboxZoom = LIGHTBOX_ZOOM;
    lightboxPanX = px * (1 - lightboxZoom);
    lightboxPanY = py * (1 - lightboxZoom);
    clampLightboxPan();
    lightboxEl.classList.add('bym-lb-zoomed');
    applyLightboxZoom();
  }

  function onLightboxPointerDown(event) {
    if (!isLightboxOpen() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    lightboxDrag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: lightboxPanX,
      panY: lightboxPanY,
      moved: false,
      zoomed: lightboxZoom > 1,
    };
    if (lightboxDrag.zoomed) {
      lightboxImg.classList.add('bym-lb-dragging');
      try {
        lightboxImg.setPointerCapture(event.pointerId);
      } catch (e) {
        /* 旧浏览器忽略 */
      }
    }
  }

  function onLightboxPointerMove(event) {
    const drag = lightboxDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.zoomed || !drag.moved) return;
    lightboxPanX = drag.panX + dx;
    lightboxPanY = drag.panY + dy;
    clampLightboxPan();
    applyLightboxZoom();
  }

  function endLightboxPointer(event, allowToggle) {
    const drag = lightboxDrag;
    if (!drag || drag.id !== event.pointerId) return;
    lightboxDrag = null;
    if (lightboxImg) {
      lightboxImg.classList.remove('bym-lb-dragging');
      try {
        lightboxImg.releasePointerCapture(event.pointerId);
      } catch (e) {
        /* 旧浏览器忽略 */
      }
    }
    if (allowToggle && !drag.moved) toggleLightboxZoom(event.clientX, event.clientY);
  }

  function onLightboxPointerUp(event) {
    endLightboxPointer(event, true);
  }

  function onLightboxPointerCancel(event) {
    endLightboxPointer(event, false);
  }

  function makeLightboxButton(className, label, pathData) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bym-lb-btn ' + className;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + pathData + '"></path></svg>';
    return btn;
  }

  function ensureLightbox() {
    // 站点重建 body 子节点后把灯箱挂回去
    if (lightboxEl) {
      if (!lightboxEl.isConnected && document.body) document.body.appendChild(lightboxEl);
      return;
    }
    lightboxEl = document.createElement('div');
    lightboxEl.id = 'bym-lightbox';
    lightboxEl.setAttribute('role', 'dialog');
    lightboxEl.setAttribute('aria-modal', 'true');
    lightboxEl.setAttribute('aria-label', '图片预览');
    lightboxEl.setAttribute('aria-hidden', 'true');

    const stage = document.createElement('div');
    stage.className = 'bym-lb-stage';
    lightboxImg = document.createElement('img');
    lightboxImg.alt = '';
    lightboxImg.addEventListener('pointerdown', onLightboxPointerDown);
    lightboxImg.addEventListener('pointermove', onLightboxPointerMove);
    lightboxImg.addEventListener('pointerup', onLightboxPointerUp);
    lightboxImg.addEventListener('pointercancel', onLightboxPointerCancel);
    stage.appendChild(lightboxImg);

    lightboxCount = document.createElement('div');
    lightboxCount.className = 'bym-lb-count';
    lightboxClose = makeLightboxButton('bym-lb-close', '关闭', 'M6 6l12 12M18 6L6 18');
    const top = document.createElement('div');
    top.className = 'bym-lb-top';
    top.append(lightboxCount, lightboxClose);

    lightboxPrev = makeLightboxButton('bym-lb-prev', '上一张', 'M15 5l-7 7 7 7');
    lightboxNext = makeLightboxButton('bym-lb-next', '下一张', 'M9 5l7 7-7 7');
    lightboxCaption = document.createElement('div');
    lightboxCaption.className = 'bym-lb-caption';
    lightboxCaption.hidden = true;

    lightboxPrev.addEventListener('click', (event) => {
      event.stopPropagation();
      stepLightbox(-1);
    });
    lightboxNext.addEventListener('click', (event) => {
      event.stopPropagation();
      stepLightbox(1);
    });
    lightboxClose.addEventListener('click', (event) => {
      event.stopPropagation();
      closeLightbox();
    });
    lightboxEl.addEventListener('click', (event) => {
      if (event.target === lightboxEl || event.target === stage) closeLightbox();
    });

    // 手机左右滑翻页，下滑关闭
    let touchX = 0;
    let touchY = 0;
    lightboxEl.addEventListener('touchstart', (event) => {
      if (event.touches.length === 1) {
        touchX = event.touches[0].clientX;
        touchY = event.touches[0].clientY;
      }
    }, { passive: true });
    lightboxEl.addEventListener('touchend', (event) => {
      // 放大状态下，滑动用于拖动查看，不再翻页 / 关闭
      if (lightboxZoom > 1) return;
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - touchX;
      const dy = touch.clientY - touchY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        stepLightbox(dx < 0 ? 1 : -1);
      } else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
        closeLightbox();
      }
    }, { passive: true });

    // 滚轮翻页：向下滚看下一张，向上滚看上一张。
    // 触控板惯性会连续触发 wheel，这里用最近一次事件的时间做节流：
    // 一次连续滚动只翻一张，停下来后再滚才会继续翻。
    let wheelAt = 0;
    lightboxEl.addEventListener('wheel', (event) => {
      if (!isLightboxOpen() || event.ctrlKey) return;
      event.preventDefault();
      // 放大状态下滚轮让位给拖动查看
      if (lightboxZoom > 1) return;
      const now = Date.now();
      if (now - wheelAt < 150) {
        wheelAt = now;
        return;
      }
      wheelAt = now;
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;
      stepLightbox(delta > 0 ? 1 : -1);
    }, { passive: false });

    lightboxEl.append(stage, top, lightboxPrev, lightboxNext, lightboxCaption);
    document.body.appendChild(lightboxEl);
  }

  function onceImageReady(callback) {
    const done = () => {
      lightboxImg.removeEventListener('load', done);
      lightboxImg.removeEventListener('error', done);
      requestAnimationFrame(() => requestAnimationFrame(callback));
    };
    if (lightboxImg.complete && lightboxImg.naturalWidth) {
      requestAnimationFrame(() => requestAnimationFrame(callback));
      return;
    }
    lightboxImg.addEventListener('load', done);
    lightboxImg.addEventListener('error', done);
  }

  function preloadLightboxNeighbors() {
    if (lightboxItems.length < 2) return;
    [-1, 1].forEach((step) => {
      const index = (lightboxIndex + step + lightboxItems.length) % lightboxItems.length;
      const preload = new Image();
      preload.src = lightboxSrc(lightboxItems[index]);
    });
  }

  function renderLightbox(direction) {
    const item = lightboxItems[lightboxIndex];
    if (!item) return;
    resetLightboxZoom();
    const caption = lightboxCaptionText(item);
    lightboxCaption.textContent = caption;
    lightboxCaption.hidden = !caption;
    if (lightboxItems.length > 1) {
      lightboxCount.textContent = lightboxIndex + 1 + ' / ' + lightboxItems.length;
    }
    if (direction) {
      lightboxImg.style.transition = 'none';
      lightboxImg.style.opacity = '0';
      lightboxImg.style.transform = 'translateX(' + (direction > 0 ? 24 : -24) + 'px)';
    }
    lightboxImg.src = lightboxSrc(item);
    lightboxImg.alt = item.getAttribute('alt') || '';
    if (direction) {
      onceImageReady(() => {
        if (!isLightboxOpen()) return;
        void lightboxImg.offsetWidth;
        lightboxImg.style.transition = '';
        lightboxImg.style.opacity = '';
        lightboxImg.style.transform = '';
      });
    }
  }

  function zoomLightboxFrom(rect) {
    const target = lightboxImg.getBoundingClientRect();
    if (!rect.width || !target.width || !target.height) {
      lightboxImg.classList.add('bym-lb-pop');
      void lightboxImg.offsetWidth;
      requestAnimationFrame(() => lightboxImg.classList.remove('bym-lb-pop'));
      return;
    }
    const dx = (rect.left + rect.width / 2) - (target.left + target.width / 2);
    const dy = (rect.top + rect.height / 2) - (target.top + target.height / 2);
    const sx = rect.width / target.width;
    const sy = rect.height / target.height;
    lightboxImg.style.setProperty('--bym-lb-dx', dx.toFixed(1) + 'px');
    lightboxImg.style.setProperty('--bym-lb-dy', dy.toFixed(1) + 'px');
    lightboxImg.style.setProperty('--bym-lb-sx', sx.toFixed(4));
    lightboxImg.style.setProperty('--bym-lb-sy', sy.toFixed(4));
    lightboxImg.classList.add('bym-lb-from-thumb');
    void lightboxImg.offsetWidth;
    requestAnimationFrame(() => {
      lightboxImg.classList.remove('bym-lb-from-thumb');
    });
  }

  function openLightbox(img) {
    if (lightboxClosing) return;
    const group = imageGroup(img);
    if (!group) return;
    const items = Array.from(group.querySelectorAll('img')).filter(
      (el) => lightboxEligible(el) && imageGroup(el) === group
    );
    if (!items.length) return;

    const thumbRect = img.getBoundingClientRect();
    ensureLightbox();
    lightboxItems = items;
    lightboxIndex = Math.max(0, items.indexOf(img));
    lightboxReturn = img;
    lightboxEl.classList.toggle('bym-lb-single', items.length <= 1);
    lightboxImg.classList.remove('bym-lb-from-thumb', 'bym-lb-to-thumb', 'bym-lb-pop');
    lightboxImg.classList.add('bym-lb-loading');
    lightboxImg.style.removeProperty('--bym-lb-dx');
    lightboxImg.style.removeProperty('--bym-lb-dy');
    lightboxImg.style.removeProperty('--bym-lb-sx');
    lightboxImg.style.removeProperty('--bym-lb-sy');
    lightboxImg.style.transition = '';
    lightboxImg.style.opacity = '';
    lightboxImg.style.transform = '';
    renderLightbox();
    document.documentElement.classList.add('bym-lightbox-lock');
    lightboxEl.setAttribute('aria-hidden', 'false');
    lightboxEl.classList.add('bym-lightbox-open');
    try {
      lightboxClose.focus({ preventScroll: true });
    } catch (e) {
      /* 旧浏览器忽略 */
    }
    onceImageReady(() => {
      if (!isLightboxOpen()) return;
      lightboxImg.classList.remove('bym-lb-loading');
      zoomLightboxFrom(thumbRect);
      preloadLightboxNeighbors();
    });
  }

  function stepLightbox(step) {
    if (!isLightboxOpen() || lightboxItems.length < 2) return;
    const direction = step > 0 ? 1 : -1;
    lightboxIndex = (lightboxIndex + step + lightboxItems.length) % lightboxItems.length;
    renderLightbox(direction);
    preloadLightboxNeighbors();
  }

  function closeLightbox() {
    if (!lightboxEl || lightboxClosing) return;
    if (!lightboxEl.classList.contains('bym-lightbox-open')) {
      document.documentElement.classList.remove('bym-lightbox-lock');
      return;
    }
    lightboxClosing = true;
    // 先瞬时回到未放大状态，否则反向缩放会以放大后的尺寸计算
    lightboxImg.style.transition = 'none';
    resetLightboxZoom();
    void lightboxImg.offsetWidth;
    lightboxImg.style.transition = '';
    const back = lightboxReturn;
    if (back && back.isConnected) {
      const thumb = back.getBoundingClientRect();
      const current = lightboxImg.getBoundingClientRect();
      if (thumb.width && current.width && current.height) {
        const dx = (thumb.left + thumb.width / 2) - (current.left + current.width / 2);
        const dy = (thumb.top + thumb.height / 2) - (current.top + current.height / 2);
        lightboxImg.style.setProperty('--bym-lb-dx', dx.toFixed(1) + 'px');
        lightboxImg.style.setProperty('--bym-lb-dy', dy.toFixed(1) + 'px');
        lightboxImg.style.setProperty('--bym-lb-sx', (thumb.width / current.width).toFixed(4));
        lightboxImg.style.setProperty('--bym-lb-sy', (thumb.height / current.height).toFixed(4));
        lightboxImg.classList.add('bym-lb-to-thumb');
      }
    }
    lightboxEl.classList.add('bym-lb-leaving');
    setTimeout(() => {
      lightboxEl.classList.remove('bym-lightbox-open', 'bym-lb-leaving');
      lightboxEl.setAttribute('aria-hidden', 'true');
      lightboxImg.classList.remove('bym-lb-to-thumb', 'bym-lb-from-thumb', 'bym-lb-loading', 'bym-lb-pop');
      ['--bym-lb-dx', '--bym-lb-dy', '--bym-lb-sx', '--bym-lb-sy'].forEach((name) => {
        lightboxImg.style.removeProperty(name);
      });
      lightboxImg.style.transition = '';
      lightboxImg.style.opacity = '';
      lightboxImg.style.transform = '';
      lightboxImg.removeAttribute('src');
      lightboxItems = [];
      lightboxIndex = 0;
      lightboxClosing = false;
      document.documentElement.classList.remove('bym-lightbox-lock');
      if (back && back.isConnected) {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {
          /* 图片不可聚焦时忽略 */
        }
      }
      lightboxReturn = null;
    }, 260);
  }

  function onArticleImageClick(event) {
    if (!state.enabled || !isModern()) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !lightboxEligible(img)) return;
    event.preventDefault();
    event.stopPropagation();
    openLightbox(img);
  }

  /* ------------------------------------------------------------------ *
   * 6. 启动、路由与 DOM 监听
   * ------------------------------------------------------------------ */
  injectStyle();

  // 尽早给 <html> 加上深色标记，避免页面加载时先闪一下白底
  if (document.documentElement && isArticlePage() && state.enabled && effectiveDark()) {
    document.documentElement.classList.add('bym-dark');
  }

  // 首屏尽早给 <body> 加上简约版标记：流式解析时站点可能先画出头部和
  // 前几张卡片，等到 DOMContentLoaded 才套样式就会闪一下原布局。
  // 只在 URL 已指向具体文章时这么做；从版面页跳转到文章仍由 applyRoute 控制。
  (function markEarlyModern() {
    if (!state.enabled || !isArticlePage() || !getArticleId()) return;
    const apply = () => {
      if (!document.body) return false;
      document.body.classList.add('bym-is-article', 'bym-on');
      return true;
    };
    if (apply() || !document.documentElement) return;
    const early = new MutationObserver(() => {
      if (apply()) early.disconnect();
    });
    early.observe(document.documentElement, { childList: true });
  })();

  function boot() {
    applyRoute();
    patchDialogs();
    bindDialogEvents();
    installLikeSync();
    installDialogOutsideClose();
    installCollectToggle();
    mountDock();
    mountFloatbar();
    mountFloorTopButton();
    // 首次装饰同步完成，避免页面先按站点原布局画一遍、
    // 下一帧再跳到简约版。
    decorateFloors();
    scheduleDecorate();
    scheduleDialogDecorate();
    updateBottomBarFlow();
  }

  // 赞踩接管只依赖 document，尽早挂上，避免等到 DOMContentLoaded / SPA 注入后的 boot()
  installVoteActions();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('hashchange', () => {
    closeMenu();
    // hash 变了但内容还没换：立即撤掉旧内容上的卡片样式，防止闪一下
    applyRoute();
    // 页面内容为 AJAX 渲染，稍后再确认一次
    requestAnimationFrame(() => {
      applyRoute();
      patchDialogs();
      bindDialogEvents();
      installCollectToggle();
      mountDock();
      mountFloatbar();
      mountFloorTopButton();
      scheduleDecorate();
      scheduleDialogDecorate();
    });
    setTimeout(() => {
      applyRoute();
      patchDialogs();
      bindDialogEvents();
      installCollectToggle();
      mountDock();
      mountFloatbar();
      mountFloorTopButton();
      scheduleDecorate();
      scheduleDialogDecorate();
    }, 300);
  });

  // 站点的 DIALOG 在 front_startup() 里才创建，个别情况下会晚于 boot()
  window.addEventListener('load', () => {
    patchDialogs();
    bindDialogEvents();
    installLikeSync();
    installDialogOutsideClose();
    installCollectToggle();
    scheduleDialogDecorate();
    scheduleFloorTopUpdate();
  });

  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('scroll', updateFloatbarVisibility, { passive: true });
  window.addEventListener('scroll', updateBottomBarFlow, { passive: true });
  window.addEventListener('scroll', scheduleFloorTopUpdate, { passive: true });
  window.addEventListener('resize', resizeComposer);
  window.addEventListener('resize', updateBottomBarFlow);
  window.addEventListener('resize', scheduleFloorTopUpdate);
  window.addEventListener('resize', scheduleDialogDecorate);
  // 捕获阶段接管图片点击：阻止站点 / 外层链接新开标签页
  document.addEventListener('click', onArticleImageClick, true);
  document.addEventListener('click', onDocumentClickOutsideEmoji, true);
  document.addEventListener('click', onEmbedClick, false);

  // 缩放或调整窗口跨过 900px 时，重新决定发信 / 加好友的落点
  if (narrowActionsQuery) {
    const onActionsWidth = () => scheduleDecorate();
    if (narrowActionsQuery.addEventListener) narrowActionsQuery.addEventListener('change', onActionsWidth);
    else if (narrowActionsQuery.addListener) narrowActionsQuery.addListener(onActionsWidth);
  }

  // 系统主题变化时，仅在「跟随系统」模式下重新应用
  if (darkQuery) {
    const onSystemTheme = () => {
      if (state.theme === 'auto') applyTheme();
    };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemTheme);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemTheme);
  }

  // 若站点脚本重建了 body 子节点，确保控制条仍在
  const mo = new MutationObserver(() => {
    if (!document.body) return;
    if (dock && !document.body.contains(dock)) document.body.appendChild(dock);
    if (overlay && !document.body.contains(overlay)) document.body.appendChild(overlay);
    if (floatbar && !document.body.contains(floatbar)) document.body.appendChild(floatbar);
    applyRoute();
    scheduleDecorate();
    if (document.querySelector('.ui-dialog')) scheduleDialogDecorate();
    syncDialogOpenState();
  });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
