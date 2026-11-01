// =========================================================
// Note Reader（スマホ版）画面
// 登録と既読はこの端末の中（IndexedDB）にだけ保存する
// =========================================================
import {
  UNCATEGORIZED, mergeArticles, parseCreatorInput, safeUrl,
  categoryOf, listCategories, collectArts, fmtDate
} from './rss.js';
import { dbGet, dbSet, fetchFeed } from './data.js';
import { SYNC_TAG, NOTIFY_TAG } from './background.js';

const FETCH_CONCURRENCY = 6;
const RETURN_REFRESH_MS = 10 * 60 * 1000;   // ブラウザから戻ったとき、この時間以上空いていれば更新
const SYNC_INTERVAL_MS = 60 * 60 * 1000;    // 希望する確認の間隔。実際の間隔はブラウザが決める
const NEW_CAT = '__new__';

const $ = id => document.getElementById(id);
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const state = {
  creators: [],
  starred: new Map(),
  settings: { filter: 'unread', sort: 'date:desc', theme: 'auto', collapsed: [], category: null, creatorId: null, notify: false },
  query: '',
  arts: new Map(),      // いま画面にある記事（articleId → 記事）
  refreshing: false,
  lastRefresh: 0,
  editingId: null,
  editingCat: null,
  markingIds: null
};

// ---------------------------------------------------------
// 保存
// ---------------------------------------------------------
const saveCreators = () => dbSet('favoriteCreators', state.creators);
const saveStarred  = () => dbSet('nfrStarred', [...state.starred.values()]);
const saveSettings = () => dbSet('settings', state.settings);

// ---------------------------------------------------------
// 取得
// ---------------------------------------------------------
async function refreshAll() {
  if (state.refreshing || state.creators.length === 0) return;
  state.refreshing = true;
  $('refresh-btn').classList.add('spin');
  const atTop = $('list').scrollTop < 10;
  const queue = state.creators.map(c => c.id);
  let newCount = 0, failed = 0;
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const snapshot = state.creators.find(c => c.id === id);
      if (!snapshot) continue;
      try {
        const feed = await fetchFeed(snapshot.noteId);
        // 取得中に削除された人へは書き戻さない
        const cur = state.creators.find(c => c.id === id);
        if (cur && feed.articles.length) newCount += mergeArticles(cur, feed.articles);
      } catch (e) { failed++; }
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  await saveCreators();
  state.refreshing = false;
  state.lastRefresh = Date.now();
  $('refresh-btn').classList.remove('spin');

  if (newCount > 0 && !atTop) {
    // 読んでいる位置を動かさない
    $('new-bar').textContent = `新着 ${newCount}件`;
    $('new-bar').hidden = false;
    renderDrawer();
  } else {
    render({ keepScroll: true });
  }
  if (failed === state.creators.length) toast('更新できませんでした');
  else if (failed > 0) toast(`${failed}名の更新に失敗しました`);
}

// ---------------------------------------------------------
// 描画
// ---------------------------------------------------------
const STAR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.58l-5.9 3.1 1.13-6.58L2.45 9.44l6.6-.96z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

function currentView() {
  const s = state.settings;
  return { filter: s.filter, sort: s.sort, category: s.category, creatorId: s.creatorId, query: state.query };
}

function render({ keepScroll = false } = {}) {
  renderList(keepScroll);
  renderDrawer();
}

