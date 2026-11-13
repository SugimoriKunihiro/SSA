# 実ブラウザ対照: 認証前の WebUI iframe 文書が保留でも Google SDK の挿入と初期化が始まる
# 実行: python packages/portal/test/browser_auth_init.py [index.html の path (対照用)]
# 🔴 Google / API / CDN / WebUI は全て localhost 上の route mock。本番へは一切出ない。偽 token も使わない (未ログイン状態)。
import http.server, os, socketserver, sys, threading, functools
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
target = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'index.html')
SERVE_DIR = os.path.dirname(target)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            with open(target, 'rb') as f:
                body = f.read()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().do_GET()

GSI = "window.__gsi={init:0,render:0};window.google={accounts:{id:{initialize:function(){window.__gsi.init++},renderButton:function(){window.__gsi.render++},prompt:function(){},disableAutoSelect:function(){}}}};"
# Vue の stub は本物と同じく、生成時に認証前 WebUI iframe を作る (これが保留されると window load が来ない)
VUE = ("window.Vue=function(o){window.__vue=o;var f=document.createElement('iframe');"
       "f.src='https://lxo7uvj8r0.execute-api.ap-northeast-1.amazonaws.com/';document.body.appendChild(f);};")
STUB = "/*stub*/"

def run(port):
    gsi_requests = 0
    held = []   # 保留した route を保持し、close 前に明示 abort する (close 時の CancelledError を出さない)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = None
        try:
            ctx = b.new_context()
            pg = ctx.new_page()

            def route(r):
                nonlocal gsi_requests
                u = r.request.url
                if u.startswith(f'http://127.0.0.1:{port}'):
                    return r.continue_()
                if 'accounts.google.com/gsi/client' in u:
                    gsi_requests += 1
                    return r.fulfill(status=200, content_type='application/javascript', body=GSI)
                if 'vue@' in u:
                    return r.fulfill(status=200, content_type='application/javascript', body=VUE)
                if 'execute-api' in u:
                    held.append(r)   # 応答を返さない = 認証前 WebUI iframe の文書が保留
                    return
                r.fulfill(status=200, content_type='application/javascript', body=STUB)

            pg.route('**/*', route)
            pg.goto(f'http://127.0.0.1:{port}/', wait_until='commit', timeout=20000)
            pg.wait_for_function('window.__gsi && window.__gsi.init >= 1', timeout=6000)
            init = pg.evaluate('window.__gsi.init')
            state = pg.evaluate('document.readyState')
            assert state != 'complete', 'iframe 保留の再現に失敗 (load が完了している)'
            return init, state, gsi_requests, len(held)
        finally:
            if ctx is not None:
                try:
                    for r in held:
                        try: r.abort()
                        except Exception: pass
                    ctx.pages[0].wait_for_timeout(100) if ctx.pages else None   # abort を処理させる
                except Exception:
                    pass
                try: ctx.close()
                except Exception: pass
            try: b.close()
            except Exception: pass

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=SERVE_DIR))
    port = srv.server_address[1]
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    rc = 0
    try:
        init, state, n, nheld = run(port)
        # 保留対照: WebUI iframe を保留したまま、GSI が 1 回だけ要求・初期化されること
        assert n == 1 and init == 1 and nheld >= 1, (n, init, nheld)
        print(f'PASS target={target} iframe=held({nheld}) readyState={state} gsi_requests={n} initialize_calls={init}')
    except Exception as e:
        print('FAIL', type(e).__name__, str(e)[:200]); rc = 1
    finally:
        srv.shutdown()
        srv.server_close()
        th.join(5)
    sys.exit(rc)
