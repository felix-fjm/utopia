import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()); });
await p.goto('http://localhost:4173/?mode=morph&quality=high&fixedres&preset=' + (process.argv[2] || 'golden'));
await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.__morph, null, { timeout: 200000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// 1: low over the street near a car and a frog
const info = await p.evaluate(() => {
  const m = window.__morph, u = window.__utopia;
  const px = u.origin.x, pz = u.origin.z;
  u.flight.setPose(0, 150, 0, u.flight.yaw, -0.2);
  return { stats: m.stats };
});
await wait(4);
const tgt = await p.evaluate(() => {
  const m = window.__morph, u = window.__utopia;
  const c = m.nearest('car', u.origin.x, u.origin.z);
  const f = m.nearest('frog', u.origin.x, u.origin.z);
  // camera 30 m behind/above the car, looking at it
  u.origin.x = c.x + Math.sin(c.h) * 28; u.origin.z = c.z + Math.cos(c.h) * 28;
  u.flight.setPose(0, 11, 0, c.h, -0.28);
  return { c, f, stats: m.stats };
});
console.log(JSON.stringify(tgt));
await wait(4); await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/m1.png' });
// 2: fly into the car
await p.evaluate(() => { const m = window.__morph, u = window.__utopia; const c = m.nearest('car', u.origin.x, u.origin.z); u.origin.x = c.x; u.origin.z = c.z; u.flight.setPose(0, 3, 0, c.h, 0); });
await wait(4);
console.log('mode after car capture:', await p.evaluate(() => window.__morph.mode));
await p.keyboard.down('KeyW'); await wait(40); await p.keyboard.up('KeyW');
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/m2.png' });
console.log(JSON.stringify(await p.evaluate(() => ({ car: window.__morph.car, mode: window.__morph.mode, stats: window.__morph.stats }))));
// 3: become frog
await p.evaluate(() => { const m = window.__morph; m.forceFly(); });
await p.evaluate(() => { const m = window.__morph, u = window.__utopia; const f = m.nearest('frog', u.origin.x, u.origin.z); u.origin.x = f.x; u.origin.z = f.z; u.flight.setPose(0, f.y + 2, 0, 0, 0); m['cooldown'] = 0; });
await wait(6);
console.log('mode after frog capture:', await p.evaluate(() => window.__morph.mode));
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/m3.png' });
console.log('errors', errs.slice(0, 5));
await b.close();
