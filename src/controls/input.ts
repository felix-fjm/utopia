import { Flight } from './flight';

export interface InputHooks {
  onActivity(): void;
  onKey?(key: string): void;
  onWheel?(delta: number): void;
}

/**
 * Two-thumb multi-touch: every pointer is tracked by pointerId so the left joystick (translation)
 * and the right look area (yaw/pitch) work at the same time. Mouse/keyboard are a secondary path.
 */
export class InputController {
  private joyId: number | null = null;
  private lookId: number | null = null;
  private joyCenter = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };
  private radius = 60;
  private keys = new Set<string>();
  private touchActive = false;
  joyVec = { x: 0, y: 0 };
  /** UI-held buttons */
  holdUp = false; holdDown = false; holdBoost = false;

  constructor(
    private surface: HTMLElement,
    private joyBase: HTMLElement,
    private joyKnob: HTMLElement,
    private lookRing: HTMLElement,
    private flight: Flight,
    private hooks: InputHooks,
  ) {
    surface.addEventListener('pointerdown', this.down, { passive: false });
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      hooks.onKey?.(e.code);
      hooks.onActivity();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    surface.addEventListener('wheel', (e) => { e.preventDefault(); hooks.onWheel?.(e.deltaY); }, { passive: false });
    // block iOS page gestures (pinch zoom, double-tap zoom, rubber banding)
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (!(e.target as HTMLElement).closest?.('.scroll-ok')) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  layout() {
    const r = this.joyBase.getBoundingClientRect();
    this.radius = r.width * 0.42 || 60;
    this.home();
  }

  private home() {
    const r = this.joyBase.getBoundingClientRect();
    this.joyBase.style.transform = '';
    this.joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    this.hooks.onActivity();
    const leftSide = e.clientX < window.innerWidth * 0.5;
    if (e.pointerType === 'mouse') {
      if (this.lookId === null) { this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY }; }
      return;
    }
    this.touchActive = true;
    if (leftSide && this.joyId === null) {
      this.joyId = e.pointerId;
      // dynamic origin: if the thumb lands away from the joystick, the joystick comes to the thumb
      const dx = e.clientX - this.joyCenter.x, dy = e.clientY - this.joyCenter.y;
      if (Math.hypot(dx, dy) > this.radius * 1.4) {
        const r = this.joyBase.getBoundingClientRect();
        const bx = r.left + r.width / 2, by = r.top + r.height / 2;
        this.joyBase.style.transform = `translate(${e.clientX - bx}px, ${e.clientY - by}px)`;
        this.joyCenter = { x: e.clientX, y: e.clientY };
      }
      this.joyBase.classList.add('active');
      this.updateJoy(e.clientX, e.clientY);
    } else if (!leftSide && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookRing.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.lookRing.classList.add('active');
    }
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) { e.preventDefault(); this.updateJoy(e.clientX, e.clientY); this.hooks.onActivity(); }
    else if (e.pointerId === this.lookId) {
      e.preventDefault();
      const dx = e.clientX - this.lookLast.x, dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      const scale = e.pointerType === 'mouse' ? 0.0032 : 0.0048;
      this.flight.look(dx, dy, scale);
      if (e.pointerType !== 'mouse') this.lookRing.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.hooks.onActivity();
    }
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      this.joyKnob.style.transform = '';
      this.joyBase.classList.remove('active');
      this.home();
    }
    if (e.pointerId === this.lookId) {
      this.lookId = null;
      this.lookRing.classList.remove('active');
    }
  };

  private updateJoy(x: number, y: number) {
    let dx = x - this.joyCenter.x, dy = y - this.joyCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) { dx *= this.radius / len; dy *= this.radius / len; }
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let vx = dx / this.radius, vy = dy / this.radius;
    const m = Math.hypot(vx, vy);
    if (m < 0.08) { vx = 0; vy = 0; }
    else {
      // dead-zone remap + gentle response curve for fine control at low deflection
      const t = (m - 0.08) / 0.92, c = Math.pow(t, 1.35) / m;
      vx *= c; vy *= c;
    }
    this.joyVec = { x: vx, y: -vy };
  }

  get isTouching() { return this.joyId !== null || this.lookId !== null; }
  get usedTouch() { return this.touchActive; }

  /** Merge all input sources into the flight input each frame. */
  apply() {
    const k = this.keys, f = this.flight;
    if (f.autopilot) {
      if (this.joyId !== null || this.lookId !== null && this.touchActive || k.size > 0 && [...k].some((c) => /Key[WASD]|Arrow/.test(c))) f.stopAutopilot();
      else return;
    }
    let x = this.joyVec.x, y = this.joyVec.y, v = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('Space') || k.has('KeyE') || this.holdUp) v += 1;
    if (k.has('KeyQ') || k.has('KeyC') || this.holdDown) v -= 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    f.input.x = x; f.input.y = y; f.input.v = Math.max(-1, Math.min(1, v));
    f.input.boost = this.holdBoost || k.has('ShiftLeft') || k.has('ShiftRight');
  }
}
