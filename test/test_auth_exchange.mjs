// Portal (index.html) のセッション交換: 無応答・失敗で黙ってログイン済みにしない / 遅れた交換を書き戻さない
// 実行: node --test packages/portal/test/test_auth_exchange.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SCRIPT = (() => {
  const blocks = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const s = blocks.find((b) => b.includes('function ssaExchange('));
  assert.ok(s, 'ssaExchange を含む script が無い');
  return s;
})();

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `h.${b64u(claims)}.s`;
const later = (sec) => Math.floor(Date.now() / 1000) + sec;
const GOOGLE = jwt({ email: 'u@example.invalid', exp: later(3600) });
const SESSION_NEW = jwt({ iss: 'ssa', exp: later(30 * 86400) });
const SESSION_OLD = jwt({ iss: 'ssa', exp: later(86400) });

function el() {
  const set = new Set();
  return {
    textContent: '', style: {},
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) },
  };
}

function load(fetchImpl, opts = {}) {
  const store = new Map(Object.entries(opts.storage || {}));
  const els = {};
  const logs = [];
  const docListeners = [];
  const scripts = [];
  const head = {
    appendChild: (s) => { s.parentNode = head; scripts.push(s); },
    removeChild: (s) => { s.parentNode = null; },
  };
  const mkScript = () => {
    const ls = {};
    return {
      dataset: {}, parentNode: null,
      addEventListener: (ev, fn) => { (ls[ev] ||= []).push(fn); },
      fire: (ev) => (ls[ev] || []).splice(0).forEach((fn) => fn()),
    };
  };
  const ctx = {
    console: {
      log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    document: {
      getElementById: (id) => (els[id] ||= el()),
      querySelectorAll: () => [],
      querySelector: (sel) => (sel.includes('data-google-gsi') ? scripts.find((s) => s.parentNode) || null : null),
      createElement: () => mkScript(),
      head,
      body: { classList: el().classList },
      readyState: opts.readyState || 'loading',
      addEventListener: (ev, fn, o) => docListeners.push({ ev, fn, o }),
    },
    navigator: { userAgent: '', platform: '', maxTouchPoints: 0 },
    location: { origin: 'https://portal.invalid', reload: () => {} },
    addEventListener: () => {},
    fetch: fetchImpl,
    // ssaScheduleRenew の約 1 時間の timer で試験が終わらなくならないよう unref する
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; },
    AbortController, clearTimeout, Promise, JSON, Math, Date, atob, decodeURIComponent,
    Vue: function Vue(o) { Object.assign(this, o.methods || {}); },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  ctx.SSA_EXCHANGE_TIMEOUT_MS = 40;
  return { ctx, store, els, logs, docListeners, scripts };
}

const resp = (status, body) => Promise.resolve({
  status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body),
});
const never = () => new Promise(() => {});
const abortable = (_u, opt) => new Promise((_res, rej) => {
  opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(h) {
  h.ctx.handleCredentialResponse({ credential: GOOGLE });
  await sleep(80);
}
const loggedIn = (h) => h.store.get('ariel_auth_token') === GOOGLE;
const errorShown = (h) => h.els.errorMessage?.style.display === 'block';
const loadingHidden = (h) => h.els['loading-view'].classList.contains('hidden') && !h.els['login-view'].classList.contains('hidden');

test('CSS: #loading-view.hidden が #loading-view の display より詳細度で勝つ', () => {
  const css = [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }));
  const shown = rules.find((r) => r.sel.includes('#loading-view') && /display\s*:\s*(?!none)/.test(r.body));
  assert.ok(shown, '#loading-view に display を指定する規則が無い (前提が変わった)');
  const hide = rules.find((r) => r.sel.includes('#loading-view.hidden') && /display\s*:\s*none/.test(r.body));
  assert.ok(hide, '#loading-view.hidden { display: none } が無い');
});