function renderList(keepScroll) {
  const el = $('list');
  const s = state.settings;
  const arts = collectArts(state.creators, state.starred, currentView());
  const selected = s.creatorId != null ? state.creators.find(c => String(c.id) === String(s.creatorId)) : null;
  $('ttl').textContent = selected ? selected.name : (s.category ?? 'すべて');
  $('cnt').textContent = arts.length ? `${arts.length}件` : '';
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.filter === s.filter));
  $('sort').value = s.sort;
  $('new-bar').hidden = true;

  state.arts = new Map(arts.map(a => [a.articleId, a]));
  if (state.creators.length === 0) {
    el.innerHTML = `<div class="empty"><button class="pri" data-act="add">＋登録</button></div>`;
    return;
  }
  if (arts.length === 0) {
    const q = state.query.trim();
    el.innerHTML = `<div class="empty">${
      q ? `「${escH(q)}」に一致する記事はありません`
        : s.filter === 'starred' ? 'スター付きの記事はありません'
        : s.filter === 'unread'  ? '未読記事はありません'
        : s.filter === 'read'    ? '既読記事はありません'
        : '記事がありません'
    }</div>`;
    return;
  }
  const top = keepScroll ? el.scrollTop : 0;
  el.innerHTML = arts.map(a => {
    const thumb = safeUrl(a.thumbnailUrl);
    const url = safeUrl(a.url) || '#';
    return `<article class="art${a.isRead ? ' read' : ''}" data-aid="${escH(a.articleId)}">
      <a class="art-main" href="${escH(url)}" target="_blank" rel="noopener">
        ${thumb ? `<img class="thumb" src="${escH(thumb)}" alt="" loading="lazy" decoding="async">` : '<div class="thumb-ph"></div>'}
        <div class="meta">
          <div class="title">${escH(a.title)}</div>
          <div class="info"><span class="creator">${escH(a.creatorName)}</span><span class="date">${escH(fmtDate(a.publishAt))}</span></div>
        </div>
      </a>
      <div class="art-acts">
        <button class="mark" aria-label="既読切替"><span class="dot"></span></button>
        <button class="star${state.starred.has(a.articleId) ? ' on' : ''}" aria-label="スター">${STAR_SVG}</button>
      </div>
    </article>`;
  }).join('');
  el.scrollTop = top;
}

function unreadOf(c) { return (c.latestArticles || []).filter(a => !a.isRead).length; }

function renderDrawer() {
  const s = state.settings;
  const total = state.creators.reduce((n, c) => n + unreadOf(c), 0);
  const count = n => n > 0 ? `<span class="row-count">${n > 999 ? '999+' : n}</span>` : '';
  const EDIT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const CARET = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  let html = `<div class="row${s.category == null && s.creatorId == null ? ' on' : ''}">
    <button class="row-main" data-act="all"><span class="row-name">すべて</span>${count(total)}</button></div>`;
  listCategories(state.creators).forEach(cat => {
    const members = state.creators.filter(c => categoryOf(c) === cat);
    const closed = s.collapsed.includes(cat);
    html += `<div class="row cat${s.category === cat ? ' on' : ''}">
      <button class="fold${closed ? ' closed' : ''}" data-act="fold" data-cat="${escH(cat)}" aria-label="折りたたみ">${CARET}</button>
      <button class="row-main" style="padding-left:0" data-act="cat" data-cat="${escH(cat)}"><span class="row-name">${escH(cat)}</span>${count(members.reduce((n, c) => n + unreadOf(c), 0))}</button>
      ${cat === UNCATEGORIZED ? '' : `<button class="row-edit" data-act="cat-edit" data-cat="${escH(cat)}" aria-label="カテゴリを編集">${EDIT}</button>`}
    </div>`;
    if (closed) return;
    members.forEach(c => {
      html += `<div class="row creator-row${String(s.creatorId) === String(c.id) ? ' on' : ''}">
        <button class="row-main" data-act="creator" data-id="${escH(c.id)}"><span class="row-name">${escH(c.name)}</span>${count(unreadOf(c))}</button>
        <button class="row-edit" data-act="edit" data-id="${escH(c.id)}" aria-label="編集">${EDIT}</button>
      </div>`;
    });
  });
  $('cat-list').innerHTML = html;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ---------------------------------------------------------
// 既読・スター（一覧を作り直さず、その行だけ更新する）
// ---------------------------------------------------------
function setRead(articleId, isRead) {
  state.creators.forEach(c => (c.latestArticles || []).forEach(a => {
    if (a.articleId === articleId) a.isRead = isRead;
  }));
  const art = state.arts.get(articleId);
  if (art) art.isRead = isRead;
  const row = document.querySelector(`.art[data-aid="${CSS.escape(articleId)}"]`);
  if (row) row.classList.toggle('read', isRead);
  renderDrawer();
  saveCreators();
}

function toggleStar(articleId, btn) {
  const art = state.arts.get(articleId);
  if (state.starred.has(articleId)) {
    state.starred.delete(articleId);
    btn.classList.remove('on');
  } else if (art) {
    const { articleId: id, title, url, thumbnailUrl, publishAt, creatorId, creatorName } = art;
    state.starred.set(id, { articleId: id, title, url, thumbnailUrl, publishAt, creatorId, creatorName });
    btn.classList.add('on');
  }
  saveStarred();
}

function markAllRead() {
  const targets = [...state.arts.values()].filter(a => !a.isRead);
  if (targets.length === 0) return;
  state.markingIds = new Set(targets.map(a => a.articleId));
  $('markall-msg').textContent = `表示中の${targets.length}件を既読にします`;
  $('markall-dlg').showModal();
}
function submitMarkAll() {
  const ids = state.markingIds;
  state.creators.forEach(c => (c.latestArticles || []).forEach(a => { if (ids.has(a.articleId)) a.isRead = true; }));
  saveCreators();
  $('markall-dlg').close();
  render();
}

// ---------------------------------------------------------
// 引き出し
// ---------------------------------------------------------
function openDrawer(open) {
  $('drawer').classList.toggle('open', open);
  $('drawer').setAttribute('aria-hidden', String(!open));
  $('scrim').hidden = !open;
}

function onDrawerClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const s = state.settings;
  const act = t.dataset.act;
  if (act === 'fold') {
    const i = s.collapsed.indexOf(t.dataset.cat);
    if (i >= 0) s.collapsed.splice(i, 1); else s.collapsed.push(t.dataset.cat);
    saveSettings();
    renderDrawer();
    return;
  }
  if (act === 'edit') { openEditDialog(t.dataset.id); return; }
  if (act === 'cat-edit') { openCatDialog(t.dataset.cat); return; }
  s.category  = act === 'cat' ? t.dataset.cat : null;
  s.creatorId = act === 'creator' ? t.dataset.id : null;
  saveSettings();
  render();
  openDrawer(false);
}

