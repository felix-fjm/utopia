// End-to-end acceptance tests (desktop Chromium + mobile emulation via CDP touch events).
// Usage: npm run build && npx vite preview --host --port 4173 &  then  node tests/e2e.mjs [baseUrl]
// NOTE: runs in headless Chrome with SwiftShader (software GL). Frame rates measured here say
// nothing about iPhone performance – only functional behaviour is asserted.
import { chromium } from 'playwright-core';
import os from 'node:os';

const BASE = process.argv[2] || 'http://localhost:4173/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });

async function open(ctxOpts, query) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 180000 });
  return { ctx, page, errors };
}
const U = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// ------------------------------------------------------------------ desktop
{
  const { ctx, page, errors } = await open({ viewport: { width: 800, height: 450 } }, '?quality=performance&fixedres&seed=1337');
  check('App startet ohne Fehler', errors.length === 0, errors.join(' | '));
  await frames(page, 3);
  const r = await U(page, () => {
    const u = window.__utopia;
    const meshes = u.city.group.children.filter((m) => m.isInstancedMesh && m.count > 0);
    let tall = 0;
    for (const m of meshes) { const bb = m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox); if (bb.max.y - bb.min.y > 50 && m.geometry.attributes.position.count > 100) tall++; }
    return { meshes: meshes.length, tall, inst: u.city.stats.instances, tris: u.renderer.info.render.triangles, calls: u.renderer.info.render.calls, temp: u.reg.temporary };
  });
  check('3D-Szene rendert (Draw Calls, Dreiecke)', r.calls > 10 && r.tris > 50000, `${r.calls} calls, ${(r.tris / 1e6).toFixed(2)} M Dreiecke`);
  check('Gebäude sind echte 3D-Meshes (instanziert, >50 m hoch)', r.tall >= 5 && r.inst > 500, `${r.tall} hohe Gebäude-Meshes, ${r.inst} Instanzen`);
  check('Platzhalter korrekt als temporär markiert', r.temp === true && (await page.textContent('#badge')).includes('nicht Utopia'));

  // non-uniform image
  const png = await page.screenshot();
  const { default: sharp } = await import('sharp');
  const st = await sharp(png).stats();
  const sd = st.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0) / 3;
  check('Bild ist nicht leer/einfarbig', sd > 20, `Std.-Abw. ${sd.toFixed(1)}`);

  // forward flight follows 3D camera direction (keyboard path)
  for (const [yaw, pitch] of [[0.7, 0.4], [-2.1, -0.5], [3.0, 0.0]]) {
    await U(page, ([y, p]) => { const u = window.__utopia; u.flight.collisions = false; u.flight.speed = 120; u.flight.setPose(0, 600, 0, y, p); u.origin.x = 50000; u.origin.z = 50000; }, [yaw, pitch]);
    const before = await U(page, () => { const u = window.__utopia; const d = new u.THREE.Vector3(); u.camera.getWorldDirection(d); d.y = 0; d.normalize(); return { p: u.camera.position.toArray(), ox: u.origin.x, oz: u.origin.z, d: d.toArray() }; });
    await page.keyboard.down('KeyW'); await frames(page, 25); await page.keyboard.up('KeyW');
    const after = await U(page, () => { const u = window.__utopia; return { p: u.camera.position.toArray(), ox: u.origin.x, oz: u.origin.z }; });
    const dv = [after.p[0] + after.ox - before.p[0] - before.ox, after.p[1] - before.p[1], after.p[2] + after.oz - before.p[2] - before.oz];
    const len = Math.hypot(...dv);
    const dot = (dv[0] * before.d[0] + dv[1] * before.d[1] + dv[2] * before.d[2]) / len;
    check(`Vorwärtsflug waagerecht in Blickrichtung, ohne Höhenänderung (yaw ${yaw}, pitch ${pitch})`, len > 1 && dot > 0.999 && Math.abs(dv[1]) < 0.01, `Weg ${len.toFixed(1)} m, cos ${dot.toFixed(4)}, Δhöhe ${dv[1].toFixed(3)} m`);
  }
  // vertical controls independent of pitch
  await U(page, () => { const u = window.__utopia; u.flight.setPose(0, 300, 0, 0, -0.8); });
  const y0 = await U(page, () => window.__utopia.camera.position.y);
  await page.keyboard.down('Space'); await frames(page, 20); await page.keyboard.up('Space');
  const y1 = await U(page, () => window.__utopia.camera.position.y);
  check('Steigen unabhängig vom Pitch (Space)', y1 > y0 + 1, `${y0.toFixed(1)} → ${y1.toFixed(1)} m`);

  // collisions
  const col = await U(page, () => {
    const u = window.__utopia;
    for (const c of u.city.chunks.values()) for (let k = 0; k < c.colliders.length; k += 4) if (c.colliders[k + 3] > 150) return [c.colliders[k], c.colliders[k + 1], c.colliders[k + 2], c.colliders[k + 3]];
    return null;
  });
  if (col) {
    const res = await U(page, async (c) => {
      const u = window.__utopia;
      u.flight.collisions = true;
      u.origin.x = c[0]; u.origin.z = c[1] + c[2] + 120;
      u.flight.setPose(0, c[3] * 0.4, 0, 0, 0);    // looking toward -z = toward the tower
      u.flight.speed = 80;
      u.flight.input.y = 1;
      return true;
    }, col);
    await page.keyboard.down('KeyW'); await frames(page, 60); await page.keyboard.up('KeyW');
    const d = await U(page, (c) => { const u = window.__utopia; const wx = u.camera.position.x + u.origin.x, wz = u.camera.position.z + u.origin.z; return Math.hypot(wx - c[0], wz - c[1]) - c[2]; }, col);
    check('Kollision verhindert Durchfliegen', res && d > 0, `Abstand zur Kollisionshülle ${d.toFixed(1)} m`);
  }

  // chunk streaming + long-distance memory stability
  const mem = await U(page, async () => {
    const u = window.__utopia;
    u.flight.collisions = false;
    const wait = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const samples = [];
    const keysSeen = new Set();
    for (let i = 0; i < 40; i++) {
      // teleport along a 60 km path (as high-speed flight would)
      u.origin.x = 1000 + i * 1500; u.origin.z = -3000 + i * 700;
      u.flight.setPose(0, 250, 0, -1.2, -0.1);
      await wait(4);
      for (const k of u.city.chunks.keys()) keysSeen.add(k);
      if (window.gc) window.gc();
      samples.push({ chunks: u.city.chunks.size, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, geo: u.renderer.info.memory.geometries, tex: u.renderer.info.memory.textures });
    }
    const uniq = new Set(); for (const a of u.reg.list) for (const l of a.lods) if (l) for (const p of l) uniq.add(p.geometry);
    return { samples, keysSeen: keysSeen.size, maxGeo: uniq.size + 8 };
  });
  const s = mem.samples, first = s[5], half = s[20], lastS = s[s.length - 1];
  const maxChunks = Math.max(...s.map((x) => x.chunks));
  check('Chunks werden geladen und entladen', mem.keysSeen > maxChunks * 2, `${mem.keysSeen} verschiedene Chunks gesehen, max. ${maxChunks} gleichzeitig`);
  check('Kein unkontrolliertes Speicherwachstum (60 km Flug)', lastS.heap < half.heap * 1.3 + 10e6 && lastS.geo <= mem.maxGeo && lastS.tex <= first.tex + 2,
    `JS-Heap ${(first.heap / 1048576).toFixed(0)} → ${(half.heap / 1048576).toFixed(0)} → ${(lastS.heap / 1048576).toFixed(0)} MB, GPU-Geometrien ${first.geo} → ${lastS.geo} (Obergrenze ${mem.maxGeo}, alle Archetypen×LODs), Texturen ${first.tex} → ${lastS.tex}`);
  check('Keine Laufzeitfehler (Desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------------ mobile emulation (iPhone 16 Pro landscape)
{
  const { ctx, page, errors } = await open({
    viewport: { width: 874, height: 402 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  }, '?fixedres&seed=1337');
  const q = await U(page, () => window.__utopia.quality);
  check('Mobil: automatische Qualitätswahl', q === 'balanced', q);
  const cdp = await ctx.newCDPSession(page);
  await U(page, () => { const u = window.__utopia; u.flight.collisions = false; u.flight.speed = 100; u.flight.setPose(0, 500, 0, 0, 0); u.origin.x = 80000; u.origin.z = 80000; });
  const before = await U(page, () => { const u = window.__utopia; return { yaw: u.flight.yaw, p: u.camera.position.toArray() }; });
  const joy = await page.$eval('#joy', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const look = { x: 700, y: 220 };
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })) });
  await T('touchStart', [{ ...joy, id: 1 }]);
  await T('touchStart', [{ ...joy, id: 1 }, { ...look, id: 2 }]);
  // joystick pushed fully forward while the right thumb sweeps left -> steer while flying
  for (let i = 1; i <= 20; i++) {
    await T('touchMove', [{ x: joy.x, y: joy.y - 70, id: 1 }, { x: look.x - i * 8, y: look.y, id: 2 }]);
    await frames(page, 1);
  }
  const mid = await U(page, () => ({ joy: window.__utopia.input.joyVec, yaw: window.__utopia.flight.yaw }));
  await frames(page, 10);
  await T('touchEnd', [{ x: joy.x, y: joy.y - 70, id: 1 }]);
  await T('touchEnd', []);
  await frames(page, 2);
  const after = await U(page, () => { const u = window.__utopia; return { yaw: u.flight.yaw, p: u.camera.position.toArray(), joy: u.input.joyVec, knob: document.getElementById('knob').style.transform }; });
  const moved = Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]);
  check('Multitouch: Joystick + Blick gleichzeitig', mid.joy.y > 0.8 && Math.abs(after.yaw - before.yaw) > 0.3 && moved > 2,
    `Joystick y=${mid.joy.y.toFixed(2)}, Yaw-Änderung ${(after.yaw - before.yaw).toFixed(2)} rad, Weg ${moved.toFixed(1)} m`);
  check('Joystick kehrt beim Loslassen in Neutralstellung zurück', after.joy.x === 0 && after.joy.y === 0 && after.knob === '');
  // the travelled path must curve (steering while flying)
  const heading = Math.atan2(-(after.p[0] - before.p[0]), -(after.p[2] - before.p[2]));
  check('Lenken während des Flugs (Bahn folgt Yaw)', Math.abs(heading - before.yaw) > 0.05, `Flugrichtung ${heading.toFixed(2)} rad vs. Start-Yaw ${before.yaw.toFixed(2)}`);

  // look down to street level / up to peaks
  await U(page, () => window.__utopia.flight.setPose(0, 200, 0, 0, 0));
  await T('touchStart', [{ x: 700, y: 100, id: 3 }]);
  for (let i = 1; i <= 15; i++) { await T('touchMove', [{ x: 700, y: 100 + i * 20, id: 3 }]); }
  await T('touchEnd', []);
  await frames(page, 20);
  const pitchDown = await U(page, () => window.__utopia.flight.pitch);
  check('Blick steil nach unten möglich', pitchDown < -1.0, `pitch ${pitchDown.toFixed(2)} rad`);
  const roll = await U(page, () => { const e = new window.__utopia.THREE.Euler().setFromQuaternion(window.__utopia.camera.quaternion, 'YXZ'); return e.z; });
  check('Keine Kamera-Rollbewegung', Math.abs(roll) < 1e-6, `roll ${roll}`);

  // page must not scroll / zoom
  const vp = await U(page, () => ({ sx: window.scrollX, sy: window.scrollY, scale: window.visualViewport ? window.visualViewport.scale : 1 }));
  check('Kein Scrollen/Zoomen der Seite', vp.sx === 0 && vp.sy === 0 && vp.scale === 1, JSON.stringify(vp));

  // buttons: boost & ascend via touch
  const up = await page.$eval('#b-up', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await U(page, () => window.__utopia.flight.setPose(0, 200, 0, 0, 0));
  await T('touchStart', [{ ...up, id: 5 }]); await frames(page, 20); await T('touchEnd', []);
  const yUp = await U(page, () => window.__utopia.camera.position.y);
  check('Steigen-Taste (Touch)', yUp > 201, `y = ${yUp.toFixed(1)}`);
  check('Keine Laufzeitfehler (Mobil-Emulation)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'test-results/mobile-landscape.png' }).catch(() => {});
  await ctx.close();
}

// ------------------------------------------------------------------ LAN reachability
{
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const port = new URL(BASE).port || '80';
  let ok = false, detail = 'keine LAN-IP';
  for (const ip of ips) {
    try { const r = await fetch(`http://${ip}:${port}/`); ok = r.ok && (await r.text()).includes('UTOPIA'); detail = `http://${ip}:${port}/ → ${r.status}`; if (ok) break; } catch (e) { detail = `${ip}: ${e.message}`; }
  }
  check('Server über Netzwerk-IP erreichbar (nicht nur localhost)', ok, detail);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Tests bestanden`);
process.exit(failed.length ? 1 : 0);