test('200: セッションを保存してログインする', async () => {
  const h = load(() => resp(200, { token: SESSION_NEW, expires_in: 86400 }));
  await login(h);
  assert.equal(h.store.get('ssa_session_token'), SESSION_NEW);
  assert.ok(loggedIn(h));
  assert.ok(!errorShown(h));
});

for (const st of [401, 403]) {
  test(`${st}: 名簿外の文言で止まる`, async () => {
    const h = load(() => resp(st, {}));
    await login(h);
    assert.ok(!loggedIn(h));
    assert.match(h.els.errorMessage.textContent, /このメールアドレスではログインできません/);
    assert.ok(loadingHidden(h));
  });
}

test('503: ログイン済みにせず再試行できる画面に戻す', async () => {
  const h = load(() => resp(503, {}));
  await login(h);
  assert.ok(!loggedIn(h));
  assert.ok(errorShown(h));
  assert.ok(loadingHidden(h));
});

test('fetch が返らない: 時間切れで中止して再試行できる', async () => {
  let aborted = false;
  const h = load((u, opt) => { opt.signal.addEventListener('abort', () => { aborted = true; }); return abortable(u, opt); });
  await login(h);
  assert.ok(aborted);
  assert.ok(!loggedIn(h));
  assert.ok(errorShown(h) && loadingHidden(h));
});

test('本文が返らない: 時間切れで止まる', async () => {
  const h = load(() => Promise.resolve({ status: 200, ok: true, json: never }));
  await login(h);
  assert.ok(!loggedIn(h));
  assert.ok(errorShown(h) && loadingHidden(h));
  assert.equal(h.store.get('ssa_session_token'), undefined);
});

test('時間切れの後に届いた成功はセッションを書かない', async () => {
  let release;
  const h = load(() => new Promise((r) => { release = r; }));
  await login(h);
  release({ status: 200, ok: true, json: () => Promise.resolve({ token: SESSION_NEW }) });
  await sleep(20);
  assert.equal(h.store.get('ssa_session_token'), undefined);
  assert.ok(!loggedIn(h));
});

test('既存セッションの更新が失敗しても元のセッションは残る', async () => {
  const h = load(() => resp(503, {}));
  h.store.set('ssa_session_token', SESSION_OLD);
  const res = await h.ctx.ssaExchange(SESSION_OLD);
  assert.equal(res.token, '');
  assert.equal(h.store.get('ssa_session_token'), SESSION_OLD);
});

test('ログアウト中に遅れて届いた交換は書き戻さない', async () => {
  let release;
  const h = load(() => new Promise((r) => { release = r; }));
  h.ctx.SSA_EXCHANGE_TIMEOUT_MS = 5000;
  h.ctx.handleCredentialResponse({ credential: GOOGLE });
  h.ctx.app.logout();
  release({ status: 200, ok: true, json: () => Promise.resolve({ token: SESSION_NEW }) });
  await sleep(20);
  assert.equal(h.store.get('ssa_session_token'), undefined);
  assert.ok(!loggedIn(h));
  assert.ok(!errorShown(h));
});

test('失敗の後の再試行は成功する / 古い交換は新しいログインを上書きしない', async () => {
  const pend = [];
  const h = load(() => new Promise((r) => pend.push(r)));
  h.ctx.SSA_EXCHANGE_TIMEOUT_MS = 5000;
  h.ctx.handleCredentialResponse({ credential: GOOGLE });   // 1 回目 (遅い)
  h.ctx.handleCredentialResponse({ credential: GOOGLE });   // 再試行
  pend[1]({ status: 200, ok: true, json: () => Promise.resolve({ token: SESSION_NEW }) });
  await sleep(10);
  pend[0]({ status: 200, ok: true, json: () => Promise.resolve({ token: SESSION_OLD }) });
  await sleep(10);
  assert.equal(h.store.get('ssa_session_token'), SESSION_NEW);
  assert.ok(loggedIn(h));
});