// ---------------------------------------------------------
// 登録・編集
// ---------------------------------------------------------
function fillCategorySelect(sel, newInput, current) {
  const cats = [...new Set([UNCATEGORIZED, ...listCategories(state.creators)])];
  sel.innerHTML = cats.map(c => `<option value="${escH(c)}">${escH(c)}</option>`).join('')
    + `<option value="${NEW_CAT}">＋新しいカテゴリ</option>`;
  sel.value = current && cats.includes(current) ? current : UNCATEGORIZED;
  newInput.value = '';
  newInput.hidden = true;
}
function chosenCategory(sel, newInput) {
  if (sel.value !== NEW_CAT) return sel.value;
  return newInput.value.trim() || UNCATEGORIZED;
}
function bindNewCategory(sel, newInput) {
  sel.addEventListener('change', () => {
    newInput.hidden = sel.value !== NEW_CAT;
    if (!newInput.hidden) newInput.focus();
  });
}

function openAddDialog(prefill = '') {
  $('add-id').value = prefill;
  $('add-msg').hidden = true;
  fillCategorySelect($('add-cat'), $('add-newcat'), state.settings.category);
  openDrawer(false);
  $('add-dlg').showModal();
}

async function submitAdd() {
  const msg = t => { $('add-msg').textContent = t; $('add-msg').hidden = false; };
  const noteId = parseCreatorInput($('add-id').value);
  if (!noteId) return msg('noteのURLまたはIDを入力してください');
  if (state.creators.some(c => c.noteId.toLowerCase() === noteId.toLowerCase())) return msg('登録済みです');
  $('add-ok').disabled = true;
  try {
    const feed = await fetchFeed(noteId);
    // 登録直後は全記事を既読扱いにする（拡張機能と同じ）
    const creator = {
      id: Date.now(),
      noteId,
      name: feed.name || noteId,
      category: chosenCategory($('add-cat'), $('add-newcat')),
      latestArticles: feed.articles.map(a => ({ ...a, isRead: true }))
    };
    state.creators.push(creator);
    await saveCreators();
    $('add-dlg').close();
    render({ keepScroll: true });
    toast(`登録しました：${creator.name}`);
  } catch (e) {
    msg(e.notFound ? 'クリエイターが見つかりません' : '取得できませんでした');
  } finally {
    $('add-ok').disabled = false;
  }
}

