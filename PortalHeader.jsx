import { useState, useEffect, useRef } from 'react'
import navLinks from './nav-links.json'

// Portal (packages/portal/index.html) の #nav-hover-bar を React で pixel パリティ再現。
// リンクデータは packages/portal/nav-links.json (SSOT)。Portal で JSON を書き換えたら
// このヘッダーにも自動反映される (ビルド時 import)。
//
// スタイル移植元:
//   #nav-hover-bar         → 背景 #495057 (nav 本体) / #212529 は非表示化領域
//   .navbar-brand          → font-size 1.2rem / weight 700 / white / text-shadow
//   .nav-link              → padding .2rem .5rem / font-size .8rem / weight 600 / white
//   .dropdown-menu         → 背景 #495057 / border #6c757d / shadow
//   .dropdown-item         → white / font-size .8rem / hover #6c757d
//   .user-email            → font-size .8rem / max-width 200px / ellipsis
//   .action-btn            → 背景 rgba(255,255,255,0.2) / padding 2px 8px / font-size .75rem
//
// Portal は Bootstrap 4 navbar-expand-lg (992px 未満で collapse=ハンバーガー) を使うので
// React 側も 992px を breakpoint に。狭幅ではドロップダウン開くと縦積みで下に展開。

const CATEGORIES = [
  { key: 'knowledges', label: 'Knowledge' },
  { key: 'learnings',  label: 'Learning'  },
  { key: 'drives',     label: 'Drive'     },
  { key: 'gsuites',    label: 'Google'    },
  { key: 'tools',      label: 'App'       },
  { key: 'its',        label: 'IT'        },
  { key: 'tvs',        label: 'Media'     },
  { key: 'prvs',       label: 'SNS/Private' },
]

const BREAKPOINT = 992 // Bootstrap 4 lg breakpoint

// ブラウザで Portal ページの中に埋め込まれて動いている時は、Portal 自身のヘッダーが
// すでに画面上部に出ている。その時こちらも出すとバーが2本並ぶので、描画しない。
// iPhone アプリは Portal を経由しないので、こちらのヘッダーが表示される。
function isEmbeddedInPortal() {
  try {
    return typeof window !== 'undefined' && window.self !== window.top
  } catch {
    return true
  }
}

