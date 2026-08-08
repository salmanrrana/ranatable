// Rendering: the luminous table, glyphs, hand ghosts, and the aurora that
// responds to the music. Everything is drawn in normalized coords scaled to
// the canvas, over the dimmed mirrored camera feed.

import { GLYPH_TYPES, DOCK_W } from './table.js';

const TYPE_BY_NAME = Object.fromEntries(GLYPH_TYPES.map((g) => [g.type, g]));

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this._resize();
    addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = innerWidth;
    this.h = innerHeight;
  }

  draw(state) {
    const { hands, table, modeName, leadActive } = state;
    const ctx = this.ctx;
    const t = performance.now() / 1000;
    ctx.clearRect(0, 0, this.w, this.h);

    this._aurora(ctx, t, leadActive);
    this._dock(ctx, t, table);
    for (const g of table.glyphs) this._glyph(ctx, g, t);
    for (const hand of hands) this._hand(ctx, hand, t);
    this._particles(ctx);
    this._hud(ctx, modeName);
  }

  // Soft drifting bands of light along the bottom — the "table" surface.
  _aurora(ctx, t, active) {
    const h = this.h, w = this.w;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const y = h * (0.75 + 0.06 * i) + Math.sin(t * 0.3 + i * 2) * 14;
      const grad = ctx.createLinearGradient(0, y - 120, 0, y + 60);
      const hue = 250 + i * 25 + Math.sin(t * 0.2 + i) * 12;
      const alpha = active ? 0.10 : 0.05;
      grad.addColorStop(0, 'hsla(' + hue + ', 80%, 60%, 0)');
      grad.addColorStop(0.7, 'hsla(' + hue + ', 80%, 60%, ' + alpha + ')');
      grad.addColorStop(1, 'hsla(' + hue + ', 80%, 60%, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 120, w, 200);
    }
    ctx.restore();
  }

  _dock(ctx, t, table) {
    const w = this.w, h = this.h;
    const dw = DOCK_W * w;

    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, dw * 1.3, 0);
    grad.addColorStop(0, 'rgba(18, 12, 45, 0.78)');
    grad.addColorStop(1, 'rgba(18, 12, 45, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, dw * 1.3, h);

    ctx.strokeStyle = 'rgba(157, 123, 255, 0.25)';
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(dw, 0);
    ctx.lineTo(dw, h);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const s of table.dockSlots()) {
      const x = s.x * w, y = s.y * h;
      const pulse = 1 + Math.sin(t * 1.4 + s.y * 9) * 0.06;
      this._sigil(ctx, x, y, 20 * pulse, s, 0.55);
      ctx.fillStyle = 'rgba(200, 195, 235, 0.5)';
      ctx.font = '9px Palatino, serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.label, x, y + 34);
    }
    ctx.restore();
  }

  _glyph(ctx, g, t) {
    const spec = TYPE_BY_NAME[g.type];
    const x = g.x * this.w, y = g.y * this.h;
    const age = (performance.now() - (g.birth ?? 0)) / 1000;
    const born = Math.min(1, age * 2.5);
    const r = (26 + g.level * 14) * born;

    ctx.save();

    // Orbiting motes proportional to level.
    ctx.globalCompositeOperation = 'screen';
    const motes = Math.round(2 + g.level * 6);
    for (let i = 0; i < motes; i++) {
      const a = t * (0.4 + g.level) + (i / motes) * Math.PI * 2;
      const rr = r + 14 + Math.sin(t * 2 + i) * 4;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + spec.hue + ', 90%, 75%, 0.7)';
      ctx.fill();
    }

    // Level ring — the "dial". Fills clockwise with level.
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'hsla(' + spec.hue + ', 85%, 68%, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + g.level * Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'hsla(' + spec.hue + ', 85%, 68%, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.stroke();

    // Twist feedback flash.
    if (g.twistFlash && performance.now() - g.twistFlash < 250) {
      const k = 1 - (performance.now() - g.twistFlash) / 250;
      ctx.strokeStyle = 'hsla(' + spec.hue + ', 95%, 80%, ' + 0.6 * k + ')';
      ctx.lineWidth = 6 * k;
      ctx.beginPath();
      ctx.arc(x, y, r + 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    this._sigil(ctx, x, y, r, spec, g.held ? 1 : 0.85);

    if (g.held) {
      ctx.fillStyle = 'rgba(232, 228, 255, 0.85)';
      ctx.font = 'italic 11px Palatino, serif';
      ctx.textAlign = 'center';
      ctx.fillText(spec.desc + '  ·  twist to dial  ' + Math.round(g.level * 100) + '%', x, y - r - 18);
    }
    ctx.restore();
  }

  _sigil(ctx, x, y, r, spec, alpha) {
    const hue = spec.hue;
    ctx.save();
    ctx.globalAlpha = alpha;

    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    glow.addColorStop(0, 'hsla(' + hue + ', 90%, 65%, 0.5)');
    glow.addColorStop(1, 'hsla(' + hue + ', 90%, 65%, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'hsla(' + hue + ', 55%, 16%, 0.9)';
    ctx.strokeStyle = 'hsla(' + hue + ', 85%, 65%, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'hsla(' + hue + ', 90%, 80%, 1)';
    ctx.font = r * 1.05 + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.symbol, x, y + 1);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  _hand(ctx, hand, t) {
    const w = this.w, h = this.h;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // Constellation: fingertips + wrist, faint lines between.
    const pts = [0, 4, 8, 12, 16, 20].map((i) => hand.landmarks[i]);
    ctx.strokeStyle = 'rgba(157, 123, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < pts.length; i++) {
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      ctx.lineTo(pts[i].x * w, pts[i].y * h);
    }
    ctx.stroke();

    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(210, 200, 255, 0.9)';
      ctx.fill();
    }

    // Pinch point becomes a bright star while pinching.
    if (hand.pinching) {
      const p = hand.pinch;
      const r = 10 + Math.sin(t * 10) * 2;
      const glow = ctx.createRadialGradient(p.x * w, p.y * h, 0, p.x * w, p.y * h, r * 3);
      glow.addColorStop(0, 'rgba(255, 250, 220, 0.9)');
      glow.addColorStop(1, 'rgba(255, 250, 220, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, r * 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (hand.openness > 0.25) {
      // Singing: emit motes from the palm.
      if (Math.random() < 0.5) {
        this.particles.push({
          x: hand.palm.x * w,
          y: hand.palm.y * h,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -0.4 - Math.random() * 0.8,
          life: 1,
          hue: hand.slot === 0 ? 200 : 275,
        });
      }
    }
    ctx.restore();
  }

  _particles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.008;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + p.hue + ', 85%, 75%, ' + p.life * 0.6 + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  _hud(ctx, modeName) {
    ctx.save();
    ctx.fillStyle = 'rgba(200, 195, 235, 0.55)';
    ctx.font = '12px Palatino, serif';
    ctx.textAlign = 'right';
    ctx.fillText('mode · ' + modeName, this.w - 18, this.h - 16);
    ctx.restore();
  }
}
