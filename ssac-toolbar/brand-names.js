// renderer/brand-names.js
//
// 🧭 **renderer (ブラウザ側) の表示名** — ssa は九曜のペルソナ名のまま / mao は役職名だけ。
//
// `electron/brand.js` の `名簿` と同じ対応を**手で複製する** (2026-10-05)。
// renderer はブラウザで直接 `<script type="module">` として読まれるので、
// `electron/brand.js` (node の `fs` / `path` を import する) をそのまま import すると
// 実機の CockPit が起動時に `Cannot find module 'fs'` 相当で死ぬ。∴ ここは**ブラウザでも
// node のテストでも読める純関数**にする (node の組み込みは一切 import しない)。
//
// ⚠️ 対応表を変えたら `electron/brand.js` の `名簿` と**両方**直すこと
//   (`test/test_brand_names.mjs` が両方を照らす)。

const 名簿 = [
  { persona: 'えみ', role: 'Orchestrator' },
  { persona: 'ルナ', role: 'Researcher' },
  { persona: 'ヒナ', role: 'Ergonomist' },
  { persona: 'スイ', role: 'Analyst' },
  { persona: 'シノ', role: 'Developer' },
  { persona: 'アイ', role: 'Architect' },
  { persona: 'ミオ', role: 'Designer' },
  { persona: 'レイ', role: 'Refactor' },
  { persona: 'ルイ', role: 'Gatekeeper' },
  { persona: 'ユイ', role: 'Developer' },   // 退役した旧 Operator (古い記録の読み替え / Issue #86)
];

/**
 * 今の brand が mao か。
 *
 * 1. node で直接 import されたとき (試験) … `process.env.SSAC_BRAND`
 * 2. 実機の CockPit (ブラウザ) … `window.ssacBrand` (`electron/preload.cjs` が渡す)
 *
 * 🔴 **キャッシュしない** — 呼ぶたびに読む (`electron/brand.js` の `_忘れる()` と同じ向き /
 *   試験が env を変えてから読み直せるように)。
 */
export function isMaoBrand() {
  if (typeof process !== 'undefined' && process.env && process.env.SSAC_BRAND) {
    return process.env.SSAC_BRAND.trim().toLowerCase() === 'mao';
  }
  if (typeof window !== 'undefined' && window.ssacBrand) {
    return String(window.ssacBrand).trim().toLowerCase() === 'mao';
  }
  return false;
}

/** 表示名。mao なら役職名、ssa ならそのまま (今まで通り)。知らない名前はそのまま返す。 */
export function 名(who) {
  if (!isMaoBrand()) return who;
  const x = 名簿.find((r) => r.persona === who);
  return x ? x.role : who;
}

/** 「役 (ペルソナ)」の決まり文句。mao はペルソナの括弧を外す。 */
export function 役弁(role英, persona) {
  return isMaoBrand() ? role英 : `${role英} (${persona})`;
}

/** 🧭 九曜の紋 (絵文字)。`renderer/mission-view.js` の `PIPELINE` の `紋` と同じ 9 個 + 退役した旧 Operator の紋。 */
export const 紋たち = Object.freeze(['🌙', '🪻', '💧', '🛠️', '🔥', '☘️', '🌻', '🔎', '⛩️', '🧹']);

/**
 * 🧭 **画面に出す「自由な文」からペルソナの痕跡を外す** (mao のときだけ / Issue #31 R31-05)。
 *
 * `名()` は**決まった担当の欄**しか直せない。工程バーのホバーに出る「Jev の理由」のように
 * 姉妹が書いた自由な文には `ルナ 🌙 が確認済みなので…` がそのまま残り、mao にペルソナが漏れた
 * (2026-10-07 レイの検分 R31-05)。∴ 表示用の写しにだけ置換を当てる。
 *
 * 🔴 **原文は壊さない** — 置換するのは画面に出す写しだけ (記録・保存は素のまま)。
 * 🔴 **無差別な部分一致で消さない** — `アイデア` `レイアウト` `スイス` のように
 *   ペルソナ名がカタカナ語の中に埋まっている時は**触らない** (前後がカタカナなら置換しない)。
 *   ∴ `ルナが` (ひらがなが続く) や `ルナ 🌙` は直すが、普通の言葉は壊さない。
 *
 * @param {string} 文
 * @returns {string} mao なら直した写し / ssa なら 1 文字も変えない
 */
export function 文の名を直す(文) {
  const s = String(文 ?? '');
  if (!s || !isMaoBrand()) return s;                   // 🔴 ssa は素通し (1 bit も変えない)
  const カナ = 'ァ-ヶーｦ-ﾟ';
  const 紋の枝 = 紋たち.join('|');
  let 出 = s;
  for (const { persona, role } of 名簿) {
    // 「ペルソナ名 (+ 続く紋)」→ 役職名。前後がカタカナなら普通の語なので触らない
    出 = 出.replace(
      new RegExp(`(^|[^${カナ}])${persona}(?:[ \\t]*(?:${紋の枝}))?(?![${カナ}])`, 'g'),
      (_m, 前) => `${前}${role}`,
    );
  }
  // 残った紋 (担当名から離れて置かれた物) と brand 語を外す
  for (const 紋 of 紋たち) 出 = 出.split(紋).join('');
  出 = 出.split('九曜').join('');
  // 🔴 何も当たらなかったら**1 文字も触らない** (普通の文の空白・体裁を壊さない)。
  //   直した時だけ、抜いた跡の二重空白と行末の空白を畳む (改行は残す)
  if (出 === s) return s;
  return 出.replace(/[ \t　]{2,}/g, ' ').replace(/[ \t　]+$/gm, '');
}

/**
 * 🧭 **声の対話が出る brand か。** `electron/brand.js` の `BRANDS.*.voice` と同じ対応
 * (`test/test_brand_ui.mjs` が一致を検査する)。voice-panel.js がボタン・欄を
 * 差し込むかどうかの判定に使う (2026-10-05)。
 * 🧭 mao も声あり (2026-10-05 ひろくん) — 声はサーバ経由 (mao-core の azure-proxy → gpt-live-1、
 *   考えるのは Hermes) なので PC に鍵は要らない。
 */
export const 声が出る = Object.freeze({ ssa: true, mao: true });
export function voiceEnabled() {
  return 声が出る[isMaoBrand() ? 'mao' : 'ssa'] === true;
}
