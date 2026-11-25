import * as THREE from 'three';
import { valueNoise } from '../core/rng';

export const MIN_SPEED = 5, MAX_SPEED = 1000;
export const sliderToSpeed = (v: number) => MIN_SPEED * Math.pow(MAX_SPEED / MIN_SPEED, v);
export const speedToSlider = (s: number) => Math.log(s / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);

export interface FlightInput {
  /** strafe -1..1 */ x: number;
  /** forward -1..1 */ y: number;
  /** vertical -1..1 (independent of pitch) */ v: number;
  boost: boolean;
}

export interface WorldQuery {
  collide(p: THREE.Vector3, margin?: number): boolean;
  heightAhead(wx: number, wz: number): number;
  worldX(rx: number): number;
  worldZ(rz: number): number;
}

/**
 * Cinematic free flight: camera-relative translation, independently smoothed yaw/pitch (no roll),
 * exponential acceleration/deceleration, boost, optional collisions and an autopilot.
 */
export class Flight {
  yaw = 0; pitch = -0.2;
  yawT = 0; pitchT = -0.2;
  readonly vel = new THREE.Vector3();
  readonly input: FlightInput = { x: 0, y: 0, v: 0, boost: false };
  speed = 60;
  sensitivity = 1;
  paused = false;
  autopilot = false;
  collisions = true;
  private boostMul = 1;
  private t = 0;
  private apAlt = 300;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private desired = new THREE.Vector3();
  lastCollision = false;
  /** timestamp of the last manual look input */
  lastLook = 0;

  constructor(public camera: THREE.PerspectiveCamera) {}

  setPose(x: number, y: number, z: number, yaw: number, pitch: number) {
    this.camera.position.set(x, y, z);
    this.yaw = this.yawT = yaw;
    this.pitch = this.pitchT = pitch;
    this.vel.set(0, 0, 0);
    this.apply();
  }

  /** Look input in pixels (touch or mouse delta). */
  look(dx: number, dy: number, scale = 0.0042) {
    if (this.autopilot) return;
    this.lastLook = performance.now();
    this.yawT -= dx * scale * this.sensitivity;
    this.pitchT -= dy * scale * this.sensitivity;
    this.pitchT = THREE.MathUtils.clamp(this.pitchT, -1.53, 1.53);
  }

  get currentSpeed() { return this.vel.length(); }

  /** Smooth yaw/pitch only (used as orbit camera angles while driving / as a frog). */
  updateLook(dt: number, minPitch = -1.53, maxPitch = 1.53) {
    this.pitchT = THREE.MathUtils.clamp(this.pitchT, minPitch, maxPitch);
    const k = 1 - Math.exp(-13 * dt);
    this.yaw += (this.yawT - this.yaw) * k;
    this.pitch += (this.pitchT - this.pitch) * k;
    this.apply();
  }

  update(dt: number, world: WorldQuery) {
    if (this.paused) { this.apply(); return; }
    this.t += dt;
    const inp = this.input;
    if (this.autopilot) this.autopilotStep(dt, world);

    // orientation smoothing (critically damped feel, no roll)
    const kLook = 1 - Math.exp(-13 * dt);
    this.yaw += (this.yawT - this.yaw) * kLook;
    this.pitch += (this.pitchT - this.pitch) * kLook;
    this.apply();

    this.boostMul += ((inp.boost ? 5 : 1) - this.boostMul) * (1 - Math.exp(-2.5 * dt));
    const sp = Math.min(this.speed * this.boostMul, 2500);
    // joystick/WASD move on the horizontal plane only (heading = yaw); pitch never changes altitude.
    // Altitude changes come exclusively from the vertical input (▲/▼, Space/Q).
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const mag = Math.min(1, Math.hypot(inp.x, inp.y));
    this.desired.set(0, 0, 0)
      .addScaledVector(this.fwd, inp.y * sp)
      .addScaledVector(this.right, inp.x * sp);
    this.desired.y += inp.v * Math.max(8, Math.min(sp, 400)) * 0.7;
    const active = mag > 0.01 || Math.abs(inp.v) > 0.01;
    const k = 1 - Math.exp(-(active ? 2.6 : 1.7) * dt);
    this.vel.lerp(this.desired, k);
    if (this.vel.lengthSq() < 0.0004 && !active) this.vel.set(0, 0, 0);

    // sub-step fast movement so collisions are not tunnelled through
    const travel = this.vel.length() * dt;
    const steps = this.collisions ? Math.min(12, Math.max(1, Math.ceil(travel / 15))) : 1;
    let hit = false;
    for (let i = 0; i < steps; i++) {
      this.camera.position.addScaledVector(this.vel, dt / steps);
      if (this.collisions && world.collide(this.camera.position, 5)) hit = true;
    }
    if (hit) this.vel.multiplyScalar(Math.exp(-6 * dt));
    this.lastCollision = hit;
    const p = this.camera.position;
    if (p.y < 1.8) { p.y = 1.8; if (this.vel.y < 0) this.vel.y = 0; }
    if (p.y > 6000) { p.y = 6000; if (this.vel.y > 0) this.vel.y = 0; }
  }

  private apply() {
    this.e.set(this.pitch, this.yaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.camera.quaternion.copy(this.q);
  }

  private autopilotStep(dt: number, world: WorldQuery) {
    const p = this.camera.position;
    const wx = world.worldX(p.x), wz = world.worldZ(p.z);
    // gently wandering heading
    const turn = (valueNoise(this.t * 0.05, 3.7, 99) - 0.5) * 0.6;
    this.yawT += turn * dt;
    // cinematic altitude profile: dives into canyons, climbs over skylines
    const cin = 120 + 380 * (0.5 + 0.5 * Math.sin(this.t * 0.045)) * valueNoise(this.t * 0.02, 1.3, 7);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let clearance = 0;
    for (const d of [80, 220, 450]) clearance = Math.max(clearance, world.heightAhead(wx + fx * d, wz + fz * d));
    const target = Math.max(cin, clearance + 45);
    this.apAlt += (target - this.apAlt) * (1 - Math.exp(-0.8 * dt));
    const sp = Math.max(this.speed, 15);
    const climb = THREE.MathUtils.clamp((this.apAlt - p.y) / Math.max(120, sp * 2.5), -0.45, 0.45);
    this.pitchT += (climb - 0.06 - this.pitchT) * (1 - Math.exp(-1.5 * dt));
    this.input.y = 1;
    this.input.x = 0;
    this.input.v = THREE.MathUtils.clamp((this.apAlt - p.y) / 60, -1, 1) * 0.5;
  }

  stopAutopilot() {
    this.autopilot = false;
    this.input.y = 0; this.input.x = 0; this.input.v = 0;
  }
}