export default function PortalHeader() {
  const [openKey, setOpenKey] = useState(null)
  const [collapseOpen, setCollapseOpen] = useState(false) // ハンバーガー展開状態
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < BREAKPOINT)
  const [userEmail, setUserEmail] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    try {
      const email = localStorage.getItem('ariel_email')
      if (email) setUserEmail(email)
    } catch { /* noop */ }
  }, [])

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpenKey(null)
        setCollapseOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Portal ページ内 (ブラウザ) では Portal 側のヘッダーに任せて何も描画しない
  if (isEmbeddedInPortal()) return null

  const toggle = (key) => setOpenKey(prev => prev === key ? null : key)

  const handleLogout = () => {
    try {
      if (window.google?.accounts?.id?.disableAutoSelect) {
        window.google.accounts.id.disableAutoSelect()
      }
    } catch { /* noop */ }
    try {
      localStorage.removeItem('ariel_auth_token')
      localStorage.removeItem('ariel_email')
    } catch { /* noop */ }
    window.location.reload()
  }

  const brandStyle = {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#ffffff',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
    lineHeight: 1,
    margin: 0,
    padding: 0,
    cursor: 'default',
    transition: 'all 0.2s ease',
  }

  const navLinkStyle = (isOpen) => ({
    padding: '0.2rem 0.5rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#ffffff',
    background: isOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  })

  const dropdownMenuStyle = (positioned) => ({
    position: positioned ? 'absolute' : 'static',
    top: positioned ? '100%' : undefined,
    left: positioned ? 0 : undefined,
    marginTop: positioned ? '2px' : '2px',
    marginLeft: positioned ? 0 : '8px',
    background: '#495057',
    border: '1px solid #6c757d',
    borderRadius: '4px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
    minWidth: '10rem',
    padding: '0.5rem 0',
    zIndex: 1000,
  })

  const dropdownItemStyle = {
    display: 'block',
    padding: '0.3rem 0.75rem',
    color: '#ffffff',
    textDecoration: 'none',
    fontSize: '0.8rem',
    transition: 'background-color 0.2s ease',
    whiteSpace: 'nowrap',
  }

  const actionBtnStyle = {
    background: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    border: 'none',
    padding: '2px 8px',
    marginLeft: '5px',
    borderRadius: '4px',
    fontSize: '0.75rem',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  }

  const userEmailStyle = {
    marginRight: '10px',
    fontSize: isNarrow ? (typeof window !== 'undefined' && window.innerWidth < 576 ? '0.65rem' : '0.7rem') : '0.8rem',
    maxWidth: isNarrow ? (typeof window !== 'undefined' && window.innerWidth < 576 ? '120px' : '150px') : '200px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#ffffff',
  }

  const renderCategoryItems = () => CATEGORIES.map(cat => {
    const items = navLinks[cat.key] || []
    const isOpen = openKey === cat.key
    return (
      <li key={cat.key} style={{ position: 'relative', listStyle: 'none' }}>
        <button
          onClick={() => toggle(cat.key)}
          style={navLinkStyle(isOpen)}
          onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
          onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = 'transparent' }}
        >
          {cat.label}<span style={{ fontSize: '0.6rem', opacity: 0.8 }}>▼</span>
        </button>
        {isOpen && (
          <div style={dropdownMenuStyle(!isNarrow)}>
            {items.map(item => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { setOpenKey(null); setCollapseOpen(false) }}
                style={dropdownItemStyle}
                onMouseEnter={(e) => e.currentTarget.style.background = '#6c757d'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {item.name}
              </a>
            ))}
          </div>
        )}
      </li>
    )
  })

  const renderUserInfo = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      marginLeft: isNarrow ? 0 : 'auto',
      marginRight: '10px',
      width: isNarrow ? '100%' : undefined,
      justifyContent: isNarrow ? 'space-between' : undefined,
      padding: isNarrow ? '4px 10px' : 0,
    }}>
      {userEmail && <span style={userEmailStyle}>{userEmail}</span>}
      <button
        onClick={handleLogout}
        style={actionBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
      >
        ログアウト
      </button>
    </div>
  )

  return (
    <nav ref={wrapRef} style={{
      background: '#495057',
      color: 'white',
      padding: '0.1rem 0.5rem',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.1rem)',
      display: 'flex',
      flexDirection: isNarrow ? 'column' : 'row',
      alignItems: isNarrow ? 'stretch' : 'center',
      flexShrink: 0,
    }}>
      {/* SYLPHEED ブランド + toggler (狭幅時) の行 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: isNarrow ? '0.5rem 0' : 0,
      }}>
        <h3 style={brandStyle}>SYLPHEED</h3>
        {isNarrow && (
          <button
            onClick={() => { setCollapseOpen(o => !o); setOpenKey(null) }}
            aria-label="Toggle navigation"
            style={{
              marginLeft: 'auto',
              padding: '0.1rem 0.5rem',
              background: 'transparent',
              color: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ≡
          </button>
        )}
      </div>

      {/* nav リスト + user info (広幅は常時表示、狭幅は toggler で開閉) */}
      {(!isNarrow || collapseOpen) && (
        <div style={{
          display: 'flex',
          flexDirection: isNarrow ? 'column' : 'row',
          alignItems: isNarrow ? 'stretch' : 'center',
          flex: 1,
          gap: isNarrow ? '2px' : 0,
          padding: isNarrow ? '4px 0' : 0,
          background: isNarrow ? '#212529' : 'transparent',
        }}>
          <ul style={{
            display: 'flex',
            flexDirection: isNarrow ? 'column' : 'row',
            gap: isNarrow ? '2px' : '2px',
            listStyle: 'none',
            margin: 0,
            padding: isNarrow ? '0 10px' : 0,
            flex: isNarrow ? undefined : 1,
          }}>
            {renderCategoryItems()}
          </ul>
          {renderUserInfo()}
        </div>
      )}
    </nav>
  )
}