function openEditDialog(id) {
  const c = state.creators.find(c => String(c.id) === String(id));
  if (!c) return;
  state.editingId = c.id;
  $('edit-name').textContent = c.name;
  $('edit-prof').href = `https://note.com/${encodeURIComponent(c.noteId)}`;
  fillCategorySelect($('edit-cat'), $('edit-newcat'), categoryOf(c));
  $('edit-dlg').showModal();
}
function submitEdit() {
  const c = state.creators.find(c => c.id === state.editingId);
  if (c) c.category = chosenCategory($('edit-cat'), $('edit-newcat'));
  saveCreators();
  $('edit-dlg').close();
  render({ keepScroll: true });
}
function deleteCreator() {
  const c = state.creators.find(c => c.id === state.editingId);
  if (!c || !confirm(`${c.name} を削除します`)) return;
  state.creators = state.creators.filter(x => x.id !== c.id);
  if (String(state.settings.creatorId) === String(c.id)) state.settings.creatorId = null;
  saveCreators(); saveSettings();
  $('edit-dlg').close();
  render();
}

function openCatDialog(cat) {
  state.editingCat = cat;
  $('cat-name').value = cat;
  $('cat-dlg').showModal();
}
function renameCategory(from, to) {
  state.creators.forEach(c => { if (categoryOf(c) === from) c.category = to; });
  const s = state.settings;
  if (s.category === from) s.category = to;
  s.collapsed = s.collapsed.filter(c => c !== from);
  saveCreators(); saveSettings();
}
function submitCat() {
  const to = $('cat-name').value.trim();
  if (to && to !== state.editingCat) renameCategory(state.editingCat, to);
  $('cat-dlg').close();
  render({ keepScroll: true });
}
function deleteCat() {
  if (!confirm(`カテゴリ「${state.editingCat}」を削除します（クリエイターは${UNCATEGORIZED}へ移動）`)) return;
  renameCategory(state.editingCat, UNCATEGORIZED);
  $('cat-dlg').close();
  render();
}

// ---------------------------------------------------------
// 設定
// ---------------------------------------------------------
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && systemDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#16181f' : '#f0f2f4';
}

function setMsg(text) {
  $('set-msg').textContent = text;
  $('set-msg').hidden = false;
}

// ---------------------------------------------------------
// 新着の通知（Android の Chrome にインストールしたアプリだけ）
// ---------------------------------------------------------
const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator
  && 'ServiceWorkerRegistration' in window && 'periodicSync' in ServiceWorkerRegistration.prototype;

async function setNotify(on) {
  const reg = await navigator.serviceWorker.ready;
  const fail = text => { $('set-notify').checked = false; setMsg(text); };
  $('set-msg').hidden = true;
  if (on) {
    if (await Notification.requestPermission() !== 'granted') return fail('通知が許可されていません');
    try {
      await reg.periodicSync.register(SYNC_TAG, { minInterval: SYNC_INTERVAL_MS });
    } catch (e) {
      return fail('インストールしたアプリから設定してください');
    }
  } else {
    await reg.periodicSync.unregister(SYNC_TAG);
  }
  state.settings.notify = on;
  saveSettings();
}

async function clearNotifications() {
  if (!canNotify()) return;
  const reg = await navigator.serviceWorker.ready;
  (await reg.getNotifications({ tag: NOTIFY_TAG })).forEach(n => n.close());
}

// アプリを閉じている間に保存された新着を読み直す。
// 変わっていなければ描き直さない（読んだ記事が一覧からすぐ消えないように）
async function reloadCreators() {
  const saved = await dbGet('favoriteCreators');
  if (state.refreshing || !saved || JSON.stringify(saved) === JSON.stringify(state.creators)) return;
  state.creators = saved;
  render({ keepScroll: true });
}

