#!/usr/bin/env python3
"""Comprehensive 7-Gate E2E, Visual, Responsive, Persistence, Leak & Real CDP Touch Suite
for eko Beta Test (/tmp/roblox-eko-island).
"""

import asyncio
import base64
import functools
import http.server
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

from PIL import Image
import websockets

ROOT = Path('/tmp/roblox-eko-island')
CAP_DIR = ROOT / 'tests' / 'captures'
PORT = 8862
CDP_PORT = 9262
CHROME_PROFILE = '/tmp/chrome_rbx_eko'
URL = f'http://127.0.0.1:{PORT}/index.html'

CJK_RE = re.compile(r'[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]')
CDN_RE = re.compile(r'(https?://|unpkg\.com|jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic)', re.IGNORECASE)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    bad_requests = []

    def log_message(self, fmt, *args):
        pass

    def send_response(self, code, message=None):
        if code >= 400:
            QuietHandler.bad_requests.append((code, self.path))
        super().send_response(code, message)


def start_http_server():
    QuietHandler.bad_requests = []
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def start_chrome():
    shutil.rmtree(CHROME_PROFILE, ignore_errors=True)
    chrome_home = os.path.join(CHROME_PROFILE, 'home')
    os.makedirs(os.path.join(chrome_home, '.config'), exist_ok=True)
    os.makedirs(os.path.join(chrome_home, '.cache'), exist_ok=True)
    chrome_env = {
        'PATH': '/usr/local/bin:/usr/bin:/bin',
        'HOME': chrome_home,
        'TMPDIR': CHROME_PROFILE,
        'XDG_CONFIG_HOME': os.path.join(chrome_home, '.config'),
        'XDG_CACHE_HOME': os.path.join(chrome_home, '.cache'),
        'LANG': 'en_US.UTF-8',
    }
    cmd = [
        '/usr/bin/google-chrome',
        '--headless=new',
        '--ozone-platform=headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-proxy-server',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--remote-allow-origins=*',
        f'--user-data-dir={CHROME_PROFILE}',
        f'--remote-debugging-port={CDP_PORT}',
        '--window-size=1280,800',
        'about:blank',
    ]
    proc = subprocess.Popen(cmd, env=chrome_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 15.0
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.time() < deadline:
        try:
            with opener.open(f'http://127.0.0.1:{CDP_PORT}/json/list', timeout=2) as r:
                pages = json.loads(r.read().decode())
                for p in pages:
                    if p.get('type') == 'page' and p.get('webSocketDebuggerUrl'):
                        return proc, p['webSocketDebuggerUrl']
        except Exception:
            time.sleep(0.15)
    proc.kill()
    raise RuntimeError('Chrome CDP failed to start')


class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self._id = 0
        self._pending = {}
        self.console_errors = []
        self.js_exceptions = []
        self.failed_requests = []
        self._reader_task = asyncio.create_task(self._reader())

    async def _reader(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if 'id' in msg:
                    fut = self._pending.pop(msg['id'], None)
                    if fut and not fut.done():
                        if 'error' in msg:
                            fut.set_exception(RuntimeError(str(msg['error'])))
                        else:
                            fut.set_result(msg.get('result', {}))
                else:
                    method = msg.get('method', '')
                    params = msg.get('params', {})
                    if method == 'Runtime.exceptionThrown':
                        ex = params.get('exceptionDetails', {})
                        txt = ex.get('text', '') + ' ' + str(ex.get('exception', {}).get('description', ''))
                        self.js_exceptions.append(txt.strip())
                    elif method == 'Runtime.consoleAPICalled':
                        if params.get('type') == 'error':
                            args = ' '.join(str(a.get('value', a.get('description', ''))) for a in params.get('args', []))
                            self.console_errors.append(args)
                    elif method == 'Log.entryAdded':
                        ent = params.get('entry', {})
                        if ent.get('level') == 'error':
                            self.console_errors.append(ent.get('text', ''))
                    elif method == 'Network.loadingFailed':
                        self.failed_requests.append(params.get('errorText', 'failed'))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def send(self, method, params=None):
        self._id += 1
        cid = self._id
        fut = asyncio.get_running_loop().create_future()
        self._pending[cid] = fut
        await self.ws.send(json.dumps({'id': cid, 'method': method, 'params': params or {}}))
        return await asyncio.wait_for(fut, timeout=20.0)

    async def eval(self, expr):
        res = await self.send('Runtime.evaluate', {
            'expression': expr,
            'returnByValue': True,
            'awaitPromise': True,
        })
        if 'exceptionDetails' in res:
            raise RuntimeError(f"Eval exception: {res['exceptionDetails']}")
        return res.get('result', {}).get('value')

    async def touch(self, kind, points):
        """Dispatches a real Chrome CDP Input.dispatchTouchEvent."""
        await self.send('Input.dispatchTouchEvent', {
            'type': kind,
            'touchPoints': [
                {
                    'x': round(p['x']),
                    'y': round(p['y']),
                    'id': int(p.get('id', 1)),
                    'radiusX': 8,
                    'radiusY': 8,
                    'force': 1.0,
                }
                for p in points
            ],
        })

    async def screenshot(self, out_path, fmt='png', quality=92):
        params = {'format': fmt}
        if fmt == 'jpeg':
            params['quality'] = quality
        res = await self.send('Page.captureScreenshot', params)
        raw = base64.b64decode(res['data'])
        Path(out_path).write_bytes(raw)
        return out_path

    async def set_viewport(self, w, h, mobile=False, touch=None):
        use_touch = mobile if touch is None else touch
        await self.send('Emulation.setDeviceMetricsOverride', {
            'width': w,
            'height': h,
            'deviceScaleFactor': 1,
            'mobile': mobile,
        })
        if use_touch:
            await self.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
        else:
            await self.send('Emulation.setTouchEmulationEnabled', {'enabled': False})
        await self.eval('''(() => {
            const g = window.__ROBLOX_EKO__._game;
            if (!''' + ('true' if use_touch else 'false') + ''') {
                g.ui._seenTouchPointer = false;
                g.ui.touchMode = 'auto';
            }
            window.dispatchEvent(new Event("resize"));
            window.__ROBLOX_EKO__.render();
        })()''')
        await asyncio.sleep(0.12)

    async def close(self):
        self._reader_task.cancel()


def gate_1_static_forensics():
    print('[G1] Static Forensics (0 CJK, 0 speechSynthesis, 0 renderer.compile, 0 CDN, 0 /google/)...')
    files = [ROOT / 'index.html', ROOT / 'css' / 'style.css'] + sorted((ROOT / 'src').glob('*.js'))
    assert len(files) >= 10, f'Expected >=10 source files, got {len(files)}'
    for f in files:
        txt = f.read_text(encoding='utf-8')
        assert not CJK_RE.search(txt), f'CJK found in {f}'
        assert 'speechSynthesis' not in txt, f'speechSynthesis found in {f}'
        assert 'renderer.compile' not in txt, f'renderer.compile found in {f}'
        assert not CDN_RE.search(txt), f'CDN/URL found in {f}: {CDN_RE.search(txt).group(0)}'
        assert '/google/' not in txt, f'/google/ string found in {f}'
    assert (ROOT / 'vendor' / 'three.module.min.js').exists(), 'Missing vendored Three.js r170'
    print(f'  PASS ({len(files)} source files verified clean)')


async def wait_ready(cdp):
    for _ in range(80):
        if cdp.js_exceptions or cdp.console_errors:
            raise RuntimeError(
                f'Boot error: js={cdp.js_exceptions} console={cdp.console_errors} net={cdp.failed_requests} http={QuietHandler.bad_requests}'
            )
        ok = await cdp.eval('Boolean(window.__ROBLOX_EKO__ && window.__ROBLOX_EKO__.getState)')
        if ok:
            return
        await asyncio.sleep(0.1)
    raise RuntimeError(f'window.__ROBLOX_EKO__ did not initialize')


async def run_all_gates():
    gate_1_static_forensics()
    os.makedirs(CAP_DIR, exist_ok=True)
    server = start_http_server()
    proc, ws_url = start_chrome()

    try:
        async with websockets.connect(ws_url, max_size=20 * 1024 * 1024) as ws:
            cdp = CDPClient(ws)
            await cdp.send('Runtime.enable')
            await cdp.send('Log.enable')
            await cdp.send('Page.enable')
            await cdp.send('Network.enable')

            # ---------------- G2: Boot, API Surface, Materials & Draw Calls ----------------
            print('[G2] Boot, API Surface, Material Compliance & Draw Calls...')
            await cdp.send('Page.navigate', {'url': URL})
            await wait_ready(cdp)
            await cdp.eval('window.__ROBLOX_EKO__.resetSave(); window.__ROBLOX_EKO__.step(1/60, 12); window.__ROBLOX_EKO__.render();')
            await asyncio.sleep(0.1)

            missing = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                const req = [
                    'getState','step','render','selectTool','tapHex','getHex',
                    'openRadialForHex','radialAction','closeRadial','loadPreset',
                    'setMode','toggleMode','setInput','queueJump','triggerEmote',
                    'setCameraOrbit','setCameraZoom','setCameraFocus','setSetting',
                    'undo','clearIsland','resetSave','projectHexToScreen','audio','rendererInfo'
                ];
                return req.filter(k => !(k in a));
            })()''')
            assert missing == [], f'Missing __ROBLOX_EKO__ keys: {missing}'

            mat_audit = await cdp.eval('''(() => {
                const scene = window.__ROBLOX_EKO__._scene;
                let maxMetal = 0, minRough = 1, count = 0;
                const bad = [];
                scene.traverse(o => {
                    if (!o.isMesh || !o.material) return;
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    for (const m of mats) {
                        if (!m.isMeshStandardMaterial) continue;
                        count++;
                        if (m.metalness > maxMetal) maxMetal = m.metalness;
                        if (m.roughness < minRough) minRough = m.roughness;
                        if (m.metalness > 0.2201 || m.roughness < 0.2799) {
                            bad.push({ name: o.name, metal: m.metalness, rough: m.roughness });
                        }
                    }
                });
                return { count, maxMetal, minRough, bad };
            })()''')
            assert mat_audit['bad'] == [], f'Material violations: {mat_audit["bad"]}'

            st0 = await cdp.eval('window.__ROBLOX_EKO__.getState()')
            assert st0['drawCalls'] <= 85, f'Draw calls > 85: {st0["drawCalls"]}'
            assert abs(st0['cameraRotZ']) < 1e-4, f'Camera roll non-zero: {st0["cameraRotZ"]}'
            assert st0['landCount'] >= 50 and st0['propCount'] >= 20 and st0['pondCount'] >= 3, f'Preset 1 incomplete: {st0}'
            print(f"  PASS (mats={mat_audit['count']}, maxMetal={mat_audit['maxMetal']:.2f}, minRough={mat_audit['minRough']:.2f}, calls={st0['drawCalls']}, tiles={st0['tileCount']})")

            # Capture crisp 1280x800 Hero Screenshot on Preset 1 (Starter Meadow Cove + Cyan Sky & Fluffy Clouds!)
            await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a._game.ui.dismissToast();
                a.setCameraOrbit(0.68, 0.34);
                a.setCameraZoom(0.98);
                a.step(1/60, 12);
                a.render();
            })()''')
            await asyncio.sleep(0.08)
            hero_png = CAP_DIR / 'hero_1280x800.png'
            await cdp.screenshot(hero_png)
            Image.open(hero_png).convert('RGB').save(ROOT / 'screenshot.jpg', quality=92)

            # ---------------- G3: Full Gameplay Loop ----------------
            print('[G3] Full Gameplay Loop (Expand Ocean -> Raise Cliff -> Carve Pond -> Oak & Cottage -> Radial Rotate/Recolor/Duplicate/Delete -> Preset 2 -> Walk Mode Hill & Jump -> Build Mode)...')
            g3 = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a.resetSave();
                const s0 = a.getState();

                // 1. Expand ocean hex (4, 0) with Hex Land
                a.selectTool('land');
                const beforeOcean = a.getHex(4, 0).tile;
                a.tapHex(4, 0);
                const afterLand = a.getHex(4, 0).tile;

                // 2. Raise cliff twice at (4, 0) -> elevation 3
                a.selectTool('raise');
                a.tapHex(4, 0);
                a.tapHex(4, 0);
                const afterRaise = a.getHex(4, 0).tile;

                // 3. Expand (3, 1) and carve freshwater pond
                a.selectTool('land');
                a.tapHex(3, 1);
                a.selectTool('pond');
                a.tapHex(3, 1);
                const afterPond = a.getHex(3, 1).tile;

                // 4. Place Oak tree at (4, -1) and Timber Cottage at (4, 0)
                a.selectTool('land');
                a.tapHex(4, -1);
                a.selectTool('oak');
                a.tapHex(4, -1);
                const oakHex = a.getHex(4, -1).prop;

                a.selectTool('cottage');
                a.tapHex(4, 0);
                const cotBefore = a.getHex(4, 0).prop;

                // 5. Open Radial Menu on Timber Cottage -> Rotate -> Recolor -> Duplicate -> Delete
                a.openRadialForHex(4, 0);
                const radVis = !document.getElementById('radial-menu').classList.contains('hidden');
                const rot0 = a.getHex(4, 0).prop.rotDeg;
                const col0 = a.getHex(4, 0).prop.colorIdx;
                a.radialAction('rotate');
                const rot1 = a.getHex(4, 0).prop.rotDeg;
                a.radialAction('recolor');
                const col1 = a.getHex(4, 0).prop.colorIdx;
                const propsBeforeDup = a.getState().propCount;
                a.radialAction('duplicate');
                const propsAfterDup = a.getState().propCount;
                a.radialAction('delete');
                const propsAfterDel = a.getState().propCount;
                const radHiddenAfterDel = document.getElementById('radial-menu').classList.contains('hidden');

                // Undo restores deleted duplicate
                a.undo();
                const propsAfterUndo = a.getState().propCount;

                // 6. Load Preset 2 (Twin Cliff Lighthouse)
                a.loadPreset(2);
                const p2 = a.getState();

                // 7. Toggle into 3rd-Person R6 Walk Mode -> walk up hex hill & jump!
                a.toggleMode();
                a.step(1/60, 4);
                const w0 = a.getState();
                // Place dummy cleanly on bridge (0, 0) facing west toward the rising hill (-1,0 -> -2,0)
                const g = a._game;
                g.player.x = 0; g.player.z = 0; g.player.y = 1.05; g.player.grounded = true;
                a.setCameraOrbit(0, 0.42);
                a.setInput(-1, 0); // Walk west (-X) up tiered slope!
                a.step(1/60, 75);
                const wClimbed = a.getState();
                a.setInput(0, 0);
                // Jump!
                a.queueJump();
                a.step(1/60, 12);
                const wAirY = a.getState().player.y;
                const wAirGrounded = a.getState().player.grounded;
                a.step(1/60, 50);
                const wLanded = a.getState();
                a.triggerEmote();
                a.step(1/60, 10);
                const wEmote = a.getState().player.emotes;
                const walkCalls = a.rendererInfo.calls;

                // 8. Toggle back to Build Mode
                a.toggleMode();
                const backMode = a.getState().mode;

                return {
                    beforeOcean, afterLand, afterRaise, afterPond, oakHex, cotBefore,
                    radVis, rot0, rot1, col0, col1,
                    propsBeforeDup, propsAfterDup, propsAfterDel, radHiddenAfterDel, propsAfterUndo,
                    p2Preset: p2.activePresetId, p2MaxEl: p2.maxElevation,
                    w0Mode: w0.mode, wClimbedX: wClimbed.player.x, wClimbedY: wClimbed.player.y,
                    wAirY, wAirGrounded, wLandedGrounded: wLanded.player.grounded,
                    wJumps: wLanded.player.jumps, wEmote, walkCalls, backMode
                };
            })()''')
            assert g3['beforeOcean'] is None and g3['afterLand']['elevation'] == 1, f'Ocean expand failed: {g3}'
            assert g3['afterRaise']['elevation'] == 3, f'Cliff raise failed: {g3}'
            assert g3['afterPond']['type'] == 'water', f'Pond carve failed: {g3}'
            assert g3['oakHex']['type'] == 'oak' and g3['cotBefore']['type'] == 'cottage', f'Prop placement failed: {g3}'
            assert g3['radVis'] is True and g3['rot1'] == (g3['rot0'] + 60) % 360, f'Radial rotate failed: {g3}'
            assert g3['col1'] == (g3['col0'] + 1) % 5, f'Radial recolor failed: {g3}'
            assert g3['propsAfterDup'] == g3['propsBeforeDup'] + 1, f'Radial duplicate failed: {g3}'
            assert g3['propsAfterDel'] == g3['propsAfterDup'] - 1 and g3['radHiddenAfterDel'] is True, f'Radial delete failed: {g3}'
            assert g3['propsAfterUndo'] == g3['propsAfterDup'], f'Undo failed: {g3}'
            assert g3['p2Preset'] == 2 and g3['p2MaxEl'] == 5, f'Preset 2 load failed: {g3}'
            assert g3['w0Mode'] == 'walk' and g3['wClimbedX'] < -1.5 and g3['wClimbedY'] > 1.8, f'Walk up hill failed: {g3}'
            assert g3['wAirGrounded'] is False and g3['wAirY'] > g3['wClimbedY'] + 0.6, f'Walk jump failed: {g3}'
            assert g3['wLandedGrounded'] is True and g3['wJumps'] >= 1 and g3['wEmote'] >= 1, f'Walk land/emote failed: {g3}'
            assert g3['walkCalls'] <= 85 and g3['backMode'] == 'build', f'Walk calls/return failed: {g3}'
            print(f"  PASS (elev 1->3, pond carved, radial rot/col/dup/del+undo OK, Preset 2 maxEl=5, Walk climbed y={g3['wClimbedY']:.2f}, airY={g3['wAirY']:.2f}, walkCalls={g3['walkCalls']})")

            # ---------------- G4: Persistence Across Reload ----------------
            print('[G4] Persistence Across Page Reload (localStorage roblox_eko_island_save)...')
            await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a.resetSave();
                a.setSetting('rotationSnap', 15);
                a.selectTool('land');
                a.tapHex(5, 0);
                a.selectTool('cottage');
                a.tapHex(5, 0);
                a.openRadialForHex(5, 0);
                a.radialAction('recolor');
                a.radialAction('recolor');
                a.closeRadial();
            })()''')
            saved_before = await cdp.eval('''(() => ({
                hex: window.__ROBLOX_EKO__.getHex(5, 0),
                snap: window.__ROBLOX_EKO__.getState().settings.rotationSnap,
                tileCount: window.__ROBLOX_EKO__.getState().tileCount
            }))()''')
            await cdp.send('Page.reload', {'ignoreCache': False})
            await wait_ready(cdp)
            saved_after = await cdp.eval('''(() => ({
                hex: window.__ROBLOX_EKO__.getHex(5, 0),
                snap: window.__ROBLOX_EKO__.getState().settings.rotationSnap,
                tileCount: window.__ROBLOX_EKO__.getState().tileCount
            }))()''')
            assert saved_after == saved_before, f'Persistence mismatch: before={saved_before} after={saved_after}'
            print(f"  PASS (tileCount={saved_after['tileCount']}, cottage colorIdx={saved_after['hex']['prop']['colorIdx']}, snap={saved_after['snap']}° persisted)")

            # ---------------- G5: 2,000-Frame Leak Soak ----------------
            print('[G5] 2,000-Frame GPU & DOM Leak Soak...')
            soak = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                // Warm up both Build and Walk meshes so one-time lazy GPU buffer upload completes before soak baseline
                a.resetSave();
                a.setMode('walk');
                a.queueJump();
                a.step(1/60, 4);
                a.render();
                a._game.world.spawnSplash(0, 1, 0);
                a.setMode('build');
                a.step(1/60, 6);
                a.render();
                const start = {
                    geos: a.rendererInfo.geometries,
                    texs: a.rendererInfo.textures,
                    dom: document.querySelectorAll('*').length,
                };
                for (let batch = 0; batch < 20; batch++) {
                    a.selectTool(batch % 2 === 0 ? 'cottage' : 'oak');
                    a.tapHex(0, 0);
                    a.selectTool('lower');
                    a.tapHex(0, 0);
                    if (batch === 10) a.setMode('walk');
                    if (batch >= 10 && batch < 15) {
                        a.setInput(0.5, -0.5);
                        if (batch === 12) a.queueJump();
                        if (batch === 13) a.triggerEmote();
                    }
                    if (batch === 15) {
                        a.setInput(0, 0);
                        a.setMode('build');
                        a.loadPreset((batch % 7) + 1);
                    }
                    a.step(1/60, 100);
                    a.render();
                }
                const end = {
                    geos: a.rendererInfo.geometries,
                    texs: a.rendererInfo.textures,
                    dom: document.querySelectorAll('*').length,
                    calls: a.rendererInfo.calls,
                };
                return { start, end };
            })()''')
            assert soak['end']['geos'] == soak['start']['geos'], f'Geometry leak: {soak}'
            assert soak['end']['texs'] == soak['start']['texs'], f'Texture leak: {soak}'
            assert abs(soak['end']['dom'] - soak['start']['dom']) <= 2, f'DOM leak: {soak}'
            assert soak['end']['calls'] <= 85, f'Post-soak drawCalls > 85: {soak}'
            print(f"  PASS (2000 frames: geos={soak['start']['geos']}->{soak['end']['geos']}, texs={soak['start']['texs']}->{soak['end']['texs']}, dom={soak['start']['dom']}->{soak['end']['dom']}, calls={soak['end']['calls']})")

            # ---------------- G6: 6-Viewport Responsive Overlap & Zero-Scrollbar Audit ----------------
            print('[G6] 6-Viewport Responsive Overlap & Zero-Scrollbar Audit...')
            viewports = [
                (1280, 800, False, False, 'desktop_1280x800'),
                (1024, 768, False, True, 'ipad_1024x768'),
                (1180, 820, False, True, 'ipad_1180x820'),
                (768, 1024, False, True, 'ipad_768x1024'),
                (844, 390, True, True, 'phone_844x390'),
                (390, 844, True, True, 'phone_390x844'),
            ]

            overlap_js = '''(() => {
                const W = window.innerWidth, H = window.innerHeight;
                const sels = [
                    '#top-left-hud', '#top-right-hud', '#toast-banner',
                    '#build-dock-wrap', '#radial-menu', '#walk-desktop-hint',
                    '#touch-stick-zone', '#touch-right-btns'
                ];
                const boxes = [];
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (!el || el.classList.contains('hidden')) continue;
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                    const p = el.parentElement;
                    if (p && p.classList.contains('hidden')) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2) continue;
                    boxes.push({ sel, l: r.left, t: r.top, r: r.right, b: r.bottom });
                }
                const issues = [];
                for (let i = 0; i < boxes.length; i++) {
                    const a = boxes[i];
                    if (a.l < -2 || a.t < -2 || a.r > W + 2 || a.b > H + 2) {
                        issues.push(`OFFSCREEN ${a.sel} (${a.l.toFixed(0)},${a.t.toFixed(0)},${a.r.toFixed(0)},${a.b.toFixed(0)}) in ${W}x${H}`);
                    }
                    for (let j = i + 1; j < boxes.length; j++) {
                        const b = boxes[j];
                        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
                        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
                        if (ox > 2 && oy > 2) {
                            issues.push(`OVERLAP ${a.sel} x ${b.sel} (${ox.toFixed(0)}x${oy.toFixed(0)})`);
                        }
                    }
                }
                const scroll = {
                    sw: document.documentElement.scrollWidth,
                    iw: window.innerWidth,
                    sh: document.documentElement.scrollHeight,
                    ih: window.innerHeight,
                };
                return { issues, scroll };
            })()'''

            for w, h, mob, touch, tag in viewports:
                await cdp.set_viewport(w, h, mob, touch)
                # Build Mode + Toast + Radial Menu Open on centerpiece cottage (-1, 0)
                await cdp.eval('''(() => {
                    const a = window.__ROBLOX_EKO__;
                    a.resetSave();
                    a._game.ui.showToast('Welcome to eko Beta Test!', 4.0);
                    a.openRadialForHex(-1, 0);
                    a.step(1/60, 6);
                    a.render();
                })()''')
                res_b = await cdp.eval(overlap_js)
                assert res_b['issues'] == [], f'{tag} build+radial issues: {res_b["issues"]}'
                assert res_b['scroll']['sw'] <= res_b['scroll']['iw'] + 1
                assert res_b['scroll']['sh'] <= res_b['scroll']['ih'] + 1

                if tag == 'ipad_1024x768':
                    await cdp.screenshot(CAP_DIR / 'ipad_1024x768_radial.png')
                    await cdp.eval('window.__ROBLOX_EKO__.closeRadial(); window.__ROBLOX_EKO__._game.ui.dismissToast(); window.__ROBLOX_EKO__.render();')
                    await cdp.screenshot(CAP_DIR / 'ipad_1024x768_build.png')
                elif tag == 'phone_390x844':
                    await cdp.eval('window.__ROBLOX_EKO__.closeRadial(); window.__ROBLOX_EKO__._game.ui.dismissToast(); window.__ROBLOX_EKO__.render();')
                    await cdp.screenshot(CAP_DIR / 'mobile_390x844_build.png')

                # Presets 1-8 Modal & Settings Modal zero-overflow check
                for modal_btn, modal_id in [('btn-presets', 'modal-presets'), ('btn-settings', 'modal-settings')]:
                    await cdp.eval(f'document.getElementById("{modal_btn}").click();')
                    await asyncio.sleep(0.04)
                    if tag == 'desktop_1280x800' and modal_id == 'modal-presets':
                        await cdp.screenshot(CAP_DIR / 'desktop_presets.png')
                    ov = await cdp.eval(f'''(() => {{
                        const m = document.getElementById("{modal_id}");
                        return {{ sh: m.scrollHeight, ch: m.clientHeight }};
                    }})()''')
                    assert ov['sh'] <= ov['ch'] + 2, f'{tag} {modal_id} overflow: {ov}'
                    await cdp.eval(f'document.querySelector("#{modal_id} [data-close-modal]").click();')

                # Walk Mode HUD check (with R6 Dummy & iPad touch controls)
                await cdp.eval('''(() => {
                    const a = window.__ROBLOX_EKO__;
                    a.closeRadial();
                    a.setMode('walk');
                    a._game.player.yaw = 0.52;
                    a.setCameraOrbit(0.58, 0.26);
                    a._game.ui.dismissToast();
                    a.step(1/60, 8);
                    a.render();
                })()''')
                res_w = await cdp.eval(overlap_js)
                assert res_w['issues'] == [], f'{tag} walk issues: {res_w["issues"]}'
                if tag == 'ipad_1024x768':
                    await cdp.screenshot(CAP_DIR / 'ipad_1024x768_walk.png')
                await cdp.eval('window.__ROBLOX_EKO__.setMode("build");')

            print('  PASS (0 overlaps, 0 offscreen, 0 scrollbars across all 6 viewports in Build, Radial, Modals & Walk!)')

            # ---------------- G7: Real CDP Input.dispatchTouchEvent iPad Touch, Multi-Touch & Runaway Gate ----------------
            print('[G7] Real CDP Touch, Multi-Touch, Pinch Zoom, touchcancel & Zero-Runaway Gate (iPad 1024x768)...')
            await cdp.set_viewport(1024, 768, False, True)
            await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a.resetSave();
                a.setMode('walk');
                a.setCameraOrbit(0.0, 0.38);
                const g = a._game;
                g.player.x = 0; g.player.z = 0; g.player.y = 1.05; g.player.grounded = true;
                a.step(1/60, 6);
                a.render();
            })()''')

            # Verify touch auto-detect and button geometry on iPad
            rects = await cdp.eval('''(() => {
                const s = document.getElementById('touch-stick-zone').getBoundingClientRect();
                const j = document.getElementById('btn-touch-jump').getBoundingClientRect();
                const w = document.getElementById('btn-touch-wave').getBoundingClientRect();
                const m = document.getElementById('btn-toggle-mode').getBoundingClientRect();
                return {
                    touchClass: document.body.classList.contains('touch-device'),
                    tcVis: !document.getElementById('touch-controls').classList.contains('hidden'),
                    stick: { x: s.left + s.width/2, y: s.top + s.height/2, w: s.width },
                    jump: { x: j.left + j.width/2, y: j.top + j.height/2, w: j.width },
                    wave: { x: w.left + w.width/2, y: w.top + w.height/2, w: w.width },
                    modeBtn: { x: m.left + m.width/2, y: m.top + m.height/2, w: m.width },
                };
            })()''')
            assert rects['touchClass'] is True and rects['tcVis'] is True, f'iPad touch auto-detect failed: {rects}'
            assert rects['stick']['w'] >= 130, f'iPad thumbstick < 130px: {rects["stick"]}'
            assert rects['jump']['w'] >= 72, f'iPad JUMP < 72px: {rects["jump"]}'

            # 7a. Real CDP touch hold stick sideways for 4 seconds (240 frames) -> ZERO camera yaw drift!
            sx, sy = rects['stick']['x'], rects['stick']['y']
            await cdp.touch('touchStart', [{'id': 1, 'x': sx, 'y': sy}])
            await cdp.touch('touchMove', [{'id': 1, 'x': sx + 54, 'y': sy}])
            walk_drift = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                const g = a._game;
                const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
                const startX = g.player.x;
                let camTravel = 0, prevYaw = g.camYaw;
                for (let i = 0; i < 240; i++) {
                    a.step(1/60, 1);
                    camTravel += Math.abs(wrap(g.camYaw - prevYaw));
                    prevYaw = g.camYaw;
                }
                return {
                    touchX: g.touchInput.x,
                    dx: g.player.x - startX,
                    camTravel,
                    jumpsBefore: g.player.jumps,
                };
            })()''')
            assert walk_drift['touchX'] > 0.7, f'Real CDP stick did not register: {walk_drift}'
            assert walk_drift['camTravel'] < 0.001, f'Camera yaw drifted during sideways walk: {walk_drift}'

            # 7b. Real Multi-Touch: tap JUMP with finger #2 while finger #1 STILL holds thumbstick!
            jx, jy = rects['jump']['x'], rects['jump']['y']
            await cdp.touch('touchStart', [{'id': 2, 'x': jx, 'y': jy}])
            await cdp.touch('touchEnd', [{'id': 2, 'x': jx, 'y': jy}])
            multi_jump = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a.step(1/60, 5);
                return {
                    jumpsAfter: a._game.player.jumps,
                    stillHoldingStick: a._game.touchInput.x > 0.7,
                };
            })()''')
            assert multi_jump['jumpsAfter'] == walk_drift['jumpsBefore'] + 1, f'Multi-touch JUMP failed while holding stick: {multi_jump}'
            assert multi_jump['stillHoldingStick'] is True, f'Stick dropped during 2nd-finger JUMP: {multi_jump}'

            # 7c. Release finger #1 -> player stops immediately, 0 drift over next 60 frames!
            await cdp.touch('touchEnd', [])
            stop_chk = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                const g = a._game;
                a.step(1/60, 4);
                const x1 = g.player.x, z1 = g.player.z;
                a.step(1/60, 60);
                return {
                    touchMag: Math.hypot(g.touchInput.x, g.touchInput.z),
                    speed: g.player.speed,
                    drift: Math.hypot(g.player.x - x1, g.player.z - z1),
                };
            })()''')
            assert stop_chk['touchMag'] == 0 and stop_chk['speed'] == 0 and stop_chk['drift'] < 0.001, f'Runaway movement after release: {stop_chk}'

            # 7d. Hold stick -> tap BUILD MODE pill with 2nd finger -> switches to Build AND resets stick to 0!
            mx, my = rects['modeBtn']['x'], rects['modeBtn']['y']
            await cdp.touch('touchStart', [{'id': 1, 'x': sx + 50, 'y': sy}])
            await cdp.touch('touchStart', [{'id': 2, 'x': mx, 'y': my}])
            await cdp.touch('touchEnd', [])
            switch_chk = await cdp.eval('''(() => ({
                mode: window.__ROBLOX_EKO__.getState().mode,
                touchMag: Math.hypot(window.__ROBLOX_EKO__._game.touchInput.x, window.__ROBLOX_EKO__._game.touchInput.z),
            }))()''')
            assert switch_chk['mode'] == 'build' and switch_chk['touchMag'] == 0, f'Mode switch stick reset failed: {switch_chk}'

            # 7e. Real CDP touchCancel on ocean hex NEVER places a hex!
            await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a.resetSave();
                a.selectTool('land');
                a.setCameraOrbit(0.66, 0.56);
                a.setCameraZoom(1.0);
                a.step(1/60, 6);
                a.render();
            })()''')
            ocean_pt = await cdp.eval('window.__ROBLOX_EKO__.projectHexToScreen(4, 0)')
            land_before_cancel = await cdp.eval('window.__ROBLOX_EKO__.getState().landCount')
            await cdp.touch('touchStart', [{'id': 1, 'x': ocean_pt['x'], 'y': ocean_pt['y']}])
            await cdp.touch('touchCancel', [])
            land_after_cancel = await cdp.eval('window.__ROBLOX_EKO__.getState().landCount')
            assert land_after_cancel == land_before_cancel, f'touchCancel placed a hex! {land_before_cancel}->{land_after_cancel}'

            # 7f. Real CDP single tap on ocean hex (4, 0) DOES place a hex cleanly!
            await cdp.touch('touchStart', [{'id': 1, 'x': ocean_pt['x'], 'y': ocean_pt['y']}])
            await cdp.touch('touchEnd', [])
            land_after_tap = await cdp.eval('window.__ROBLOX_EKO__.getState().landCount')
            assert land_after_tap == land_before_cancel + 1, f'Real CDP tap did not place hex: {land_before_cancel}->{land_after_tap}'

            # 7g. Real CDP 2-finger pinch zoom in Build Mode!
            z_before = await cdp.eval('window.__ROBLOX_EKO__.getState().camZoomScale')
            await cdp.touch('touchStart', [{'id': 1, 'x': 440, 'y': 380}])
            await cdp.touch('touchStart', [{'id': 2, 'x': 580, 'y': 380}])
            await cdp.touch('touchMove', [
                {'id': 1, 'x': 360, 'y': 380},
                {'id': 2, 'x': 680, 'y': 380},
            ])
            await cdp.touch('touchEnd', [])
            z_after = await cdp.eval('window.__ROBLOX_EKO__.getState().camZoomScale')
            assert z_after < z_before - 0.12, f'Real CDP 2-finger pinch zoom failed: {z_before}->{z_after}'

            # 7h. Modal backdrop closes strictly on its OWN pointerdown (NOT click), so 600ms slow press stays open!
            presets_rect = await cdp.eval('''(() => {
                const r = document.getElementById('btn-presets').getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height };
            })()''')
            await cdp.touch('touchStart', [{'id': 1, 'x': presets_rect['x'], 'y': presets_rect['y']}])
            await asyncio.sleep(0.62)
            await cdp.touch('touchEnd', [])
            await asyncio.sleep(0.05)
            stayed_open_slow = await cdp.eval('!document.getElementById("modal-presets").classList.contains("hidden")')
            assert stayed_open_slow is True, '600ms slow press on Presets self-closed modal on release!'
            # Backdrop pointerdown closes modal cleanly
            await cdp.touch('touchStart', [{'id': 1, 'x': 12, 'y': 400}])
            await cdp.touch('touchEnd', [])
            closed_by_backdrop = await cdp.eval('document.getElementById("modal-presets").classList.contains("hidden")')
            assert closed_by_backdrop is True, 'Backdrop pointerdown did not close Presets modal!'

            # 7i. 600ms slow press on WALK ISLAND pill & BUILD MODE pill toggles ONCE (never double-fires!)
            await cdp.eval('window.__ROBLOX_EKO__.setMode("build");')
            mode_r = await cdp.eval('''(() => {
                const r = document.getElementById('btn-toggle-mode').getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2, h: r.height };
            })()''')
            await cdp.touch('touchStart', [{'id': 1, 'x': mode_r['x'], 'y': mode_r['y']}])
            await asyncio.sleep(0.62)
            await cdp.touch('touchEnd', [])
            await asyncio.sleep(0.06)
            m_after_walk = await cdp.eval('window.__ROBLOX_EKO__.getState().mode')
            assert m_after_walk == 'walk', f'600ms slow press on WALK ISLAND double-fired! mode={m_after_walk}'

            await cdp.touch('touchStart', [{'id': 1, 'x': mode_r['x'], 'y': mode_r['y']}])
            await asyncio.sleep(0.62)
            await cdp.touch('touchEnd', [])
            await asyncio.sleep(0.06)
            m_after_build = await cdp.eval('window.__ROBLOX_EKO__.getState().mode')
            assert m_after_build == 'build', f'600ms slow press on BUILD MODE double-fired! mode={m_after_build}'

            # 7j. 600ms slow press on Radial Rotate & Recolor advances ONCE (never 2 steps!), and radial X >= 44px!
            await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                a.resetSave();
                a.openRadialForHex(-1, 0);
                a.step(1/60, 4);
                a.render();
            })()''')
            rad_info = await cdp.eval('''(() => {
                const c = document.getElementById('btn-rad-close').getBoundingClientRect();
                const rot = document.getElementById('btn-rad-rotate').getBoundingClientRect();
                const rec = document.getElementById('btn-rad-recolor').getBoundingClientRect();
                const p = window.__ROBLOX_EKO__.getHex(-1, 0).prop;
                return {
                    closeW: c.width, closeH: c.height,
                    rotBtn: { x: rot.left + rot.width/2, y: rot.top + rot.height/2 },
                    recBtn: { x: rec.left + rec.width/2, y: rec.top + rec.height/2 },
                    closeBtn: { x: c.left + c.width/2, y: c.top + c.height/2 },
                    rot0: p.rotDeg, col0: p.colorIdx,
                };
            })()''')
            assert rad_info['closeW'] >= 44 and rad_info['closeH'] >= 44, f'Radial X < 44px: {rad_info}'

            await cdp.touch('touchStart', [{'id': 1, 'x': rad_info['rotBtn']['x'], 'y': rad_info['rotBtn']['y']}])
            await asyncio.sleep(0.62)
            await cdp.touch('touchEnd', [])
            await asyncio.sleep(0.06)
            rot_after = await cdp.eval('window.__ROBLOX_EKO__.getHex(-1, 0).prop.rotDeg')
            assert rot_after == (rad_info['rot0'] + 60) % 360, f'600ms Rotate double-fired: {rad_info["rot0"]}->{rot_after}'

            await cdp.touch('touchStart', [{'id': 1, 'x': rad_info['recBtn']['x'], 'y': rad_info['recBtn']['y']}])
            await asyncio.sleep(0.62)
            await cdp.touch('touchEnd', [])
            await asyncio.sleep(0.06)
            col_after = await cdp.eval('window.__ROBLOX_EKO__.getHex(-1, 0).prop.colorIdx')
            assert col_after == (rad_info['col0'] + 1) % 5, f'600ms Recolor double-fired: {rad_info["col0"]}->{col_after}'

            await cdp.touch('touchStart', [{'id': 1, 'x': rad_info['closeBtn']['x'], 'y': rad_info['closeBtn']['y']}])
            await cdp.touch('touchEnd', [])
            rad_closed = await cdp.eval('document.getElementById("radial-menu").classList.contains("hidden")')
            assert rad_closed is True, 'Radial X button did not close radial menu!'

            # 7k. Resting finger on canvas never disables dock tools; holding stick in Walk Mode never disables Presets!
            cottage_btn = await cdp.eval('''(() => {
                const r = document.querySelector('[data-tool="cottage"]').getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2 };
            })()''')
            await cdp.touch('touchStart', [{'id': 1, 'x': 120, 'y': 220}])
            await cdp.touch('touchStart', [{'id': 2, 'x': cottage_btn['x'], 'y': cottage_btn['y']}])
            await cdp.touch('touchEnd', [])
            tool_with_rest = await cdp.eval('window.__ROBLOX_EKO__.getState().activeTool')
            assert tool_with_rest == 'cottage', f'Resting finger blocked dock tool tap! activeTool={tool_with_rest}'

            await cdp.eval('window.__ROBLOX_EKO__.setMode("walk"); window.__ROBLOX_EKO__.step(1/60, 4);')
            await cdp.touch('touchStart', [{'id': 1, 'x': sx + 50, 'y': sy}])
            await cdp.touch('touchStart', [{'id': 2, 'x': presets_rect['x'], 'y': presets_rect['y']}])
            await cdp.touch('touchEnd', [])
            presets_while_stick = await cdp.eval('''(() => ({
                open: !document.getElementById('modal-presets').classList.contains('hidden'),
                stickMag: Math.hypot(window.__ROBLOX_EKO__._game.touchInput.x, window.__ROBLOX_EKO__._game.touchInput.z),
            }))()''')
            assert presets_while_stick['open'] is True and presets_while_stick['stickMag'] == 0, f'Presets ignored while holding stick: {presets_while_stick}'
            await cdp.eval('document.querySelector("#modal-presets [data-close-modal]").click();')

            # 7l. Clear Canvas in Walk Mode places R6 dummy on safe starter land hex (never stranded in ocean!)
            clear_walk = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__;
                const g = a._game;
                a.resetSave();
                a.setMode('walk');
                // Stand far from center (hex (-2, 2) will become ocean on Clear Canvas!)
                g.player.x = -2.86; g.player.z = 4.95; g.player.y = 1.05; g.player.grounded = true;
                a.clearIsland();
                a.step(1/60, 6);
                const s0 = a.getState();
                // Push stick slightly -> verify dummy is on walkable land and can move!
                a.setInput(1, 0);
                a.step(1/60, 12);
                const s1 = a.getState();
                a.setInput(0, 0);
                return {
                    mode: s0.mode,
                    x0: s0.player.x, z0: s0.player.z, y0: s0.player.y,
                    movedDist: Math.hypot(s1.player.x - s0.player.x, s1.player.z - s0.player.z),
                };
            })()''')
            assert abs(clear_walk['x0']) < 0.2 and abs(clear_walk['z0']) < 0.2 and clear_walk['y0'] >= 1.0, f'Clear Canvas in Walk Mode stranded dummy: {clear_walk}'
            assert clear_walk['movedDist'] > 0.2, f'Dummy stuck after Clear Canvas in Walk Mode: {clear_walk}'

            # 7m. Top-bar touch target audit (>= 44px on every top-bar button!)
            top_sizes = await cdp.eval('''(() => {
                const ids = ['btn-presets', 'btn-settings', 'btn-audio', 'btn-cam-reset', 'btn-toggle-mode'];
                return ids.map(id => {
                    const r = document.getElementById(id).getBoundingClientRect();
                    return { id, w: Math.round(r.width), h: Math.round(r.height) };
                });
            })()''')
            for item in top_sizes:
                assert item['w'] >= 44 and item['h'] >= 44, f'Top-bar target < 44px: {item}'

            # 7n. iPad Portrait (768x1024) real-CDP slow-press & sideways walk verification!
            await cdp.set_viewport(768, 1024, False, True)
            await cdp.eval('window.__ROBLOX_EKO__.resetSave(); window.__ROBLOX_EKO__.step(1/60, 4); window.__ROBLOX_EKO__.render();')
            p_mode_r = await cdp.eval('''(() => {
                const r = document.getElementById('btn-toggle-mode').getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2 };
            })()''')
            await cdp.touch('touchStart', [{'id': 1, 'x': p_mode_r['x'], 'y': p_mode_r['y']}])
            await asyncio.sleep(0.62)
            await cdp.touch('touchEnd', [])
            p_walk_mode = await cdp.eval('window.__ROBLOX_EKO__.getState().mode')
            assert p_walk_mode == 'walk', f'Portrait 600ms WALK ISLAND failed: {p_walk_mode}'
            p_stick = await cdp.eval('''(() => {
                const r = document.getElementById('touch-stick-zone').getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2 };
            })()''')
            await cdp.touch('touchStart', [{'id': 1, 'x': p_stick['x'], 'y': p_stick['y']}])
            await cdp.touch('touchMove', [{'id': 1, 'x': p_stick['x'] + 48, 'y': p_stick['y']}])
            p_drift = await cdp.eval('''(() => {
                const a = window.__ROBLOX_EKO__; const g = a._game;
                const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
                let cam = 0, prev = g.camYaw;
                for (let i = 0; i < 120; i++) { a.step(1/60, 1); cam += Math.abs(wrap(g.camYaw - prev)); prev = g.camYaw; }
                return cam;
            })()''')
            await cdp.touch('touchEnd', [])
            assert p_drift < 0.001, f'Portrait sideways walk camera drift: {p_drift}'

            print(f"  PASS (4s sideways walk camDrift={walk_drift['camTravel']:.5f}, multi-touch JUMP OK, release stop=0, touchCancel safe, CDP tap place OK, pinch zoom {z_before:.2f}->{z_after:.2f}, 600ms slow-press WALK/Rotate/Recolor/Presets OK, resting-finger dock & stick+Presets OK, Clear Canvas Walk safe, topbar/radial>=44px, portrait CDP OK)")

            # Clean reset so initial load starts fresh
            await cdp.eval('window.__ROBLOX_EKO__.resetSave();')

            # Final zero-error check
            assert cdp.js_exceptions == [], f'JS exceptions: {cdp.js_exceptions}'
            assert cdp.console_errors == [], f'Console errors: {cdp.console_errors}'
            assert cdp.failed_requests == [], f'Failed network requests: {cdp.failed_requests}'
            assert QuietHandler.bad_requests == [], f'HTTP >= 400 requests: {QuietHandler.bad_requests}'

            await cdp.close()
            print('\nALL 7 GATES PASSED WITH 0 ERRORS!')
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        server.shutdown()
        shutil.rmtree(CHROME_PROFILE, ignore_errors=True)


if __name__ == '__main__':
    asyncio.run(run_all_gates())
