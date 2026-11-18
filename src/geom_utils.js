import * as THREE from '../vendor/three.module.min.js';

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _v = new THREE.Vector3();
const _nMat = new THREE.Matrix3();

/**
 * Creates a MeshStandardMaterial enforcing pastel cel-friendly PBR bounds:
 * - metalness clamped to [0, 0.22]
 * - roughness clamped to [0.28, 1.0]
 * - pitch-black albedo lifted gently to soft charcoal (#222938)
 */
export function safeStdMat(opts = {}) {
  const safe = { ...opts };
  const rawMetal = typeof safe.metalness === 'number' ? safe.metalness : 0.04;
  const rawRough = typeof safe.roughness === 'number' ? safe.roughness : 0.72;
  safe.metalness = Math.min(0.22, Math.max(0, rawMetal));
  safe.roughness = Math.max(0.28, Math.min(1.0, rawRough));

  if (safe.color !== undefined && safe.color !== null) {
    _color.set(safe.color);
    const lum = 0.2126 * _color.r + 0.7152 * _color.g + 0.0722 * _color.b;
    if (lum < 0.015) {
      _color.setHex(0x222938);
      safe.color = _color.getHex();
    }
  }
  return new THREE.MeshStandardMaterial(safe);
}

/**
 * Lightweight vertex-colored BufferGeometry batcher for low-draw-call pastel props & avatars.
 * Automatically disposes intermediate primitives to prevent GPU memory leaks.
 */
export class GeomBatcher {
  constructor() {
    this._positions = [];
    this._normals = [];
    this._uvs = [];
    this._colors = [];
  }

  add(geo, color = 0xffffff, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const src = geo.index ? geo.toNonIndexed() : geo;
    if (!src.getAttribute('normal')) {
      src.computeVertexNormals();
    }

    _euler.set(rx, ry, rz, 'XYZ');
    _quat.setFromEuler(_euler);
    _pos.set(x, y, z);
    _scale.set(sx, sy, sz);
    _mat4.compose(_pos, _quat, _scale);
    _nMat.getNormalMatrix(_mat4);

    _color.set(color);
    const lum = 0.2126 * _color.r + 0.7152 * _color.g + 0.0722 * _color.b;
    if (lum < 0.015) {
      _color.setHex(0x222938);
    }

    const posAttr = src.getAttribute('position');
    const normAttr = src.getAttribute('normal');
    const uvAttr = src.getAttribute('uv');
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      _v.fromBufferAttribute(posAttr, i).applyMatrix4(_mat4);
      this._positions.push(_v.x, _v.y, _v.z);

      _v.fromBufferAttribute(normAttr, i).applyMatrix3(_nMat).normalize();
      this._normals.push(_v.x, _v.y, _v.z);

      if (uvAttr) {
        this._uvs.push(uvAttr.getX(i), uvAttr.getY(i));
      } else {
        this._uvs.push(0, 0);
      }

      this._colors.push(_color.r, _color.g, _color.b);
    }

    if (src !== geo) {
      src.dispose();
    }
    return this;
  }

  box(w, h, d, x = 0, y = 0, z = 0, color = 0xffffff, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    this.add(geo, color, x, y, z, rx, ry, rz);
    geo.dispose();
    return this;
  }

  cyl(rt, rb, h, segs = 10, x = 0, y = 0, z = 0, color = 0xffffff, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, segs);
    this.add(geo, color, x, y, z, rx, ry, rz);
    geo.dispose();
    return this;
  }

  cone(r, h, segs = 8, x = 0, y = 0, z = 0, color = 0xffffff, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.ConeGeometry(r, h, segs);
    this.add(geo, color, x, y, z, rx, ry, rz);
    geo.dispose();
    return this;
  }

  sphere(r, wSegs = 10, hSegs = 8, x = 0, y = 0, z = 0, color = 0xffffff, sx = 1, sy = 1, sz = 1) {
    const geo = new THREE.SphereGeometry(r, wSegs, hSegs);
    this.add(geo, color, x, y, z, 0, 0, 0, sx, sy, sz);
    geo.dispose();
    return this;
  }

  dodeca(r, x = 0, y = 0, z = 0, color = 0xffffff, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const geo = new THREE.DodecahedronGeometry(r, 0);
    this.add(geo, color, x, y, z, rx, ry, rz, sx, sy, sz);
    geo.dispose();
    return this;
  }

  icosa(r, detail = 0, x = 0, y = 0, z = 0, color = 0xffffff, sx = 1, sy = 1, sz = 1) {
    const geo = new THREE.IcosahedronGeometry(r, detail);
    this.add(geo, color, x, y, z, 0, 0, 0, sx, sy, sz);
    geo.dispose();
    return this;
  }

  build() {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(this._positions, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(this._normals, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(this._uvs, 2));
    out.setAttribute('color', new THREE.Float32BufferAttribute(this._colors, 3));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }
}
