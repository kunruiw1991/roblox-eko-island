/**
 * Procedural Pastel Cel-Shaded CanvasTextures for eko Beta Test.
 * All textures are cached and reused across rebuilds (zero GPU leaks).
 */

import * as THREE from '../vendor/three.module.min.js';
import { createRng } from './rng.js';

const _cache = new Map();

function cached(key, factory) {
  if (_cache.has(key)) return _cache.get(key);
  const tex = factory();
  _cache.set(key, tex);
  return tex;
}

export function getSkyDomeTexture() {
  return cached('sky_dome', () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    // Vibrant cyan zenith -> pastel sky -> luminous warm horizon -> turquoise sea bounce
    g.addColorStop(0.0, '#2bb8ee');
    g.addColorStop(0.24, '#4fd1f8');
    g.addColorStop(0.45, '#8ee8ff');
    g.addColorStop(0.51, '#d7f9ff');
    g.addColorStop(0.55, '#a8eef5');
    g.addColorStop(0.75, '#29bcd0');
    g.addColorStop(1.0, '#179bb2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 512);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

export function getOceanTexture() {
  return cached('ocean_ripples', () => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    // Deep vivid turquoise base
    ctx.fillStyle = '#1bb3c8';
    ctx.fillRect(0, 0, size, size);

    const rng = createRng(4109);

    // Soft pastel teal swells (seamless wrap)
    for (let i = 0; i < 64; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const rw = 26 + rng() * 54;
      const rh = 7 + rng() * 14;
      ctx.fillStyle = rng() > 0.45 ? 'rgba(67, 214, 229, 0.26)' : 'rgba(18, 146, 170, 0.22)';
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, rw, rh, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Crisp cel-shaded sunlit wave crests
    ctx.lineCap = 'round';
    for (let i = 0; i < 42; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const w = 18 + rng() * 34;
      ctx.strokeStyle = 'rgba(218, 252, 255, 0.42)';
      ctx.lineWidth = 2.5 + rng() * 1.8;
      for (const ox of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + ox - w * 0.5, y);
        ctx.quadraticCurveTo(x + ox, y - 4, x + ox + w * 0.5, y);
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    tex.needsUpdate = true;
    return tex;
  });
}

export function getCliffTexture() {
  return cached('cliff_strata', () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    // Warm cream/tan sedimentary cliff base
    ctx.fillStyle = '#e7d6b8';
    ctx.fillRect(0, 0, 256, 256);

    const bands = [
      { y: 0, h: 28, col: '#efe2c8' },
      { y: 28, h: 36, col: '#e2cea9' },
      { y: 64, h: 22, col: '#eadbc0' },
      { y: 86, h: 42, col: '#d8c098' },
      { y: 128, h: 30, col: '#e8d7b9' },
      { y: 158, h: 44, col: '#d4b98f' },
      { y: 202, h: 24, col: '#e3cfa9' },
      { y: 226, h: 30, col: '#cbae82' },
    ];
    for (const b of bands) {
      ctx.fillStyle = b.col;
      ctx.fillRect(0, b.y, 256, b.h);
    }

    // Gentle stylized cel cracks & sunlit flecks
    const rng = createRng(7721);
    ctx.fillStyle = 'rgba(255, 250, 238, 0.22)';
    for (let i = 0; i < 36; i++) {
      ctx.fillRect(rng() * 256, rng() * 256, 14 + rng() * 34, 3 + rng() * 4);
    }
    ctx.fillStyle = 'rgba(155, 126, 86, 0.16)';
    for (let i = 0; i < 28; i++) {
      ctx.fillRect(rng() * 256, rng() * 256, 10 + rng() * 26, 2 + rng() * 3);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });
}

export function getGrassTexture() {
  return cached('grass_pastel', () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#92e25e';
    ctx.fillRect(0, 0, 256, 256);

    const rng = createRng(9913);
    // Soft sunlit meadow patches
    for (let i = 0; i < 52; i++) {
      const x = rng() * 256;
      const y = rng() * 256;
      const r = 8 + rng() * 20;
      ctx.fillStyle = rng() > 0.48 ? 'rgba(176, 245, 114, 0.30)' : 'rgba(110, 198, 72, 0.22)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tiny subtle grass blades
    ctx.strokeStyle = 'rgba(196, 252, 134, 0.42)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 45; i++) {
      const x = rng() * 256;
      const y = rng() * 256;
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x + (rng() - 0.5) * 4, y - 4);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  });
}

export function getPondWaterTexture() {
  return cached('pond_water', () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    const g = ctx.createRadialGradient(128, 128, 18, 128, 128, 132);
    g.addColorStop(0, '#5cebf7');
    g.addColorStop(0.65, '#34d4e6');
    g.addColorStop(1, '#24bfd4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(232, 254, 255, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(108, 102, 26, 0.2, 2.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(154, 152, 18, 3.3, 5.4);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}

export function getDummyFaceTexture() {
  return cached('dummy_face', () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    // Smooth untextured light-gray R6 Roblox dummy tone
    ctx.fillStyle = '#d3dbe5';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle classic Roblox dummy face centered at U = 0.5 (which wraps to +Z)
    const cx = 128;
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.ellipse(cx - 17, 112, 5.4, 7.6, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 17, 112, 5.4, 7.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, 124, 16, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}
