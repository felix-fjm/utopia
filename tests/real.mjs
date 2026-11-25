// Real-city ("Google") morph mode, tested against a synthetic geo-located 3D Tiles city
// (tools/make-test-tiles.mjs) because Google/Cesium/Overpass are not reachable from CI.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:4173/';
const res = []; const check = (n, ok, d = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errors.push(m.text()); });
await page.goto(`${BASE}?city=frankfurt&tileset=./test-tiles/tileset.json&osm=./test-tiles/osm.json&quality=performance&fixedres`);
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.__morph, null, { timeout: 240000 });
const E = (fn, a) => page.evaluate(fn, a);
const frames = (n) => E((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await frames(10);
const holdUntilStopped = async (getter, maxMs = 90000) => {
  await page.keyboard.down('KeyW');
  const t0 = Date.now(); let last = null, still = 0;
  while (Date.now() - t0 < maxMs) {
    await frames(15);
    const p = await E(getter);
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.05) { if (++still >= 3) break; } else still = 0;
    last = p;
  }
  await page.keyboard.up('KeyW');
};

// building footprints of the test city in local coordinates
await E(async () => {
  const u = window.__utopia;
  const data = await (await fetch('./test-tiles/osm.json')).json();
  const o = u.tw.toLocal(50.1109, 8.6721), ex = u.tw.toLocal(50.1109, 8.6731).sub(o).normalize(), nx = u.tw.toLocal(50.1119, 8.6721).sub(o).normalize();
  window.__bld = data.testBuildings.map((b) => { const c = u.tw.toLocal(b.lat, b.lon); return { x: c.x, z: c.z, w: b.w, d: b.d, h: b.h }; });
  window.__inside = (x, y, z, m = 0) => window.__bld.some((b) => { const dx = x - b.x, dz = z - b.z; const pe = dx * ex.x + dz * ex.z, pn = dx * nx.x + dz * nx.z; return Math.abs(pe) < b.w / 2 + m && Math.abs(pn) < b.d / 2 + m && y < b.h; });
  window.__axes = { ex: [ex.x, ex.z], nx: [nx.x, nx.z] };
});

const st = await E(() => { const u = window.__utopia, m = window.__morph; return { ready: u.tw.ready, roads: u.osm?.roadsKm, parks: u.osm?.parks, stats: m.stats, y: u.camera.position.y, ground: u.tw.groundAt(u.camera.position.x, u.camera.position.z, 3000), axes: window.__axes, attr: document.getElementById('attr').textContent }; });
check('3D-Tiles geladen und auf die Stadt eingenordet (Boden ≈ Ellipsoidhöhe 0)', st.ready && Math.abs(st.ground) < 0.5, `Boden ${st.ground?.toFixed(2)} m, Kamera ${st.y.toFixed(0)} m`);
check('Osten/Norden sind waagerecht und rechtwinklig (Reorientierung korrekt)', Math.abs(st.axes.ex[0] * st.axes.nx[0] + st.axes.ex[1] * st.axes.nx[1]) < 0.01, JSON.stringify(st.axes));
check('Straßen & Parks aus OSM übernommen', st.roads > 100 && st.parks >= 4, `${st.roads?.toFixed(0)} km, ${st.parks} Parks`);
check('Autos, Frösche, Kugeln platziert', st.stats.cars > 30 && st.stats.frogs > 2 && st.stats.orbs > 10, JSON.stringify(st.stats));
check('Quellenangabe sichtbar', /OpenStreetMap/.test(st.attr), st.attr);

const place = await E(() => {
  const m = window.__morph;
  const cars = m['visibleCars'];
  let inBld = 0, offGround = 0;
  for (const c of cars) { if (window.__inside(c.x, 1, c.z, 1.5)) inBld++; if (Math.abs(c.y) > 0.3) offGround++; }
  // nearest street line distance (test grid: every 120 m, lanes at ±4 m)
  return { n: cars.length, inBld, offGround };
});
check('Autos stehen auf der Straße (nicht in Gebäuden, auf Bodenhöhe)', place.inBld === 0 && place.offGround === 0, JSON.stringify(place));

// realistic sizes
const sizes = await E(() => {
  const m = window.__morph;
  const box = new window.__utopia.THREE.Box3();
  box.setFromObject(m['carAvatar'].children[0]);
  const car = box.getSize(new window.__utopia.THREE.Vector3());
  m['frogBody'].geometry.computeBoundingBox();
  const fb = m['frogBody'].geometry.boundingBox.getSize(new window.__utopia.THREE.Vector3()).multiplyScalar(m.cfg.frogScale);
  return { carL: car.z, carW: car.x, carH: car.y, frogL: fb.z, frogH: fb.y };
});
check('Auto in realistischer Größe', sizes.carL > 4.3 && sizes.carL < 5.0 && sizes.carW > 1.7 && sizes.carW < 2.2, `${sizes.carL.toFixed(2)} × ${sizes.carW.toFixed(2)} × ${sizes.carH.toFixed(2)} m`);
check('Frosch in realistischer Größe', sizes.frogL > 0.08 && sizes.frogL < 0.2, `${(sizes.frogL * 100).toFixed(0)} cm lang, ${(sizes.frogH * 100).toFixed(0)} cm hoch`);

// flight collision with a facade at 250 m/s
const fc = await E(() => {
  const u = window.__utopia;
  const b = window.__bld.find((x) => x.h > 80);
  // start 300 m away on the "east" side, looking at the building
  const [ex, ez] = window.__axes.ex;
  const sx = b.x + ex * (b.w / 2 + 300), sz = b.z + ez * (b.w / 2 + 300);
  u.flight.collisions = true;
  u.flight.setPose(sx, b.h * 0.5, sz, Math.atan2(ex, ez), 0);
  u.flight.speed = 250;
  window.__fb = b;
  return b.h;
});
await holdUntilStopped(() => [window.__utopia.camera.position.x, window.__utopia.camera.position.z]);
const fin = await E(() => { const u = window.__utopia, p = u.camera.position, b = window.__fb; return { inside: window.__inside(p.x, p.y, p.z), gap: Math.hypot(p.x - b.x, p.z - b.z) - b.w / 2 }; });
const ahead = await E(() => { const u = window.__utopia, p = u.camera.position, d = u.camera.getWorldDirection(new u.THREE.Vector3()); const h = u.tw.cast(p.x, p.y, p.z, d.x, d.y, d.z, 50); return h ? h.distance : -1; });
check('Flug (250 m/s): an Fassade gestoppt, keine Durchdringung', !fin.inside && ahead >= 0 && ahead < 10, `Wand ${ahead.toFixed(1)} m voraus`);

// enter a car by flying into it
await E(() => { const u = window.__utopia, m = window.__morph; const c = m.nearest('car', u.camera.position.x, u.camera.position.z); u.flight.setPose(c.x, (c.y ?? 0) + 2, c.z, c.h, 0); });
await page.waitForFunction(() => window.__morph.mode === 'car', null, { timeout: 60000 }).catch(() => {});
check('Reinfliegen ins Auto → Auto-Modus', await E(() => window.__morph.mode === 'car'));
const a0 = await E(() => ({ ...window.__morph.car }));
await page.keyboard.down('KeyW'); await frames(160); await page.keyboard.up('KeyW');
const a1 = await E(() => ({ ...window.__morph.car }));
check('Fahren auf dem Boden der echten Stadt', Math.hypot(a1.x - a0.x, a1.z - a0.z) > 5 && Math.abs(a1.y) < 0.3, `Weg ${Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(1)} m, y ${a1.y.toFixed(2)} m`);
// drive into a building
await E(() => {
  const m = window.__morph;
  const b = window.__bld.find((x) => x.h > 20 && Math.min(x.w, x.d) > 50);
  const [ex, ez] = window.__axes.ex;
  Object.assign(m.car, { x: b.x + ex * (b.w / 2 + 25), z: b.z + ez * (b.w / 2 + 25), y: 0, h: Math.atan2(ex, ez), v: 0 });
  window.__cb = b;
});
await holdUntilStopped(() => [window.__morph.car.x, window.__morph.car.z]);
const cb = await E(() => { const c = window.__morph.car, b = window.__cb; return { inside: window.__inside(c.x, 1, c.z), gap: Math.hypot(c.x - b.x, c.z - b.z) - b.w / 2 }; });
check('Auto prallt an echter Gebäudewand ab', !cb.inside && cb.gap < 8, `Abstand zur Wand ${cb.gap.toFixed(1)} m`);

// orb -> fly
await E(() => { const m = window.__morph; const o = m.nearest('orb', m.car.x, m.car.z); const [ex, ez] = window.__axes.ex; Object.assign(m.car, { x: o.x, z: o.z, v: 0 }); });
await page.waitForFunction(() => window.__morph.mode === 'fly', null, { timeout: 60000 }).catch(() => {});
check('Kugel → zurück im Flugmodus', await E(() => window.__morph.mode === 'fly'));

// frog
await frames(60);
await E(() => { const u = window.__utopia, m = window.__morph; const f = m.nearest('frog', u.camera.position.x, u.camera.position.z); u.flight.setPose(f.x, f.y + 1, f.z, 0, -0.3); });
await page.waitForFunction(() => window.__morph.mode === 'frog', null, { timeout: 60000 }).catch(() => {});
await frames(5);
const fr = await E(() => ({ mode: window.__morph.mode, near: window.__utopia.camera.near, label: document.getElementById('speedv').textContent, camD: window.__utopia.camera.position.distanceTo(new window.__utopia.THREE.Vector3(window.__morph.frog.x, window.__morph.frog.y, window.__morph.frog.z)) }));
check('Auf Frosch fliegen → Frosch-Modus mit Nahkamera', fr.mode === 'frog' && fr.near <= 0.05 && fr.camD < 1.5, JSON.stringify(fr));
// frog jumps onto a roof
const roof = await E(() => { const m = window.__morph; const b = window.__bld.find((x) => x.h > 30 && x.h < 120); Object.assign(m.frog, { x: b.x, z: b.z, y: b.h + 6, vx: 0, vy: 0, vz: 0, grounded: false }); return b.h; });
await page.waitForFunction(() => window.__morph.frog.grounded, null, { timeout: 60000 }).catch(() => {});
const ry = await E(() => window.__morph.frog.y);
check('Frosch landet auf echtem Dach', Math.abs(ry - roof) < 0.3, `Dach ${roof.toFixed(1)} m, Frosch ${ry.toFixed(2)} m`);
// small realistic jump
await E(() => { const s = document.getElementById('speed'); s.value = '0.1'; s.dispatchEvent(new Event('input')); window.__y0 = window.__morph.frog.y; window.__mx = 0; window.__tr = true; const t = () => { window.__mx = Math.max(window.__mx, window.__morph.frog.y - window.__y0); if (window.__tr) requestAnimationFrame(t); }; t(); });
await page.keyboard.down('Space'); await frames(3); await page.keyboard.up('Space');
await page.waitForFunction(() => window.__morph.frog.grounded && window.__mx > 0.01, null, { timeout: 60000 }).catch(() => {});
const jh = await E(() => { window.__tr = false; return { h: window.__mx, label: document.getElementById('speedv').textContent }; });
check('Kleiner Froschsprung bei niedriger Sprungkraft', jh.h > 0.03 && jh.h < 1.0, `${(jh.h * 100).toFixed(0)} cm (${jh.label})`);
check('Keine Laufzeitfehler', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: '/tmp/real-test.png' });
await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length} bestanden`);
process.exit(res.every(Boolean) ? 0 : 1);
