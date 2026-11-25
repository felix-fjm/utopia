import { TilesAuth } from './tilesWorld';

const KEY = 'utopia-tiles-auth';

/** URL (?ion=, ?gkey=, ?tileset=) > build env (.env.local) > browser storage */
export function storedAuth(params: URLSearchParams): TilesAuth | null {
  const url = params.get('tileset');
  if (url) return { kind: 'url', key: url };
  const ion = params.get('ion') || (import.meta.env.VITE_ION_TOKEN as string | undefined);
  if (ion) return { kind: 'ion', key: ion };
  const g = params.get('gkey') || (import.meta.env.VITE_GOOGLE_KEY as string | undefined);
  if (g) return { kind: 'google', key: g };
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s) as TilesAuth; } catch { /* private mode */ }
  return null;
}

export function forgetAuth() { try { localStorage.removeItem(KEY); } catch { /* */ } }

/** small in-page dialog; the key never leaves this browser except toward Cesium/Google */
export function askAuth(cityName: string, error = ''): Promise<TilesAuth> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'goverlay show';
    el.style.zIndex = '20';
    el.innerHTML = `<style>
      .authseg button { background: rgba(255,255,255,.08) !important; color: #fff !important; border: 1px solid rgba(255,255,255,.25) !important; }
      .authseg button.on { background: linear-gradient(90deg,#ffd27a,#ffb86b) !important; color: #10141c !important; border-color: transparent !important; }
    </style>
    <div class="gcard" style="background:rgba(10,14,22,.94);border:1px solid rgba(255,255,255,.16)">
      <div class="gtitle" style="letter-spacing:.12em">${cityName} <b>in 3D</b></div>
      <p>Für die fotorealistischen Google-3D-Städte brauchst du einen Zugang. Er wird nur in diesem Browser gespeichert.</p>
      ${error ? `<p style="color:#ff9a8a">${error}</p>` : ''}
      <div class="seg authseg" style="grid-template-columns:1fr 1fr;margin-bottom:10px">
        <button data-k="ion" class="on">Cesium ion Token</button><button data-k="google">Google API-Schlüssel</button>
      </div>
      <input id="authkey" type="text" autocomplete="off" spellcheck="false" placeholder="Token / Schlüssel einfügen"
        style="width:100%;font:15px ui-monospace,Menlo,monospace;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff;margin-bottom:10px;-webkit-user-select:text;user-select:text">
      <p id="authhelp" style="font-size:12px"></p>
      <button id="authgo">Stadt laden</button>
    </div>`;
    document.body.appendChild(el);
    let kind: 'ion' | 'google' = 'ion';
    const help = el.querySelector('#authhelp') as HTMLElement;
    const setHelp = () => {
      help.innerHTML = kind === 'ion'
        ? 'Kostenlos: Konto auf <a href="https://ion.cesium.com/signup" target="_blank" rel="noopener" style="color:#9fe3ff">ion.cesium.com</a> anlegen → „Access Tokens“ → Default-Token kopieren. Unter „Asset Depot“ ggf. „Google Photorealistic 3D Tiles“ zu „My Assets“ hinzufügen.'
        : 'Google Cloud Console → Projekt mit Abrechnung → „Map Tiles API“ aktivieren → API-Schlüssel. Hinweis: Mit deutscher/EU-Rechnungsadresse liefert Google die 3D-Kacheln für neue Projekte nicht aus (Fehler 403).';
    };
    setHelp();
    el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
      kind = b.dataset.k as 'ion' | 'google';
      el.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
      setHelp();
    }));
    const input = el.querySelector('#authkey') as HTMLInputElement;
    // the global touch handler blocks default gestures; let the input work normally
    for (const ev of ['pointerdown', 'touchstart', 'touchmove']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    el.querySelector('#authgo')!.addEventListener('click', () => {
      const key = input.value.trim();
      if (key.length < 10) { input.style.borderColor = '#ff8a7a'; return; }
      const auth: TilesAuth = { kind, key };
      try { localStorage.setItem(KEY, JSON.stringify(auth)); } catch { /* */ }
      el.remove();
      resolve(auth);
    });
  });
}
