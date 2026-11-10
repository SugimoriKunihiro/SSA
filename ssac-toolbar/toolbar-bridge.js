// SSACC 用の window.ssacToolbar の橋。SSAC の toolbar-preload.cjs と同じ口を、親ページ (App.jsx) との postMessage でつなぐ。
// 🔴 切替の判断は親ページ (App.jsx) が持つ。ここは「押した」「状態」を運ぶだけ。
(() => {
  const listeners = { changed: new Set(), error: new Set(), update: new Set() }
  let state = { active: 'ssa' }
  const pending = new Map()
  let seq = 0
  const ask = (kind, payload) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    window.parent.postMessage({ src: 'ssacc-toolbar', kind, id, payload }, '*')
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, reason: '親ページが応えません' }) } }, 4000)
  })
  window.addEventListener('message', (ev) => {
    const d = ev.data
    if (!d || d.src !== 'ssacc-parent') return
    if (d.kind === 'state') { state = d.payload; for (const cb of listeners.changed) cb(state) }
    if (d.kind === 'error') for (const cb of listeners.error) cb(String(d.payload))
    if (d.kind === 'reply' && pending.has(d.id)) { const r = pending.get(d.id); pending.delete(d.id); r(d.payload) }
  })
  window.ssacToolbar = {
    toggle: () => ask('toggle'),
    getState: () => ask('getState').then((r) => { if (r && r.active) state = r; return state }),
    onChanged: (cb) => { listeners.changed.add(cb); return () => listeners.changed.delete(cb) },
    onError: (cb) => { listeners.error.add(cb); return () => listeners.error.delete(cb) },
    update: {
      status: () => ask('update:status'),
      apply: () => ask('update:apply'),
      check: () => ask('update:check'),
      on: (cb) => { listeners.update.add(cb); return () => listeners.update.delete(cb) },
      onProgress: () => () => {},
    },
  }
  window.ssacBrand = 'ssa'
  window.parent.postMessage({ src: 'ssacc-toolbar', kind: 'ready' }, '*')
})()
