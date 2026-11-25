// "Verwandlung" acceptance test: cars, frogs, orbs, driving, jumping, roof landing, transitions.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:4173/';
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}?mode=morph&quality=performance&fixedres&seed=1337`);
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.__morph, null, { timeout: 240000 });
const E = (fn, a) => page.evaluate(fn, a);
const frames = (n) => E((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await frames(3);

const st = await E(() => window.__morph.stats);
check('Autos, Frösche und Kugeln werden um den Spieler erzeugt', st.cars > 100 && st.frogs > 5 && st.orbs > 10, JSON.stringify(st));
const inside = await E(() => {
  const m = window.__morph, u = window.__utopia;
  let bad = 0, n = 0;
  for (const c of m['visibleCars'].slice(0, 300)) { const p = new u.THREE.Vector3(c.x - u.origin.x, 1, c.z - u.origin.z); if (u.city.collide(p, u.origin.x, u.origin.z, 0)) bad++; n++; }
  return { bad, n };
});
check('Autos stehen auf Straßen, nicht in Gebäuden', inside.bad === 0, `${inside.n} Autos geprüft, ${inside.bad} in Gebäuden`);
const orbsHidden = await E(() => !window.__morph['orbMesh'].visible);
check('Kugeln im Flugmodus unsichtbar', orbsHidden);

// ---- fly into a car
const car0 = await E(() => {
  const m = window.__morph, u = window.__utopia;
  const c = m.nearest('car', u.origin.x, u.origin.z);
  u.flight.collisions = false;
  u.origin.x = c.x + Math.sin(c.h) * 20; u.origin.z = c.z + Math.cos(c.h) * 20;   // 20 m behind it
  u.flight.setPose(0, 2.5, 0, c.h, 0); u.flight.speed = 25;
  return c;
});
await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__morph.mode === 'car', null, { timeout: 60000 }).catch(() => {}); await page.keyboard.up('KeyW');
const m1 = await E(() => ({ mode: window.__morph.mode, orbs: window.__morph['orbMesh'].visible, ui: document.getElementById('ui').classList.contains('m-car'), label: document.getElementById('speedv').textContent, mk: document.getElementById('mk-orb').style.display }));
check('Reinfliegen in ein Auto → Auto-Modus', m1.mode === 'car' && m1.ui, JSON.stringify(m1));
check('Im Auto: Kugeln sichtbar, Kugel-Marker aktiv, Slider = Höchstgeschwindigkeit', m1.orbs && m1.mk !== 'none' && /km\/h/.test(m1.label), m1.label);

// ---- drive straight
await frames(30);
const a = await E(() => ({ ...window.__morph.car }));
await page.keyboard.down('KeyW'); await frames(40); await page.keyboard.up('KeyW');
const b = await E(() => ({ ...window.__morph.car, y: window.__utopia.camera.position.y }));
const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz);
const dot = (dx * -Math.sin(a.h) + dz * -Math.cos(a.h)) / (dl || 1);
check('Auto fährt vorwärts entlang seiner Ausrichtung', dl > 10 && dot > 0.97 && b.v > 5, `Weg ${dl.toFixed(1)} m, cos ${dot.toFixed(3)}, v ${b.v.toFixed(1)} m/s`);
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD'); await frames(30); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
const c2 = await E(() => ({ ...window.__morph.car }));
let dh = c2.h - b.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
check('Lenken nach rechts dreht das Auto nach rechts (kontrolliert)', dh < -0.15 && dh > -2.0, `Δheading ${dh.toFixed(2)} rad`);
await page.keyboard.down('KeyS'); await frames(60); await page.keyboard.up('KeyS');
const c3 = await E(() => window.__morph.car.v);
check('Bremsen / Rückwärts', c3 < 1, `v ${c3.toFixed(1)} m/s`);

// ---- crash into a building
const col = await E(() => {
  const u = window.__utopia, m = window.__morph;
  for (const ch of u.city.chunks.values()) for (let k = 0; k < ch.colliders.length; k += 4) if (ch.colliders[k + 2] > 12 && ch.colliders[k + 3] > 40) {
    const [x, z, r] = [ch.colliders[k], ch.colliders[k + 1], ch.colliders[k + 2]];
    Object.assign(m.car, { x: x, z: z + r + 40, h: 0, v: 0 });   // heading 0 = toward -z = toward the building
    return [x, z, r];
  }
});
await page.keyboard.down('KeyW'); await frames(90); await page.keyboard.up('KeyW');
const cd = await E((c) => { const m = window.__morph; return Math.hypot(m.car.x - c[0], m.car.z - c[1]) - c[2]; }, col);
check('Auto kann nicht durch Gebäude fahren', cd > 0, `Abstand zur Gebäudehülle ${cd.toFixed(1)} m`);

// ---- drive into an orb
await E(() => {
  const m = window.__morph;
  const o = m.nearest('orb', m.car.x, m.car.z);
  Object.assign(m.car, { x: o.x, z: o.z + 25, h: 0, v: 0 });
  window.__orb = o;
});
await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__morph.mode === 'fly', null, { timeout: 60000 }).catch(() => {}); await page.keyboard.up('KeyW');
const f1 = await E(() => ({ mode: window.__morph.mode, y: window.__utopia.camera.position.y, dropped: window.__morph['droppedCars'].length, orbs: window.__morph['orbMesh'].visible }));
check('Kugel berühren → zurück im Flugmodus (Auto bleibt stehen)', f1.mode === 'fly' && f1.y > 15 && f1.dropped === 1 && !f1.orbs, JSON.stringify(f1));

// ---- become a frog
await frames(80); // cooldown
await E(() => {
  const m = window.__morph, u = window.__utopia;
  const f = m.nearest('frog', u.origin.x + u.camera.position.x, u.origin.z + u.camera.position.z);
  u.origin.x = f.x; u.origin.z = f.z; u.flight.setPose(0, f.y + 1.5, 0, 0, 0);
});
await page.waitForFunction(() => window.__morph.mode === 'frog', null, { timeout: 60000 }).catch(() => {});
const fr = await E(() => ({ mode: window.__morph.mode, label: document.getElementById('speedv').textContent, ui: document.getElementById('ui').classList.contains('m-frog') }));
check('Auf einen Frosch fliegen → Frosch-Modus, Slider = Sprungstärke', fr.mode === 'frog' && fr.ui && /Sprung/.test(fr.label), JSON.stringify(fr));

// big jump with configurable strength
await E(() => {
  const s = document.getElementById('speed'); s.value = '0.6'; s.dispatchEvent(new Event('input'));
  const m = window.__morph; Object.assign(m.frog, { x: m.frog.x, y: 0, grounded: true });
  window.__maxY = 0;
  const tick = () => { window.__maxY = Math.max(window.__maxY, m.frog.y); if (window.__track) requestAnimationFrame(tick); };
  window.__track = true; tick();
});
await frames(5);
await page.keyboard.down('Space'); await frames(3); await page.keyboard.up('Space');
await page.waitForFunction(() => window.__morph.frog.grounded && window.__maxY > 1, null, { timeout: 120000 }).catch(() => {});
const jump = await E(() => { window.__track = false; return { maxY: window.__maxY, label: document.getElementById('speedv').textContent, grounded: window.__morph.frog.grounded }; });
const J = 5 + 105 * Math.pow(0.6, 1.3), Hexp = (J * J) / 44;
check('Frosch springt mit eingestellter Sprungstärke', jump.maxY > Hexp * 0.75 && jump.grounded, `Gipfel ${jump.maxY.toFixed(1)} m (erwartet ≈ ${Hexp.toFixed(0)} m, Anzeige „${jump.label}“), gelandet: ${jump.grounded}`);
// slider strength changes the jump
await E(() => { const s = document.getElementById('speed'); s.value = '0.15'; s.dispatchEvent(new Event('input')); window.__maxY = 0; window.__track = true; const m = window.__morph; const tick = () => { window.__maxY = Math.max(window.__maxY, m.frog.y - window.__base); if (window.__track) requestAnimationFrame(tick); }; window.__base = m.frog.y; tick(); });
await page.keyboard.down('Space'); await frames(3); await page.keyboard.up('Space');
await page.waitForFunction(() => window.__morph.frog.grounded && window.__maxY > 0.2, null, { timeout: 120000 }).catch(() => {});
const small = await E(() => { window.__track = false; return window.__maxY; });
check('Kleinere Sprungstärke → niedrigerer Sprung', small > 0.2 && small < jump.maxY * 0.5, `${small.toFixed(1)} m`);

// hop around with the joystick (keyboard W)
const h0 = await E(() => ({ ...window.__morph.frog }));
await page.keyboard.down('KeyW'); await frames(60); await page.keyboard.up('KeyW');
await page.waitForFunction(() => window.__morph.frog.grounded, null, { timeout: 30000 }).catch(() => {});
const h1 = await E(() => ({ ...window.__morph.frog }));
check('Frosch hüpft mit dem Joystick vorwärts', Math.hypot(h1.x - h0.x, h1.z - h0.z) > 3, `${Math.hypot(h1.x - h0.x, h1.z - h0.z).toFixed(1)} m`);

// land on a rooftop
const roof = await E(() => {
  const u = window.__utopia, m = window.__morph;
  for (const ch of u.city.chunks.values()) for (let k = 0; k < ch.colliders.length; k += 4) if (ch.colliders[k + 2] > 14 && ch.colliders[k + 3] > 30 && ch.colliders[k + 3] < 200) {
    Object.assign(m.frog, { x: ch.colliders[k], z: ch.colliders[k + 1], y: ch.colliders[k + 3] + 25, vx: 0, vy: 0, vz: 0, grounded: false });
    return ch.colliders[k + 3];
  }
});
await page.waitForFunction(() => window.__morph.frog.grounded, null, { timeout: 60000 }).catch(() => {});
const ry = await E(() => window.__morph.frog.y);
check('Frosch landet auf Hausdächern', Math.abs(ry - roof) < 1.5, `Dach ${roof.toFixed(1)} m, Frosch ${ry.toFixed(1)} m`);

// jump into an orb
await E(() => {
  const m = window.__morph;
  const o = m.nearest('orb', m.frog.x, m.frog.z);
  Object.assign(m.frog, { x: o.x, z: o.z + 2, y: 12, vx: 0, vy: 0, vz: -2, grounded: false });
});
await page.waitForFunction(() => window.__morph.mode === 'fly', null, { timeout: 60000 }).catch(() => {});
const f2 = await E(() => ({ mode: window.__morph.mode, frogs: window.__morph['droppedFrogs'].length }));
check('Frosch springt in Kugel → Flugmodus', f2.mode === 'fly' && f2.frogs === 1, JSON.stringify(f2));

// streaming bounded
const strm = await E(async () => {
  const u = window.__utopia, m = window.__morph;
  const wait = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const cells = [];
  for (let i = 0; i < 25; i++) { u.origin.x += 600; u.origin.z += 300; u.flight.setPose(0, 200, 0, 0, -0.2); await wait(2); cells.push(m.stats.cells); }
  return { maxCells: Math.max(...cells), cars: m.stats.cars, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
});
check('Objekt-Streaming bleibt begrenzt (15 km Flug)', strm.maxCells <= 81 && strm.cars > 50, JSON.stringify(strm));
check('Keine Laufzeitfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} bestanden`);
process.exit(res.every(Boolean) ? 0 : 1);