test('Google の credential / payload を console に出さない', async () => {
  const h = load(() => resp(200, { token: SESSION_NEW }));
  await login(h);
  assert.ok(!h.logs.some((l) => l.includes(GOOGLE) || l.includes('[object Object]')));
  assert.ok(!/console\.log\([^)]*(response|payload)\)/.test(SCRIPT));
});

// --- 認証初期化: WebUI iframe の load に依存せず、一度だけ起動する ---
test('初期化: DOM 読み込み中は DOMContentLoaded の once で起動し、window load には掛けない', async () => {
  const h = load(() => resp(200, {}), { readyState: 'loading' });
  assert.equal(h.scripts.length, 0, 'DOMContentLoaded 前は何も挿入しない');
  const l = h.docListeners.filter((x) => x.ev === 'DOMContentLoaded');
  assert.equal(l.length, 1);
  assert.equal(l[0].o?.once, true);
  assert.equal(h.ctx.onload, undefined, 'window.onload を使わない');
  l[0].fn();
  l[0].fn();   // 二重起動しても挿入は 1 回
  assert.equal(h.scripts.length, 1);
  assert.match(h.scripts[0].src, /accounts\.google\.com\/gsi\/client/);
});

test('初期化: DOM 準備済みなら直ちに GSI を挿入する', () => {
  const h = load(() => resp(200, {}), { readyState: 'interactive' });
  assert.equal(h.scripts.length, 1);
  assert.equal(h.docListeners.filter((x) => x.ev === 'DOMContentLoaded').length, 0);
});

test('GSI 読み込み待ちは独自 deadline で失敗し、再試行で新しい script を挿入できる', async () => {
  const h = load(() => resp(200, {}), { readyState: 'interactive' });
  h.ctx.SSA_GSI_LOAD_TIMEOUT_MS = 20;
  // 初回は既定 15s の timer なので、再試行側 (短い deadline) を検証する
  h.scripts[0].fire('error');
  await sleep(10);
  assert.ok(errorShown(h), '失敗でエラー画面');
  assert.equal(h.scripts[0].parentNode, null, '失敗した script は外れる');
  const p = h.ctx.loadGoogleSignInScript();
  assert.equal(h.scripts.length, 2);
  assert.strictEqual(h.ctx.loadGoogleSignInScript(), p, '読み込み中は二重挿入しない');
  await assert.rejects(p, /時間切れ/);
  assert.equal(h.scripts[1].parentNode, null);
});

test('GSI load で initialize が走る (二重初期化しない)', async () => {
  const h = load(() => resp(200, {}), { readyState: 'interactive' });
  let inits = 0;
  h.ctx.google = { accounts: { id: { initialize: () => { inits++; }, renderButton: () => {}, prompt: () => {} } } };
  h.scripts[0].fire('load');
  h.scripts[0].fire('load');
  await sleep(5);
  assert.equal(inits, 1);
});

test('既存: 生きた 30 日セッションなら showApp して Google を読まない / 期限切れは通さない', () => {
  const h = load(() => resp(503, {}), { readyState: 'interactive', storage: { ariel_email: 'u@example.invalid', ssa_session_token: SESSION_NEW } });
  assert.equal(h.scripts.length, 0);
  assert.equal(h.els.app.style.display, 'block');
  const expired = jwt({ iss: 'ssa', exp: later(-10) });
  const h2 = load(() => resp(503, {}), { readyState: 'interactive', storage: { ariel_email: 'u@example.invalid', ssa_session_token: expired } });
  assert.notEqual(h2.els.app?.style.display, 'block');
  assert.equal(h2.scripts.length, 1);
});

test('認証経路のログに email / credential を出さない', () => {
  const h = load(() => resp(200, { token: SESSION_NEW }), { readyState: 'interactive', storage: { ariel_email: 'secret@example.invalid', ssa_session_token: SESSION_NEW } });
  assert.ok(!h.logs.some((l) => l.includes('secret@example.invalid')));
});
