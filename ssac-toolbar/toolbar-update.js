// electron/toolbar-update.js
//
// **「新しい SSAC があります」をツールバーに出す。** (2026-09-24 ひろくん
// 「SSA と Cockpit、どっちのモードでも帯が出るようにして。いま Cockpit で帯が出たわ」)
//
// ⚠️ 前は CockPit の画面の中にだけ出していた。SSAC は**起動すると SSA の画面が前に出る**ので、
//   「更新の帯が出ない」に見えた。ツールバーは**どちらのモードでも常に上に出ている**ので、ここに 1 つだけ出す。
// 🔴 ここは出すだけ・押すだけ。止まる物の確認・落とす・照らす・入れ替えは main (`update:apply`)。

/**
 * ツールバーの更新の欄を繋ぐ。🔴 テストから偽の document と口を渡せる。
 * @param {{doc: Document, api: {status, apply, on, onProgress}}} p
 */
export function 更新の欄を繋ぐ({ doc, api }) {
  const 欄 = doc.getElementById('update');
  const 文 = doc.getElementById('update-text');
  const 押す = doc.getElementById('update-btn');
  if (!欄 || !文 || !押す || !api) return null;
  let 今の版 = null; // 見つかっている新しい版 (帯の表示用)
  // 🔴 2026-10-11 ひろくん「更新でてこない」— 公開直後の新版を自動確認 (30 分おき) まで見逃す。
  //   更新が見つかっていない間は版の欄をクリックで「今すぐ確かめる」にする。
  //   古い toolbar-preload / 古い document (この要素が無い) でも動くよう optional chaining で素通りさせる。
  const 待機 = doc.getElementById('update-idle');
  let 手元の版 = null;

  const 出す = (v) => {
    if (!v?.version) return;
    今の版 = v.version;
    文.textContent = `🔄 v${v.version} があります`;
    文.title = v.札 || '';
    押す.disabled = false;
    押す.textContent = '再起動して更新';
    欄.hidden = false;
    if (待機) 待機.hidden = true;
  };

  押す.addEventListener('click', async () => {
    押す.disabled = true;
    押す.textContent = '更新しています…';
    const r = await api.apply();
    // 🔴 やめた / 失敗したら押せる状態に戻して理由を出す (黙って固まらない)
    if (!r?.ok) {
      押す.disabled = false;
      押す.textContent = '再起動して更新';
      if (r?.reason) 文.textContent = `🔴 ${r.reason}`;
    }
  });

  if (待機 && api.check) {
    待機.addEventListener('click', async () => {
      if (待機.disabled) return;
      待機.disabled = true;
      待機.textContent = '確かめています…';
      try {
        const r = await api.check();
        if (!r?.ok) 待機.textContent = `🔴 ${r?.reason || '確かめられません'}`;
        else if (r.新しい) 待機.textContent = `🔄 v${r.新しい} があります`;
        else 待機.textContent = `最新です (v${手元の版 ?? ''})`;
      } finally {
        // 🔴 帯 (欄) が出たらそちらに譲る — 待機ラベルは数秒だけ結果を見せたら元に戻す
        setTimeout(() => {
          待機.disabled = false;
          if (!欄.hidden) return;
          待機.textContent = 手元の版 ? `v${手元の版}` : '更新を確かめる';
        }, 4000);
      }
    });
  }

  api.on?.((v) => 出す(v));
  api.onProgress?.((p) => { if (p?.段階) 文.textContent = `🔄 v${p.version ?? 今の版} を${p.段階}…`; });
  // ⚠️ 起動した時点で既に見つかっていることもあるので 1 回聞く
  Promise.resolve(api.status?.()).then((s) => {
    手元の版 = s?.今の版 ?? null;
    if (待機 && 手元の版 && 欄.hidden) 待機.textContent = `v${手元の版}`;
    if (s?.新しい版) 出す(s.新しい版);
  }).catch(() => {});
  return { 出す };
}
