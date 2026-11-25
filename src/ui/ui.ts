import { PRESETS, PresetName } from '../world/environment';
import { QualityName } from '../core/quality';

const ico = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  auto: '<svg viewBox="0 0 24 24"><path d="M2.5 15.5l19-7-7 13-2.5-6.5z"/></svg>',
  imm: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  boost: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
};

export interface UIHandlers {
  onPreset(p: PresetName): void;
  onQuality(q: QualityName): void;
  onSpeedSlider(v: number): void;
  onSensitivity(v: number): void;
  onToggle(key: 'autopilot' | 'collisions' | 'dev' | 'pause' | 'immersive', on: boolean): void;
  onReset(): void;
  onNewCity(): void;
}

export class UI {
  root = document.getElementById('ui')!;
  els: Record<string, HTMLElement> = {};
  private idleTimer = 0;
  private toggles = new Map<string, HTMLElement>();

  constructor(h: UIHandlers) {
    this.root.innerHTML = `
      <div id="top" class="hide-immersive">
        <div id="hud" class="glass fade"></div>
        <div id="topbtns" class="fade">
          <div class="btn glass" id="b-auto" title="Autopilot (O)">${ico.auto}</div>
          <div class="btn glass" id="b-pause" title="Pause (P)">${ico.pause}</div>
          <div class="btn glass" id="b-imm" title="Immersiv (I)">${ico.imm}</div>
          <div class="btn glass" id="b-set" title="Einstellungen">${ico.gear}</div>
        </div>
      </div>
      <div id="badge" class="glass hide-immersive fade"></div>
      <div id="dev" class="glass"></div>
      <div id="paused" class="glass">Pausiert</div>
      <div id="joy" class="fade"><div class="ring"></div><div id="knob"></div></div>
      <div id="lookRing"></div>
      <div id="lookHint" class="fade hide-immersive">Blick ziehen</div>
      <div id="vert" class="fade">
        <div class="btn glass" id="b-up">${ico.up}</div>
        <div class="btn glass" id="boost">${ico.boost}</div>
        <div class="btn glass" id="b-down">${ico.down}</div>
      </div>
      <div class="slider-wrap glass fade hide-immersive"><input id="speed" type="range" min="0" max="1" step="0.001"><span id="speedv"></span></div>
      <div id="settings" class="glass scroll-ok">
        <h3>Atmosphäre</h3>
        <div class="seg" id="seg-preset">${(Object.keys(PRESETS) as PresetName[]).map((k) => `<button data-v="${k}">${PRESETS[k].label}</button>`).join('')}</div>
        <h3>Qualität</h3>
        <div class="seg" id="seg-quality">${['performance', 'balanced', 'high', 'ultra'].map((k) => `<button data-v="${k}">${{ performance: 'Perform.', balanced: 'Balanced', high: 'High', ultra: 'Ultra' }[k]}</button>`).join('')}</div>
        <h3>Flug</h3>
        <div class="row">Blick-Empfindlichkeit <input id="sens" type="range" min="0.3" max="2.5" step="0.05" value="1"></div>
        <div class="row">Kollision <div class="toggle" data-t="collisions"></div></div>
        <div class="row">Autopilot (Kinoflug) <div class="toggle" data-t="autopilot"></div></div>
        <div class="row">Entwickler-Overlay <div class="toggle" data-t="dev"></div></div>
        <div class="btnrow"><button id="b-reset" class="seg-like">Position zurücksetzen</button><button id="b-city">Neue Stadt (Seed)</button></div>
        <div class="note" id="assetnote"></div>
      </div>
      <div id="loading"><div><div class="t">UTOPIA</div><div class="s" id="loadmsg">Stadt wird generiert</div><div class="bar"><i id="loadbar"></i></div></div></div>
    `;
    for (const id of ['hud', 'badge', 'dev', 'paused', 'joy', 'knob', 'lookRing', 'speed', 'speedv', 'settings', 'loading', 'loadbar', 'loadmsg', 'assetnote', 'b-pause', 'b-auto', 'b-imm', 'b-set', 'b-up', 'b-down', 'boost', 'sens']) this.els[id] = document.getElementById(id)!;
    this.root.querySelectorAll('.row button, .btnrow button').forEach((b) => b.classList.add('rowbtn'));
    this.root.querySelectorAll<HTMLElement>('.btnrow button').forEach((b) => { b.style.cssText = 'font:500 12px -apple-system,sans-serif;color:var(--txt);background:rgba(255,255,255,.08);border:1px solid var(--line);border-radius:10px;padding:10px 6px;'; });

    const tap = (el: HTMLElement, fn: () => void) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); this.activity(); });
    tap(this.els['b-set'], () => this.els.settings.classList.toggle('open'));
    tap(this.els['b-pause'], () => h.onToggle('pause', !this.els['b-pause'].classList.contains('on')));
    tap(this.els['b-auto'], () => h.onToggle('autopilot', !this.els['b-auto'].classList.contains('on')));
    tap(this.els['b-imm'], () => h.onToggle('immersive', !this.root.classList.contains('immersive')));
    this.root.querySelectorAll<HTMLElement>('#seg-preset button').forEach((b) => tap(b, () => h.onPreset(b.dataset.v as PresetName)));
    this.root.querySelectorAll<HTMLElement>('#seg-quality button').forEach((b) => tap(b, () => h.onQuality(b.dataset.v as QualityName)));
    this.root.querySelectorAll<HTMLElement>('.toggle').forEach((t) => { this.toggles.set(t.dataset.t!, t); tap(t, () => h.onToggle(t.dataset.t as 'dev', !t.classList.contains('on'))); });
    tap(document.getElementById('b-reset')!, () => h.onReset());
    tap(document.getElementById('b-city')!, () => h.onNewCity());
    const speed = this.els.speed as HTMLInputElement;
    speed.addEventListener('input', () => h.onSpeedSlider(parseFloat(speed.value)));
    speed.addEventListener('pointerdown', (e) => e.stopPropagation());
    const sens = this.els.sens as HTMLInputElement;
    sens.addEventListener('input', () => h.onSensitivity(parseFloat(sens.value)));
    sens.addEventListener('pointerdown', (e) => e.stopPropagation());
    // close settings when tapping into the world
    document.getElementById('touch')!.addEventListener('pointerdown', () => this.els.settings.classList.remove('open'));
    this.activity();
  }

  bindHold(el: HTMLElement, set: (on: boolean) => void) {
    const ids = new Set<number>();
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); ids.add(e.pointerId); el.classList.add('pressed'); set(true); this.activity(); try { el.setPointerCapture(e.pointerId); } catch { /* */ } });
    const off = (e: PointerEvent) => { if (!ids.delete(e.pointerId)) return; if (!ids.size) { el.classList.remove('pressed'); set(false); } };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  activity() {
    this.root.classList.remove('dim');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.root.classList.add('dim'), 4500);
  }

  setPreset(p: PresetName) { this.root.querySelectorAll<HTMLElement>('#seg-preset button').forEach((b) => b.classList.toggle('on', b.dataset.v === p)); }
  setQuality(q: QualityName) { this.root.querySelectorAll<HTMLElement>('#seg-quality button').forEach((b) => b.classList.toggle('on', b.dataset.v === q)); }
  setToggle(key: string, on: boolean) {
    this.toggles.get(key)?.classList.toggle('on', on);
    if (key === 'pause') { this.els['b-pause'].classList.toggle('on', on); this.els['b-pause'].innerHTML = on ? ico.play : ico.pause; this.els.paused.classList.toggle('show', on); }
    if (key === 'autopilot') this.els['b-auto'].classList.toggle('on', on);
    if (key === 'immersive') { this.root.classList.toggle('immersive', on); this.els['b-imm'].classList.toggle('on', on); }
    if (key === 'dev') this.els.dev.classList.toggle('show', on);
  }
  setSpeed(slider: number, mps: number) {
    (this.els.speed as HTMLInputElement).value = String(slider);
    this.els.speedv.textContent = mps >= 100 ? `${Math.round(mps)} m/s` : `${mps.toFixed(1)} m/s`;
  }
  setBadge(text: string, real: boolean) { this.els.badge.textContent = text; this.els.badge.classList.toggle('real', real); this.els.badge.style.display = text ? '' : 'none'; }
  setHUD(alt: number, spd: number, district: string) {
    const kmh = spd * 3.6;
    this.els.hud.innerHTML = `ALT <b>${Math.round(alt)}</b> m · SPD <b>${spd < 10 ? spd.toFixed(1) : Math.round(spd)}</b> m/s <span style="opacity:.6">(${Math.round(kmh)} km/h)</span><br>${district}`;
  }
  loading(frac: number, msg?: string) {
    (this.els.loadbar as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
    if (msg) this.els.loadmsg.textContent = msg;
  }
  loaded() { this.els.loading.classList.add('done'); }
}
