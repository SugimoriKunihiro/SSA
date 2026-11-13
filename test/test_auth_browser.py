"""Portal (index.html) の認証を実ブラウザで確かめる回帰試験 (playwright)。

実行例:
  python packages/portal/test/test_auth_browser.py
  python packages/portal/test/test_auth_browser.py --engine chromium --portal-url http://localhost:18769/index.html

--portal-url が localhost / 127.0.0.1 で何も待っていなければ、packages/portal を一時的に配信する。
Google / SSA API / 子 iframe は全部モック。CDN の script (Vue 等) は通常の証明書検証で先に取って fulfill する
(WebKit 環境の TLS 差の隔離であり、実配信の TLS 検査ではない)。それ以外は外へ出さない。
"""

import argparse
import base64
import http.server
import json
import re
import socket
import sys
import threading
import time
from functools import partial
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

PORTAL_DIR = Path(__file__).resolve().parents[1]
API_HOST = "lxo7uvj8r0.execute-api.ap-northeast-1.amazonaws.com"
CDN_HOSTS = ("code.jquery.com", "cdnjs.cloudflare.com", "stackpath.bootstrapcdn.com", "cdn.jsdelivr.net")
SCENARIOS = (200, 401, 403, 503, "empty", "pending", "body-pending")
# Google の mock。initialize / renderButton の回数を数える (認証初期化が一度だけ走ったかの測定用)
GSI_MOCK = (
    'window.__gsi={init:0,render:0};'
    'window.google={accounts:{id:{initialize(){window.__gsi.init++},'
    'renderButton(el){window.__gsi.render++;el.textContent="Google sign-in test boundary"},'
    'prompt(){},disableAutoSelect(){}}}};'
)


def fake_token(claims):
    return "test." + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=") + ".not-signed"


GOOGLE = fake_token({"iss": "accounts.google.com", "email": "probe@example.invalid", "exp": int(time.time()) + 3600})
SESSION = fake_token({"iss": "ssa", "sub": "probe", "exp": int(time.time()) + 2592000})


def start_server_if_needed(portal_url):
    u = urlparse(portal_url)
    if u.hostname not in ("localhost", "127.0.0.1") or not u.port:
        return None
    with socket.socket() as s:
        s.settimeout(0.5)
        if s.connect_ex((u.hostname, u.port)) == 0:
            return None
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(PORTAL_DIR))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer((u.hostname, u.port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def prefetch_cdn_scripts(p):
    # 製品 HTML の SRI は残るので、取れた本文が integrity と合わなければブラウザが拒否する。取れなければ明示失敗
    html = (PORTAL_DIR / "index.html").read_text(encoding="utf-8")
    urls = [u for u in re.findall(r'<script[^>]*\ssrc="([^"]+)"', html) if urlparse(u).hostname in CDN_HOSTS]
    assert urls, "index.html に CDN script が見つからない"
    api = p.request.new_context()
    bodies = {}
    try:
        for u in urls:
            try:
                r = api.get(u, timeout=30000)
            except Exception as e:  # noqa: BLE001
                raise AssertionError(f"CDN script を取得できない: {u} ({type(e).__name__})") from None
            assert r.ok, f"CDN script を取得できない: {u} (status {r.status})"
            bodies[u] = (r.body(), r.headers.get("content-type", "application/javascript"))
    finally:
        api.dispose()
    return bodies


def run_scenario(browser, engine, scenario, portal_url, cdn):
    portal_host = urlparse(portal_url).netloc
    context = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    mode = [scenario]
    calls, pending, errors, leaked = [], [], [], []

    def intercept(route):
        u = route.request.url
        p = urlparse(u)
        if p.netloc == portal_host:
            route.continue_()
        elif p.hostname == API_HOST and p.path.startswith("/api/auth/session"):
            calls.append(mode[0])
            if mode[0] == "pending":
                pending.append(route)
            elif mode[0] == 200:
                route.fulfill(status=200, json={"token": SESSION, "expires_in": 2592000})
            elif mode[0] == "empty":
                route.fulfill(status=200, body="", content_type="application/json")
            else:
                route.fulfill(status=mode[0], json={"detail": "simulated failure"})
        elif u in cdn:
            body, ctype = cdn[u]
            route.fulfill(status=200, body=body, content_type=ctype)
        elif u.startswith("https://accounts.google.com/gsi/client"):
            route.fulfill(content_type="application/javascript", body=GSI_MOCK)
        elif route.request.resource_type == "document":
            route.fulfill(content_type="text/html", body="<html><body>Isolated child frame</body></html>")
        elif p.path.endswith("nav-links.json"):
            route.fulfill(json={})
        else:
            if p.hostname == API_HOST or p.hostname.endswith("google.com"):
                leaked.append(p.hostname)
            route.fulfill(status=204, body="")

    context.route("**/*", intercept)
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:160]))
    page.goto(portal_url, wait_until="networkidle", timeout=60000)

    # 最初の未ログイン状態: ログイン画面が見え、loading-view は隠れている (ID 指定の display:flex に負けない)
    expect(page.locator("#login-view")).to_be_visible()
    expect(page.locator("#loading-view")).to_be_hidden()
    assert page.evaluate("getComputedStyle(document.getElementById('loading-view')).display") == "none"

    if scenario == "body-pending":
        page.evaluate(
            """() => {
              window.originalTestFetch = window.fetch;
              window.fetch = (u, opt) => String(u).endsWith('/auth/session')
                ? Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}), {status:200}))
                : window.originalTestFetch(u,opt);
            }"""
        )
    page.evaluate("(credential) => handleCredentialResponse({credential})", GOOGLE)
    if scenario == 200:
        expect(page.locator("#app")).to_be_visible(timeout=12000)
    else:
        expect(page.locator("#errorMessage")).to_be_visible(timeout=12000)
        expect(page.locator("#login-view")).to_be_visible()
        expect(page.locator("#loading-view")).to_be_hidden()
        expect(page.locator("#app")).to_be_hidden()
        assert page.evaluate("localStorage.getItem('ssa_session_token')") is None
        if scenario in (401, 403):
            expect(page.locator("#errorMessage")).to_contain_text("このメールアドレスではログインできません")
        else:
            expect(page.locator("#errorMessage")).to_contain_text("ログインに失敗しました")
        mode[0] = 200
        if scenario == "body-pending":
            page.evaluate("window.fetch = window.originalTestFetch")
        page.evaluate("(credential) => handleCredentialResponse({credential})", GOOGLE)
        expect(page.locator("#app")).to_be_visible(timeout=12000)
    assert page.evaluate("localStorage.getItem('ssa_session_token')") == SESSION
    expect(page.locator("#auth-page")).to_be_hidden()
    assert not errors, errors
    assert not leaked, leaked
    for route in pending:
        try:
            route.abort()
        except Exception:
            pass
    print(json.dumps({"engine": engine, "scenario": scenario, "result": "passed", "session_requests": len(calls)}), flush=True)
    context.close()


