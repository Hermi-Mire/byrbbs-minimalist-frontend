// ==UserScript==
// @name         北邮人论坛 · 简约版
// @namespace    https://bbs.byr.cn/
// @version      0.6.1
// @description  美化论坛首页（圆角卡片、响应式布局、深色模式），并将帖子详情页重构为响应式简约布局（卡片式楼层、浮动标题/路径栏、底部快捷回复、舒适排版），支持跟随系统的黑夜模式。
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

  /* ------------------------------------------------------------------ *
   * 0. 配置
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'bym-enabled';
  const THEME_KEY = 'bym-theme';
  const TOGGLE_KEY = 'm'; // Alt+M 切换

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
   * 1. 路由判断：首页和帖子详情页启用
   *    BYR 是 hash 路由：#!article/版面/文章ID
   * ------------------------------------------------------------------ */
  function isHomePage() {
    const route = location.hash.replace(/^#!/, '').replace(/\/$/, '');
    return /^(default|index)$/.test(route) ||
      (!location.hash && /^\/(default|index)?\/?$/.test(location.pathname));
  }

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

  function applyRoute() {
    const body = document.body;
    if (!body) return;
    body.classList.toggle('bym-home-route', isHomePage());
    const home = isHomePage() && !!body.querySelector('#body .widget');
    body.classList.toggle('bym-home', home && state.enabled);
    const article = isArticlePage();
    const ready = article && hasArticleContent();
    body.classList.toggle('bym-is-article', article);
    body.classList.toggle('bym-ready', ready);
    body.classList.toggle('bym-on', ready && state.enabled);
    if (!((ready || home) && state.enabled)) {
      body.classList.remove('bym-menu-open');
      syncMenu();
      if (floatbar) floatbar.classList.remove('bym-visible');
    }
    applyTheme();
  }

  /* ------------------------------------------------------------------ *
   * 2. 注入样式（document-start 即注入，避免闪烁）
   * ------------------------------------------------------------------ */
  const CSS = String.raw`
/* ==================================================================
   北邮人论坛 · 简约版
   帖子详情页作用于 body.bym-on，首页样式单独作用于 body.bym-home
   ================================================================== */

/* ---------- 页面底色与基础 ---------- */
body.bym-on {
  width: auto !important;
  min-width: 0 !important;
  background: #f4f6fa !important;
  color: #1f2937;
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
  color: #64748b !important;
  font-size: 12px !important;
  text-decoration: none !important;
  transition: color .15s ease;
}
body.bym-on #top_menu a:hover { color: #2f6fd0 !important; }

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
  border: 1px solid #e4e9f2 !important;
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
  color: #475569 !important;
  text-decoration: none !important;
}
body.bym-on.bym-menu-open #menu a:hover { color: #2f6fd0 !important; }

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
  color: #94a3b8 !important;
}
body.bym-on #notice a {
  color: #64748b !important;
  text-decoration: none !important;
}
body.bym-on #notice a:hover { color: #2f6fd0 !important; }

/* ---------- 内容区不再裁剪 ---------- */
body.bym-on #body {
  width: 100% !important;
  overflow: visible !important;
}
body.bym-on #body .b-content {
  overflow: visible !important;
}

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
  border: 1px solid #e4e9f2 !important;
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
  background: #2f6fd0 !important;
  color: #fff !important;
  font-size: 13px !important;
  line-height: 1.4;
  text-decoration: none !important;
  transition: background .15s ease, transform .15s ease;
}
body.bym-on .t-btn a:hover {
  background: #2159b0 !important;
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
  color: #64748b !important;
  font-size: 12px !important;
  white-space: nowrap;
}
/* 复选框与「精华帖 / 带附件」之间只留一点距离 */
body.bym-on #f_search input[type="checkbox"] {
  margin: 0 -3px 0 0 !important;
  accent-color: #2f6fd0;
}
body.bym-on #f_search .button { margin-left: 2px; }

/* 输入框 / 按钮 */
body.bym-on .input-text {
  border: 1px solid #dbe2ee !important;
  border-radius: 8px !important;
  background: #fff !important;
  padding: 4px 8px !important;
  font-size: 12px !important;
  color: #334155 !important;
}
body.bym-on .button {
  border: 0 !important;
  border-radius: 8px !important;
  background: #eef2f9 !important;
  color: #475569 !important;
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
  color: #64748b !important;
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
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 12px !important;
  line-height: 1.5;
  text-decoration: none !important;
  transition: background .15s ease, color .15s ease;
}
body.bym-on .page-select a {
  background: #2f6fd0 !important;
  color: #fff !important;
}
body.bym-on .page-normal a:hover {
  background: #dbe7fb !important;
  color: #2159b0 !important;
}
body.bym-on .page-jump input[type="text"] { width: 26px !important; }

/* ---------- 文章标题条 ---------- */
body.bym-on #body > .b-head {
  display: flex !important;
  align-items: center !important;
  gap: 14px;
  height: auto !important;
  margin: 0 0 12px !important;
  padding: 16px 20px !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 14px !important;
  background: #fff !important;
  color: #0f172a !important;
  font-size: 19px !important;
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
  color: #94a3b8 !important;
}
body.bym-on #body > .b-head .n-right img { opacity: .55; }
/* 站点给「分享到:」写了内联 color:#eee，浅色下几乎看不见 */
body.bym-on #body > .b-head #a_share {
  color: #94a3b8 !important;
  font-size: 11px !important;
}

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
  margin: 0 0 14px !important;
  border: 1px solid #e4e9f2 !important;
  border-radius: 14px !important;
  background: #fff !important;
  overflow: hidden !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 18px 44px -40px rgba(15, 23, 42, .55);
}
body.bym-on .a-wrap.kb {
  border-color: #2f6fd0 !important;
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
body.bym-on table.article td {
  background: transparent !important;
  vertical-align: top !important;
}
/* 注意：被折叠楼层的占位单元格由站点 JS 控制 display，
   这里不要强制 display，否则「手贱想看」按钮永远不出现 */

/* 楼层头：作者 + 操作 */
body.bym-on .a-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  flex-wrap: wrap;
  gap: 6px 20px;
  height: auto !important;
  padding: 0 !important;
  background: #f8fafc !important;
  border-bottom: 1px solid #eef2f7 !important;
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
  color: #2159b0 !important;
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
  color: #64748b !important;
  font-size: 12px !important;
  text-decoration: none !important;
  transition: color .15s ease;
}
body.bym-on .a-func li a:hover { color: #2f6fd0 !important; }
body.bym-on .a-func samp { opacity: .55; }

/* 楼主 / 沙发等徽标 */
body.bym-on .a-pos {
  display: inline-block;
  padding: 1px 8px !important;
  border-radius: 999px !important;
  background: #2f6fd0 !important;
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
  padding: 16px 10px !important;
  border-right: 1px solid #f1f5f9 !important;
  background: #fbfcff !important;
  text-align: center;
  box-sizing: border-box;
  overflow: visible !important;
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

/* 匿名帖（IWhisper 等）左栏没有用户信息，收窄头像列 */
body.bym-on .a-wrap.bym-anon .a-body .a-left {
  flex: 0 0 104px;
  width: 104px !important;
}
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
body.bym-on .a-body .a-left .a-u-uid a:hover { color: #2f6fd0 !important; }
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
body.bym-on .a-body .a-left .a-u-info dt { color: #94a3b8 !important; white-space: nowrap; }
body.bym-on .a-body .a-left .a-u-info dd { color: #475569 !important; overflow-wrap: anywhere; }

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
  border-top: 1px dashed #eef2f7;
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
  background: #eef2f9 !important;
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
  color: #475569 !important;
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
body.bym-on .a-body .a-left .a-func-info li:hover a { color: #2159b0 !important; }
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
body.bym-on .a-body .a-left .a-func-info li.bym-action-view { display: none !important; }
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
  color: #1f2937 !important;
  font-size: 15px !important;
  line-height: 1.85 !important;
  word-break: break-word;
  overflow-wrap: anywhere;
}
body.bym-on .a-content-wrap {
  color: inherit !important;
  font-size: inherit !important;
  overflow: visible !important;
}
/* 发信人 / 标题 / 发信站：弱化为辅助信息 */
body.bym-on .bym-meta {
  margin: 0 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed #eef2f7;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.75;
}
body.bym-on .bym-meta font { color: inherit !important; }
body.bym-on .a-content-wrap font {
  font-size: inherit !important;
  line-height: inherit !important;
}
body.bym-on .a-content-wrap a {
  color: #2563eb !important;
  text-decoration: none !important;
}
body.bym-on .a-content-wrap a:hover { text-decoration: underline !important; }
/* ※ 来源 / 发信站：进一步弱化 */
body.bym-on .a-content-wrap .bym-source {
  color: #a8b3c2 !important;
  font-size: 11.5px !important;
  line-height: 1.7;
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
/* 站内小表情不要被放大成正文那么大 */
body.bym-on .a-content-wrap img[alt^="ema"] {
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
  border: 1px dashed #dbe2ee !important;
  border-radius: 10px !important;
  background: #f8fafc !important;
}
body.bym-on .a-content2 .a-background p {
  margin: 0 0 6px !important;
  color: #64748b !important;
  font-family: inherit !important;
  font-size: 13px !important;
  line-height: 1.7;
}
body.bym-on .a-content2 .a-func-dispCai {
  margin-top: 6px !important;
  padding: 4px 12px !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 12px !important;
  cursor: pointer;
}

/* 楼层底部：赞/踩/返回顶部 */
body.bym-on .a-bottom {
  display: flex !important;
  /* 站点给这一行写死了 23px；不放开的话，单元格的内边距只会向上下溢出，行高不会真的变大 */
  height: auto !important;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
body.bym-on .a-bottom td {
  display: flex !important;
  align-items: center;
  gap: 12px;
  padding: 12px 16px !important;
  border-top: 1px solid #f1f5f9 !important;
  background: #fbfcff !important;
}
/* 左栏按钮已移入头像列，空出来的底部左单元格不再占位 */
body.bym-on .a-wrap.bym-actions-moved .a-bottom > .a-left,
body.bym-on .a-wrap.bym-actions-empty .a-bottom > .a-left { display: none !important; }
body.bym-on .a-bottom > td:last-child {
  flex: 1 1 auto;
  min-width: 0;
}
/* 底部状态（赞 / 踩 / 楼主好评）与正文左边缘对齐，不再落到头像列下方 */
body.bym-on .a-wrap.bym-actions-moved .a-bottom > td:last-child,
body.bym-on .a-wrap.bym-actions-empty .a-bottom > td:last-child {
  padding-left: calc(184px + 20px) !important;
}
body.bym-on .a-wrap.bym-anon .a-bottom > td:last-child {
  padding-left: calc(104px + 20px) !important;
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
  color: #64748b !important;
  font-size: 12px !important;
  line-height: 1.6;
  text-decoration: none !important;
}
body.bym-on .a-status a:hover { color: #2f6fd0 !important; }
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
  color: #94a3b8 !important;
  font-size: 12px !important;
  text-decoration: none !important;
}
body.bym-on .a-back:hover { color: #2f6fd0 !important; }

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
  padding: 12px 14px !important;
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
  line-height: 1.75 !important;
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
  border: 1px solid #e4e9f2 !important;
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
  border: 1px solid #dbe2ee !important;
  border-radius: 10px !important;
  background: #fbfcff !important;
  color: #1f2937 !important;
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
  background: #2f6fd0 !important;
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease;
}
body.bym-on .a-comment-btn .button:hover { background: #2159b0 !important; }

/* 表情面板默认收起，点「😊」后在输入框上方浮出，保留原有表情功能 */
#bym-emoji-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid #dbe2ee;
  border-radius: 10px;
  background: #f4f7fc;
  color: #475569;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
body.bym-on #bym-emoji-toggle { display: inline-flex; }
#bym-emoji-toggle:hover { background: #e8eef9; }
#bym-emoji-toggle[aria-expanded="true"] {
  background: #2f6fd0;
  border-color: #2f6fd0;
}

body.bym-on #em_img { display: none !important; }
body.bym-on .a-comment.bym-emoji-open #em_img {
  display: block !important;
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
  border: 1px solid #e4e9f2 !important;
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
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 12px !important;
  cursor: pointer;
}
body.bym-on .ubb-img-tab li div { color: inherit !important; }
body.bym-on .ubb-img-tab li[_cur="1"] {
  background: #2f6fd0 !important;
  color: #fff !important;
}
body.bym-on .ubb-img-tab li[_cur="1"] div { color: #fff !important; }

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
  color: #94a3b8 !important;
}

/* ---------- 窄屏适配 ---------- */
@media (max-width: 900px) {
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
  body.bym-on #body > .b-head { font-size: 17px !important; padding: 13px 16px !important; }
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
  body.bym-on .a-wrap.bym-anon .a-body .a-left {
    flex: 0 0 auto;
    width: 100% !important;
  }
  body.bym-on .a-wrap.bym-anon .a-body .a-left img {
    width: 48px !important;
    height: 48px !important;
  }
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
  body.bym-on .a-nice-comment-item { padding: 10px !important; gap: 12px; }
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
  body.bym-on .a-nice-comment-content { font-size: 13.5px !important; }
  /* 窄屏头像列已变成顶部横条，底部状态恢复通栏 */
  body.bym-on .a-wrap.bym-actions-moved .a-bottom > td:last-child,
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
  body.bym-on .a-body .a-left .a-func-info li { flex: 1 1 0; }
}

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
body.bym-home-route #bym-dock { display: flex; }
#bym-dock button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid #dbe2ee;
  border-radius: 999px;
  background: rgba(255, 255, 255, .92);
  color: #475569;
  font: 12px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  cursor: pointer;
  box-shadow: 0 6px 20px -10px rgba(15, 23, 42, .5);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  opacity: .6;
  transition: opacity .15s ease, transform .15s ease;
}
#bym-dock button:hover { opacity: 1; transform: translateY(-1px); }
#bym-toggle.bym-off { color: #94a3b8; }
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
  border: 1px solid #e4e9f2;
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
  background: #eef2f9;
  color: #64748b;
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
  color: #1f2937;
  font-size: 13.5px;
  font-weight: 600;
}
.bym-float-path-text {
  color: #64748b;
  font-size: 12px;
}
.bym-float-path-text #notice_nav,
.bym-float-path-text > div {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
#bym-floatbar a {
  color: #64748b !important;
  text-decoration: none !important;
}
#bym-floatbar a:hover { color: #2f6fd0 !important; }

/* 桌面端：底部工具栏吸底，快捷回复只占一行 */
@media (min-width: 901px) {
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
  body.bym-on #bym-dock { bottom: calc(var(--bym-composer-h, 54px) + 72px); }
}

/* 底部浮层会遮住末尾内容，给页面和页脚留出空间 */
body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 38px) !important; }
body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 42px) !important; }
@media (min-width: 901px) {
  body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 92px) !important; }
  body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 102px) !important; }
}
@media (max-width: 900px) {
  body.bym-on #main { padding-bottom: calc(var(--bym-composer-h, 54px) + 38px) !important; }
  body.bym-on #bot_foot { margin-bottom: calc(var(--bym-composer-h, 54px) + 42px) !important; }
  body.bym-on #bym-dock { bottom: calc(var(--bym-composer-h, 54px) + 22px); }
  body.bym-on .a-comment { bottom: 8px !important; width: calc(100vw - 20px) !important; }
  #bym-floatbar {
    top: 6px;
    width: calc(100vw - 20px);
    height: 38px;
  }
}

/* ==================================================================
   黑夜模式：跟随系统，或由左下角太阳/月亮按钮手动覆盖
   （首页或帖子页简约版开启时给 html 加 .bym-dark）
   ================================================================== */
html.bym-dark { background: #0d1117; color-scheme: dark; }

html.bym-dark body.bym-on { background: #0d1117 !important; color: #d7dee8; }
html.bym-dark body.bym-on #top_menu a { color: #94a3b8 !important; }
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
  background: #2f6fd0 !important;
  color: #fff !important;
}
html.bym-dark body.bym-on .page-normal a:hover {
  background: #26364a !important;
  color: #cfe0ff !important;
}
html.bym-dark body.bym-on .pagination { color: #94a3b8 !important; }
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
html.bym-dark body.bym-on #f_search label { color: #94a3b8 !important; }

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
  border-color: #2f6fd0 !important;
  box-shadow: 0 0 0 3px rgba(47, 111, 208, .22) !important;
}
html.bym-dark body.bym-on .a-head {
  background: #131a23 !important;
  border-bottom-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-u-name,
html.bym-dark body.bym-on .a-u-name a { color: #a9c8fa !important; }
html.bym-dark body.bym-on .a-u-name a:hover { color: #dbe9ff !important; }
html.bym-dark body.bym-on .a-func li a { color: #94a3b8 !important; }
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
html.bym-dark body.bym-on .bym-meta {
  color: #7d8a9c;
  border-bottom-color: #222c3a;
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
html.bym-dark body.bym-on .a-content2 .a-background p { color: #94a3b8 !important; }
html.bym-dark body.bym-on .a-content2 .a-func-dispCai {
  background: #1e2836 !important;
  color: #aab6c6 !important;
}
html.bym-dark body.bym-on .a-bottom td {
  background: #131a23 !important;
  border-top-color: #222c3a !important;
}
html.bym-dark body.bym-on .a-status a { color: #94a3b8 !important; }
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
  background: #2f6fd0 !important;
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
  color: #94a3b8;
}
html.bym-dark #bym-floatbar .bym-float-title-text { color: #e6edf6; }
html.bym-dark #bym-floatbar .bym-float-path-text { color: #94a3b8; }
html.bym-dark #bym-floatbar a { color: #aab6c6 !important; }
html.bym-dark #bym-floatbar a:hover { color: #7fb0f5 !important; }

#bym-emoji-toggle { background: #f4f7fc; color: #475569; border-color: #dbe2ee; }
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
`;

  const HOME_CSS = String.raw`
/* 首页：保留原始组件及站点事件，只调整展示。 */
body.bym-home { --home-bg:#f4f6fa; --home-card:#fff; --home-text:#243247; --home-muted:#718096; --home-line:#e4e9f2; --home-accent:#2f6fd0; background:var(--home-bg)!important; color:var(--home-text); min-width:0!important; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; -webkit-font-smoothing:antialiased; }
html.bym-dark body.bym-home { --home-bg:#101722; --home-card:#192230; --home-text:#dbe5f1; --home-muted:#94a3b8; --home-line:#2b384b; --home-accent:#8bb7ff; color-scheme:dark; }
body.bym-home #top_head { display:flex!important; align-items:center; gap:24px; max-width:1240px; height:auto!important; min-height:80px; margin:auto!important; padding:12px 24px!important; box-sizing:border-box; background:transparent!important; }
body.bym-home #top_logo { margin:0!important; float:none!important; }
body.bym-home #top_logo img { height:38px!important; width:auto!important; }
body.bym-home #top_menu { margin-left:auto!important; float:none!important; }
body.bym-home #top_menu ul { display:flex; flex-wrap:wrap; gap:16px; }
body.bym-home #top_menu a { color:var(--home-muted)!important; text-decoration:none; }
body.bym-home #ban_ner, body.bym-home #left_adv, body.bym-home #left_line { display:none!important; }
body.bym-home #menu { position:absolute!important; top:96px!important; left:max(24px,calc((100vw - 1192px)/2))!important; width:208px!important; margin:0!important; background:transparent!important; }
body.bym-home #u_login, body.bym-home #xlist { width:auto!important; margin:0 0 16px!important; padding:16px!important; border:1px solid var(--home-line)!important; border-radius:16px!important; background:var(--home-card)!important; box-sizing:border-box; }
body.bym-home #menu a { color:var(--home-text)!important; line-height:1.9; }
body.bym-home #menu input { max-width:100%; box-sizing:border-box; }
body.bym-home #main { width:auto!important; max-width:960px; margin:12px max(24px,calc((100vw - 1192px)/2)) 64px max(256px,calc((100vw - 728px)/2))!important; padding:0!important; border:0!important; background:transparent!important; }
body.bym-home #notice { background:transparent!important; border:0!important; padding:0 4px 18px!important; color:var(--home-muted)!important; }
body.bym-home #notice a { color:var(--home-muted)!important; }
body.bym-home #body { width:100%!important; background:transparent!important; overflow:visible!important; }
body.bym-home #body .column { box-sizing:border-box; padding:0 8px!important; }
body.bym-home #body .widget { margin:0 0 20px!important; border:1px solid var(--home-line)!important; border-radius:16px!important; background:var(--home-card)!important; box-shadow:0 8px 24px -18px #273d6240; overflow:hidden; color:var(--home-text)!important; }
body.bym-home #body .widget-head { height:auto!important; min-height:28px; padding:16px 18px!important; background:transparent!important; border:0!important; border-bottom:1px solid var(--home-line)!important; color:var(--home-text)!important; }
body.bym-home #body .widget-title { font-size:16px!important; font-weight:650; letter-spacing:.02em; color:var(--home-text)!important; }
body.bym-home #body .widget-content { height:auto; padding:10px 18px 16px!important; border:0!important; background:transparent!important; color:var(--home-text)!important; }
body.bym-home #body .widget-content li { padding:8px 0!important; line-height:1.7!important; border-bottom:1px solid var(--home-line); }
body.bym-home #body .widget-content li:last-child { border-bottom:0; }
body.bym-home #body .widget-content a { color:var(--home-text)!important; font-size:14px; text-decoration:none!important; overflow-wrap:anywhere; }
body.bym-home #body a:hover,body.bym-home #menu a:hover { color:var(--home-accent)!important; }
body.bym-home a:focus-visible,body.bym-home button:focus-visible { outline:2px solid var(--home-accent); outline-offset:3px; }
body.bym-home #bot_foot { background:transparent!important; border:0!important; color:var(--home-muted)!important; }
body.bym-home #bot_info { color:var(--home-muted)!important; }
@media(max-width:1000px) { body.bym-home #body .column { width:100%!important; float:none!important; } }
@media(max-width:760px) {
 body.bym-home #top_head { padding:12px 16px!important; flex-wrap:wrap; gap:12px; }
 body.bym-home #top_menu ul { gap:10px; padding:0; }
 body.bym-home #menu { display:none!important; }
 body.bym-home #main { margin:12px 12px 80px!important; max-width:none; }
 body.bym-home.bym-menu-open #menu { display:block!important; position:fixed!important; top:80px!important; left:12px!important; bottom:64px; width:240px!important; overflow:auto; z-index:2147482998; }
 body.bym-home #body .column { padding:0!important; }
}
`;

  // 原导航的固定高度及浮动链接与新行高冲突，逐行排版并保留树的显隐逻辑。
  const NAV_CSS = String.raw`
body.bym-home #xlist li { float:none!important; clear:both; width:auto!important; box-sizing:border-box; }
body.bym-home #xlist .x-folder,
body.bym-home #xlist .x-leaf,
body.bym-home #xlist .x-child li > span {
  display:flex!important; align-items:center; gap:7px;
  height:auto!important; min-height:30px; width:100%!important;
  padding:4px 3px!important; box-sizing:border-box;
  overflow:visible!important; line-height:1.5!important;
}
body.bym-home #xlist a {
  float:none!important; display:block; flex:1 1 auto; min-width:0;
  padding:0!important; line-height:1.5!important;
  white-space:normal!important; overflow-wrap:anywhere;
}
body.bym-home #xlist .toggler,
body.bym-home #xlist .leaf samp,
body.bym-home #xlist .leaf-last samp {
  float:none!important; flex-shrink:0; margin:0!important;
}
body.bym-home #xlist .x-child li { padding:0 0 0 10px!important; }
body.bym-home #xlist .x-folder:hover,
body.bym-home #xlist .x-leaf:hover { background:var(--home-bg)!important; border-radius:6px; }
body.bym-home #xlist .x-search input { width:100%!important; min-width:0; }
`;

  function injectStyle() {
    if (document.getElementById('bym-style')) return;
    const el = document.createElement('style');
    el.id = 'bym-style';
    el.textContent = CSS + HOME_CSS + NAV_CSS;
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
    const modern = !!(document.body && (document.body.classList.contains('bym-on') || document.body.classList.contains('bym-home')));
    const dark = !!(modern && state.enabled && effectiveDark());
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
      restoreUserActions();
      document.querySelectorAll('.a-comment.bym-emoji-open').forEach((el) => {
        el.classList.remove('bym-emoji-open');
      });
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
    if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === TOGGLE_KEY) {
      if (isArticlePage() || isHomePage()) {
        e.preventDefault();
        toggle();
      }
    }
    if (e.key === 'Escape') closeMenu();
  }

  /* ------------------------------------------------------------------ *
   * 4. 启动 & 路由监听
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * 3.5 轻量 DOM 增强：把「楼主 / 沙发」徽标移到作者名旁边
   * ------------------------------------------------------------------ */
  let decorateTimer = null;
  const movedActions = new Map(); // .a-func-info -> 原父节点
  const movedBadges = new Map();  // .a-pos -> 原父节点

  // 把正文开头的「发信人 / 标 题 / 发信站」三行收进一个弱化的 meta 区块
  function decorateMeta(wrap) {
    const content = wrap.querySelector('.a-content-wrap');
    if (!content) return;

    // 三行后面通常还跟着一个空 <br>，会撑出多余的行距，一并去掉
    function trimAfterMeta(meta) {
      let next = meta.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && !next.nodeValue.trim()) {
        const after = next.nextSibling;
        next.remove();
        next = after;
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'BR') {
        next.remove();
      }
    }

    const existing = content.querySelector(':scope > .bym-meta');
    if (existing) {
      trimAfterMeta(existing);
      return;
    }

    const first = content.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE || !/^\s*发信人[:：]/.test(first.nodeValue)) {
      return;
    }

    const nodes = [];
    let brs = 0;
    for (const node of Array.from(content.childNodes)) {
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

  // 查看 / 发信 / 加好友：从楼层底部移到左侧用户信息下方
  function decorateUserActions(wrap) {
    const left = wrap.querySelector('.a-body > .a-left');
    const info = wrap.querySelector(
      '.a-bottom .a-left .a-func-info, .a-body > .a-left .a-func-info'
    );
    if (!left || !info) return;
    if (!left.contains(info)) {
      if (!movedActions.has(info)) movedActions.set(info, info.parentNode);
      left.appendChild(info);
    } else if (!movedActions.has(info)) {
      // 兼容已经移动过的页面（例如旧版本保存下来的 DOM）
      const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
      if (bottomLeft) movedActions.set(info, bottomLeft);
    }
    wrap.classList.add('bym-actions-moved');

    // 标记「查看 / 加好友」：查看按钮隐藏，改由头像点击触发；
    // 加好友稍微加宽
    info.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector('a');
      if (!a) return;
      const text = (a.textContent || '').replace(/\s+/g, '');
      const href = a.getAttribute('href') || '';
      if (text === '查看' || href.includes('/user/query/')) li.classList.add('bym-action-view');
      if (text.includes('加好友')) li.classList.add('bym-action-friend');
    });

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

  // 切回经典版时把移动过的节点放回原处
  function restoreUserActions() {
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
  }

  function decorateFloors() {
    if (!state.enabled || !isArticlePage() || !hasArticleContent()) return;
    document.querySelectorAll('#body .a-wrap').forEach((wrap) => {
      const author = wrap.querySelector('.a-head .a-left');
      const badge = wrap.querySelector('.a-head .a-pos');
      if (author && badge && !author.contains(badge)) {
        if (!movedBadges.has(badge)) movedBadges.set(badge, badge.parentNode);
        author.appendChild(badge);
      }
      decorateMeta(wrap);
      decorateSource(wrap);
      decorateUserActions(wrap);

      // 底部左侧单元格为空（匿名帖 / 按钮已移走）时不再占位
      const bottomLeft = wrap.querySelector('.a-bottom > .a-left');
      if (bottomLeft) {
        const hasElement = !!bottomLeft.querySelector('img, a, ul, iframe, div');
        const text = (bottomLeft.textContent || '').replace(/[\s ]/g, '');
        wrap.classList.toggle('bym-actions-empty', !hasElement && !text);
      }

      // 匿名帖没有用户名 / 等级信息，左栏收窄
      const hasUser = !!wrap.querySelector('.a-body .a-u-uid, .a-body .a-u-info, .a-body .a-func-info');
      wrap.classList.toggle('bym-anon', !hasUser);
    });

    mountComposer();
    syncFloatbar();
    updateFloatbarVisibility();
  }

  function scheduleDecorate() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(decorateFloors, 80);
  }

  /* ------------------------------------------------------------------ *
   * 3.6 浮动标题 / 路径栏、底栏表情按钮、头像点击
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
    const modern = document.body && document.body.classList.contains('bym-on');
    const head = modern ? document.querySelector('#body .b-head') : null;
    if (!head || y < 20) {
      floatbar.classList.remove('bym-visible');
      lastScrollY = y;
      return;
    }
    const show = head.getBoundingClientRect().bottom < 56;
    if (show) {
      if (y > lastScrollY + 1) setFloatMode('title');
      else if (y < lastScrollY - 1) setFloatMode('path');
      floatbar.classList.add('bym-visible');
    } else {
      floatbar.classList.remove('bym-visible');
    }
    lastScrollY = y;
  }

  // 输入框随内容自动换行、增高；底栏和左下角控制条跟着上移
  function resizeComposer() {
    const comment = document.querySelector('.a-comment');
    const ta = comment && comment.querySelector('.a-comment-txt textarea');
    if (!comment || !ta) return;
    const max = 112;
    ta.style.setProperty('height', 'auto', 'important');
    const h = Math.max(38, Math.min(ta.scrollHeight, max));
    ta.style.setProperty('height', h + 'px', 'important');
    ta.style.setProperty('overflow-y', ta.scrollHeight > max ? 'auto' : 'hidden', 'important');
    const box = Math.round(comment.getBoundingClientRect().height);
    if (box > 0) {
      document.documentElement.style.setProperty('--bym-composer-h', box + 'px');
    }
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
    if (ta) ta.rows = 1;
    if (ta && !ta.dataset.bymGrow) {
      ta.dataset.bymGrow = '1';
      ta.addEventListener('input', resizeComposer);
    }
    resizeComposer();
  }

  injectStyle();

  // 尽早给 <html> 加上深色标记，避免页面加载时先闪一下白底
  if (document.documentElement && isArticlePage() && state.enabled && effectiveDark()) {
    document.documentElement.classList.add('bym-dark');
  }

  function boot() {
    applyRoute();
    mountDock();
    mountFloatbar();
    scheduleDecorate();
  }

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
      mountDock();
      mountFloatbar();
      scheduleDecorate();
    });
    setTimeout(() => {
      applyRoute();
      mountDock();
      mountFloatbar();
      scheduleDecorate();
    }, 300);
  });

  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('scroll', updateFloatbarVisibility, { passive: true });
  window.addEventListener('resize', resizeComposer);

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
  });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
