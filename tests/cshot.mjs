import { chromium } from 'playwright-core';
const [,, k, back, out, preset = 'golden', up = '0', side = '0'] = process.argv;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 640 } });
await p.goto(`http://localhost:4173/?mode=challenge&quality=high&fixedres&preset=${preset}`);
await p.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.__challenge, null, { timeout: 240000 });
await p.evaluate(([k, back, up, side]) => {
  const c = window.__challenge, u = window.__utopia;
  document.getElementById('gstartbtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  c.skipCountdown();
  // mark previous gates as passed through the API path
  for (let i = 0; i < k; i++) { c.gates[i].state = 'passed'; }
  c.gates.slice(0, k).forEach((g) => { g.split = 0; });
  c['activate'](k);
  for (let i = 0; i < k; i++) c['setState'](c.gates[i], 'passed');
  const g = c.gates[k];
  const rx = g.nz, rz = -g.nx;
  u.origin.x = g.x - g.nx * back + rx * side; u.origin.z = g.z - g.nz * back + rz * side;
  const y = g.y + up;
  const yaw = Math.atan2(-(g.x - u.origin.x), -(g.z - u.origin.z));
  u.flight.setPose(0, y, 0, yaw, Math.atan2(g.y - y, back) * 0.8);
}, [+k, +back, +up, +side]);
await p.waitForTimeout(5000);
await p.screenshot({ path: out });
console.log(await p.evaluate((k) => JSON.stringify({ type: window.__challenge.gates[k].type, y: window.__challenge.gates[k].y }), +k));
await b.close();