def run_iframe_held(browser, engine, portal_url, cdn):
    """認証前の WebUI iframe の document だけが保留でも、DOMContentLoaded 後に GSI の初期化とボタン描画が一度だけ走る。

    実 Vue (CDN 本文 / SRI そのまま) が実際に iframe を作る。window load は iframe 保留で来ないので readyState は interactive のまま。
    """
    portal_host = urlparse(portal_url).netloc
    context = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    held, leaked, errors, gsi_fetches = [], [], [], []
    page = None

    def intercept(route):
        u = route.request.url
        p = urlparse(u)
        if p.netloc == portal_host:
            route.continue_()
        elif p.hostname == API_HOST and route.request.resource_type == "document":
            held.append(route)   # 応答を返さない = 認証前 WebUI iframe の文書が保留
        elif p.hostname == API_HOST and p.path.startswith("/api/"):
            leaked.append(p.path)   # 未ログインで API は叩かれないはず (POST 漏れ検知)
            route.fulfill(status=204, body="")
        elif u in cdn:
            body, ctype = cdn[u]
            route.fulfill(status=200, body=body, content_type=ctype)
        elif u.startswith("https://accounts.google.com/gsi/client"):
            gsi_fetches.append(u)
            route.fulfill(content_type="application/javascript", body=GSI_MOCK)
        elif p.path.endswith("nav-links.json"):
            route.fulfill(json={})
        else:
            if p.hostname == API_HOST or p.hostname.endswith("google.com"):
                leaked.append(p.hostname)
            route.fulfill(status=204, body="")

    try:
        context.route("**/*", intercept)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:160]))
        page.goto(portal_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("window.__gsi && window.__gsi.render >= 1", timeout=10000)
        page.wait_for_function("window.app && document.querySelector('iframe[src*=\"execute-api\"]')", timeout=10000)
        deadline = time.time() + 5
        while not held and time.time() < deadline:
            page.wait_for_timeout(50)
        assert held, "WebUI iframe の document 要求が保留されていない (再現失敗)"
        state = page.evaluate("document.readyState")
        assert state == "interactive", f"readyState={state} (iframe 保留なのに load が完了している)"
        counts = page.evaluate("({init: window.__gsi.init, render: window.__gsi.render})")
        assert counts == {"init": 1, "render": 1}, counts
        assert len(gsi_fetches) == 1, gsi_fetches
        expect(page.locator("#googleSignInButton")).to_contain_text("Google sign-in test boundary")
        expect(page.locator("#login-view")).to_be_visible()
        assert page.evaluate("localStorage.getItem('ssa_session_token')") is None
        assert not errors, errors
        assert not leaked, leaked
        print(json.dumps({"engine": engine, "scenario": "iframe-held", "result": "passed", "readyState": state,
                          "gsi_init": counts["init"], "gsi_render": counts["render"], "held_requests": len(held)}), flush=True)
    finally:
        for route in held:
            try:
                route.abort()
            except Exception:
                pass
        try:
            if page is not None:
                page.wait_for_timeout(100)   # abort を処理させてから閉じる
        except Exception:
            pass
        try:
            context.close()
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal-url", default="http://127.0.0.1:18769/index.html")
    ap.add_argument("--engine", action="append", choices=("chromium", "webkit", "firefox"), help="複数指定可 (既定: chromium)")
    args = ap.parse_args()
    engines = args.engine or ["chromium"]
    srv = start_server_if_needed(args.portal_url)
    try:
        with sync_playwright() as p:
            cdn = prefetch_cdn_scripts(p)
            for engine in engines:
                browser = getattr(p, engine).launch(headless=True)
                try:
                    for scenario in SCENARIOS:
                        run_scenario(browser, engine, scenario, args.portal_url, cdn)
                    run_iframe_held(browser, engine, args.portal_url, cdn)
                finally:
                    browser.close()
    finally:
        if srv:
            srv.shutdown()
            srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
