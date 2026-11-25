// Challenge acceptance test: route validity + automated run through all 30 gates.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:4173/';
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const seed of [1337, 4242]) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?mode=challenge&quality=performance&fixedres&seed=${seed}`);
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.__challenge, null, { timeout: 240000 });
  const info = await page.evaluate(() => {
    const c = window.__challenge;
    const g = c.gates;
    let minGap = Infinity, total = 0, blocked = 0;
    for (let i = 0; i < g.length; i++) {
      if (!c.route.clear(g[i].x, g[i].y, g[i].z, g[i].w * 0.9, g[i].h * 0.9, 0)) blocked++;
      if (i) { const d = Math.hypot(g[i].x - g[i - 1].x, g[i].z - g[i - 1].z); total += d; }
      for (let j = 0; j < i; j++) minGap = Math.min(minGap, Math.hypot(g[i].x - g[j].x, g[i].z - g[j].z));
    }
    const types = g.reduce((a, x) => ((a[x.type] = (a[x.type] || 0) + 1), a), {});
    return { n: g.length, minGap, total, blocked, types, ys: g.map((x) => Math.round(x.y)) };
  });
  check(`Seed ${seed}: 30 Tore erzeugt`, info.n === 30, JSON.stringify(info.types));
  check(`Seed ${seed}: kein Tor durch Hindernisse blockiert`, info.blocked === 0, `${info.blocked} blockiert`);
  check(`Seed ${seed}: Tore verteilt (min. Abstand, Streckenlänge)`, info.minGap > 150 && info.total > 12000, `min ${info.minGap.toFixed(0)} m, Strecke ${(info.total / 1000).toFixed(1)} km, Höhen ${info.ys.join(',')}`);
  // start
  await page.mouse.click(320, 200); // unlock audio etc.
  await page.evaluate(() => { document.getElementById('gstartbtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.__challenge.skipCountdown(); });
  await page.waitForFunction(() => window.__challenge.running, null, { timeout: 60000 });
  // wrong order: fly through gate 3 first -> must not count
  const wrong = await page.evaluate(async () => {
    const c = window.__challenge, u = window.__utopia;
    const g = c.gates[2];
    u.flight.collisions = false;
    u.origin.x = g.x - g.nx * 40; u.origin.z = g.z - g.nz * 40;
    u.flight.setPose(0, g.y, 0, Math.atan2(-g.nx, -g.nz), 0); u.flight.speed = 60;
    return c.current;
  });
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => { const c = window.__challenge, u = window.__utopia, g = c.gates[2]; return ((u.camera.position.x + u.origin.x - g.x) * g.nx + (u.camera.position.z + u.origin.z - g.z) * g.nz) > 15; }, null, { timeout: 120000 }); await page.keyboard.up('KeyW');
  const afterWrong = await page.evaluate(() => ({ cur: window.__challenge.current, toast: document.getElementById('gtoast').textContent }));
  check(`Seed ${seed}: falsche Reihenfolge zählt nicht`, wrong === 0 && afterWrong.cur === 0 && /Falsche Reihenfolge/.test(afterWrong.toast), afterWrong.toast);
  // fly through every gate in order (collisions on – approach from 45 m in front)
  await page.evaluate(() => { window.__utopia.flight.collisions = true; });
  let passed = 0;
  for (let k = 0; k < 30; k++) {
    await page.evaluate((k) => {
      const c = window.__challenge, u = window.__utopia, g = c.gates[k];
      u.origin.x = g.x - g.nx * 45; u.origin.z = g.z - g.nz * 45;
      u.flight.setPose(0, g.y, 0, Math.atan2(-g.nx, -g.nz), 0); u.flight.speed = 70;
    }, k);
    await page.keyboard.down('KeyW');
    try { await page.waitForFunction((k) => window.__challenge.gates[k].state === 'passed', k, { timeout: 60000 }); passed++; } catch { console.log('  gate', k + 1, 'not passed', await page.evaluate((k) => { const c = window.__challenge, u = window.__utopia, g = c.gates[k]; return JSON.stringify({ type: g.type, w: g.w, h: g.h, y: g.y, cam: [u.camera.position.x + u.origin.x - g.x, u.camera.position.y, u.camera.position.z + u.origin.z - g.z] }); }, k)); }
    await page.keyboard.up('KeyW');
  }
  const end = await page.evaluate(() => ({ fin: window.__challenge.finished, win: document.getElementById('gwin').classList.contains('show'), time: document.getElementById('gwintime').textContent, splits: document.querySelectorAll('#gsplits span').length }));
  check(`Seed ${seed}: alle 30 Tore mit Kollision durchflogen`, passed === 30, `${passed}/30`);
  check(`Seed ${seed}: Sieg-Bildschirm mit Zeit und Splits`, end.fin && end.win && end.splits === 30, `Zeit ${end.time}`);
  if (seed === 1337) await page.screenshot({ path: '/tmp/c-win.png' });
  check(`Seed ${seed}: keine Laufzeitfehler`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}
await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} bestanden`);
process.exit(res.every(Boolean) ? 0 : 1);
