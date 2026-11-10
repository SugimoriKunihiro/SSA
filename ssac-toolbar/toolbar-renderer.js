// electron/toolbar-renderer.js
//
// toolbar.html 用の renderer スクリプト。window.ssacToolbar (toolbar-preload.cjs)
// 経由でだけ main プロセスと話す。

// 🔄 更新の欄 (SSA / CockPit のどちらでも見える所に 1 つだけ / 2026-09-24)
import { 更新の欄を繋ぐ } from './toolbar-update.js';
// 🧭 製品の切替 (ssa = SSAC / mao = MAO-Cockpit)。mao は内蔵画面を「MAO」と呼ぶ
//   (ひろくん 2026-10-05: mao では "SSA" の語を "MAO" に読み替える — "Web" ではない)。
import { isMaoBrand } from './brand-names.js';

const btn = document.getElementById('switch-btn');
const status = document.getElementById('status');

// 🧭 html の静的な既定文は ssa のまま (1 bit も変えない)。mao だけここで上書きする。
if (isMaoBrand()) {
  document.title = 'MAO-Cockpit';
  btn.textContent = 'CockPit ⇄ MAO';
}

function renderState(state) {
  if (!state) return;
  status.classList.remove('error');
  status.textContent = state.active === 'ssa'
    ? `表示中: ${isMaoBrand() ? 'MAO' : 'SSA'}`
    : '表示中: CockPit';
  // 🔴 表示中の面を body に出す。CSS がこれを見てバーの色を SSA 側に寄せる
  //   (バーが 2 本に見えないようにするため / 2026-09-18)。
  document.body.dataset.face = state.active === 'ssa' ? 'ssa' : 'cockpit';
}

function renderError(reason) {
  status.classList.add('error');
  status.textContent = `切り替えできません: ${reason}`;
}

btn.addEventListener('click', async () => {
  const result = await window.ssacToolbar.toggle();
  if (result && result.ok === false) {
    renderError(result.reason);
    return;
  }
  renderState(result);
});

window.ssacToolbar.onChanged((state) => renderState(state));
window.ssacToolbar.onError((reason) => renderError(reason));

window.ssacToolbar.getState().then((state) => renderState(state));

更新の欄を繋ぐ({ doc: document, api: window.ssacToolbar.update });