// ---------------------------------------------------------
// 起動
// ---------------------------------------------------------
function bindEvents() {
  $('menu-btn').onclick = () => { renderDrawer(); openDrawer(true); };
  $('scrim').onclick = () => openDrawer(false);
  $('refresh-btn').onclick = refreshAll;
  $('markall-btn').onclick = markAllRead;
  $('markall-ok').onclick = submitMarkAll;
  $('add-btn').onclick = () => openAddDialog();
  $('cat-list').onclick = onDrawerClick;
  $('settings-btn').onclick = () => {
    openDrawer(false);
    document.querySelector(`#set-theme input[value="${state.settings.theme}"]`).checked = true;
    $('set-msg').hidden = true;
    $('notify-row').hidden = !canNotify();
    if (canNotify()) $('set-notify').checked = state.settings.notify && Notification.permission === 'granted';
    $('install').hidden = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    $('set-dlg').showModal();
  };
  $('new-bar').onclick = () => render();

  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  $('filters').onclick = e => {
    const f = e.target.dataset.filter;
    if (!f) return;
    state.settings.filter = f;
    saveSettings();
    render();
  };
  $('sort').onchange = e => { state.settings.sort = e.target.value; saveSettings(); render(); };
  $('search').oninput = e => { state.query = e.target.value; renderList(false); };

  $('list').addEventListener('click', e => {
    if (e.target.closest('[data-act="add"]')) { openAddDialog(); return; }
    const row = e.target.closest('.art');
    if (!row) return;
    const id = row.dataset.aid;
    const star = e.target.closest('.star');
    if (star) { toggleStar(id, star); return; }
    if (e.target.closest('.mark')) { setRead(id, !row.classList.contains('read')); return; }
    if (e.target.closest('.art-main')) setRead(id, true);   // 既定の動作でブラウザが開く
  });

  bindNewCategory($('add-cat'), $('add-newcat'));
  bindNewCategory($('edit-cat'), $('edit-newcat'));
  $('add-ok').onclick = submitAdd;
  $('add-id').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitAdd(); } });
  $('edit-ok').onclick = submitEdit;
  $('edit-del').onclick = deleteCreator;
  $('cat-ok').onclick = submitCat;
  $('cat-del').onclick = deleteCat;

  $('set-theme').onchange = e => { state.settings.theme = e.target.value; saveSettings(); applyTheme(); };
  systemDark.addEventListener('change', applyTheme);
  $('set-notify').onchange = e => setNotify(e.target.checked);

  // ブラウザで記事を読んで戻ってきたとき
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    clearNotifications();
    // 閉じずに戻ったときは、ブラウザが新しい版を確認しないので頼む
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
    await reloadCreators();
    if (Date.now() - state.lastRefresh > RETURN_REFRESH_MS) refreshAll();
  });
}

// Androidの共有メニューから渡されたURL
function takeSharedInput() {
  const p = new URLSearchParams(location.search);
  const shared = p.get('url') || p.get('text') || p.get('title');
  if (shared) history.replaceState(null, '', location.pathname);
  return shared || '';
}

async function init() {
  if ('serviceWorker' in navigator) {
    // 新しい版に切り替わったら読み込み直す。入力中なら次の起動に回す
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !document.querySelector('dialog[open]')) location.reload();
    });
    navigator.serviceWorker.register('sw.js', { type: 'module' }).catch(() => {});
  }
  // 読み込みを必ず先に行う。空のまま操作できると、保存で登録を上書きしてしまう
  const [creators, starred, settings] = await Promise.all([dbGet('favoriteCreators'), dbGet('nfrStarred'), dbGet('settings')]);
  state.creators = creators || [];
  state.starred = new Map((starred || []).map(s => [s.articleId, s]));
  Object.assign(state.settings, settings || {});
  applyTheme();
  render();
  bindEvents();
  const shared = takeSharedInput();
  if (shared) openAddDialog(shared);
  refreshAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  clearNotifications();
}

init();
