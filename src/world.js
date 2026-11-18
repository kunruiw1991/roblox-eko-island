/**
 * Pastel Cel-Shaded 3D Hex-Grid Island World Renderer for eko Beta Test.
 * - Ultra-low draw calls (~30 total) via pre-allocated InstancedMeshes (zero GPU leaks).
 * - Radius 10 => 331 interactive hex columns with sedimentary cliffs, lime grass caps,
 *   freshwater turquoise ponds, and pulsing coastal foam collars.
 * - Placeable modular props: Oak, Pine, Bush, Rock, Timber Cottage (all recolorable
 *   across 5 cozy pastel palettes, rotatable, with juicy spring-pop animation!).
 */

import * as THREE from '../vendor/three.module.min.js';
import { GeomBatcher, safeStdMat } from './geom_utils.js';
import {
  HEX_RADIUS,
  LEVEL_HEIGHT,
  OCEAN_Y,
  PROP_COLOR_PALETTES,
  getNeighbors,
  getTileSurfaceY,
  hexKey,
  hexToWorld,
} from './hex.js';
import {
  getCliffTexture,
  getGrassTexture,
  getOceanTexture,
  getPondWaterTexture,
  getSkyDomeTexture,
} from './textures.js';
import { createRng } from './rng.js';

const MAX_HEXES = 331;
const MAX_PROPS_PER_TYPE = 331;
const MAX_CLOUDS = 18;
const MAX_WIND = 14;
const MAX_POOFS = 96;
const MAX_SPLASHES = 24;

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _white = new THREE.Color(0xffffff);

function initInstancedMesh(geo, mat, capacity, castShadow = false, receiveShadow = false) {
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Pre-allocate instanceColor once at boot so memory never grows during play
  for (let i = 0; i < capacity; i++) {
    mesh.setColorAt(i, _white);
  }
  mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function createBevelledGrassHexGeo() {
  // Lower straight grass lip + subtle upper bevel cap with clean top planar UVs
  const b = new GeomBatcher();
  const rOuter = HEX_RADIUS * 1.006;
  const rInner = HEX_RADIUS * 0.935;
  const lipH = 0.14;
  const bevelH = 0.09;

  // Lip cylinder
  const lip = new THREE.CylinderGeometry(rOuter, rOuter, lipH, 6);
  lip.translate(0, -lipH * 0.5, 0);
  b.add(lip, 0xffffff);
  lip.dispose();

  // Top bevel frustum
  const bev = new THREE.CylinderGeometry(rInner, rOuter, bevelH, 6);
  bev.translate(0, bevelH * 0.5, 0);
  b.add(bev, 0xffffff);
  bev.dispose();

  const geo = b.build();
  // Assign crisp planar top-down UVs for soft grass texture
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) * 0.28 + 0.5, pos.getZ(i) * 0.28 + 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}

function createPondRimGeo() {
  // 6 cozy trapezoidal stone/grass rim bars framing a recessed turquoise hex pond
  const b = new GeomBatcher();
  const rOuter = HEX_RADIUS * 1.006;
  const rInner = HEX_RADIUS * 0.80;
  const rimW = rOuter - rInner;
  const sideLen = HEX_RADIUS * 1.02;
  const midR = (rOuter + rInner) * 0.5 * (Math.sqrt(3) * 0.5);

  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    const x = Math.sin(angle) * midR;
    const z = Math.cos(angle) * midR;
    // Outer grass curb
    b.box(sideLen, 0.22, rimW * 0.95, x, -0.02, z, 0x8ee05a, 0, angle, 0);
    // Inner cream stone ledge
    const innerR = rInner * (Math.sqrt(3) * 0.5) * 0.96;
    b.box(sideLen * 0.85, 0.26, 0.14, Math.sin(angle) * innerR, -0.10, Math.cos(angle) * innerR, 0xe8d7b9, 0, angle, 0);
  }
  return b.build();
}

function createHexOutlineGeo(radius, innerFactor = 0.89) {
  const b = new GeomBatcher();
  const midR = radius * ((1 + innerFactor) * 0.5) * (Math.sqrt(3) * 0.5);
  const thick = radius * (1 - innerFactor);
  const sideLen = radius * 1.03;
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    b.box(sideLen, 0.05, thick, Math.sin(angle) * midR, 0.03, Math.cos(angle) * midR, 0xffffff, 0, angle, 0);
  }
  return b.build();
}

function createOakGeos() {
  const trunkB = new GeomBatcher();
  trunkB.cyl(0.14, 0.24, 1.05, 8, 0, 0.52, 0, 0x8c5e3c);
  trunkB.cyl(0.08, 0.13, 0.45, 7, 0.18, 0.96, 0.06, 0x825535, 0.15, 0, -0.45);
  trunkB.cyl(0.07, 0.12, 0.40, 7, -0.16, 0.92, -0.08, 0x825535, -0.15, 0, 0.42);
  trunkB.cyl(0.24, 0.34, 0.14, 7, 0, 0.07, 0, 0x7b5133);

  const canopyB = new GeomBatcher();
  // Pure white/soft-shaded puffs so setColorAt tints cleanly into pastel greens/sakura/autumn!
  canopyB.icosa(0.68, 1, 0, 1.56, 0, 0xffffff, 1.05, 0.92, 1.05);
  canopyB.icosa(0.48, 1, 0.44, 1.38, 0.18, 0xf3f7f0, 1.0, 0.88, 1.0);
  canopyB.icosa(0.46, 1, -0.42, 1.42, -0.16, 0xedf2ea, 1.0, 0.90, 1.0);
  canopyB.icosa(0.42, 1, 0.08, 1.44, -0.42, 0xf6faf3, 0.98, 0.86, 0.98);
  canopyB.icosa(0.40, 1, -0.12, 1.88, 0.14, 0xffffff, 1.06, 0.80, 1.06);

  return { trunkGeo: trunkB.build(), canopyGeo: canopyB.build() };
}

function createPineGeos() {
  const trunkB = new GeomBatcher();
  trunkB.cyl(0.11, 0.19, 0.85, 7, 0, 0.42, 0, 0x7c5134);

  const canopyB = new GeomBatcher();
  canopyB.cone(0.76, 0.95, 7, 0, 1.02, 0, 0xe8f0e8, 0, 0, 0);
  canopyB.cone(0.62, 0.92, 7, 0, 1.56, 0, 0xf4f9f4, 0, 0.45, 0);
  canopyB.cone(0.45, 0.86, 7, 0, 2.08, 0, 0xffffff, 0, 0.9, 0);

  return { trunkGeo: trunkB.build(), canopyGeo: canopyB.build() };
}

function createBushGeos() {
  const leavesB = new GeomBatcher();
  leavesB.icosa(0.44, 1, 0, 0.34, 0, 0x7ed95e, 1.15, 0.86, 1.12);
  leavesB.icosa(0.34, 1, 0.36, 0.26, 0.12, 0x70ca54, 1.0, 0.84, 1.0);
  leavesB.icosa(0.32, 1, -0.34, 0.28, -0.14, 0x8ce26b, 1.0, 0.85, 1.0);
  leavesB.icosa(0.28, 1, 0.06, 0.25, -0.34, 0x76cf58, 1.0, 0.84, 1.0);

  const flowersB = new GeomBatcher();
  const pts = [
    [0.14, 0.66, 0.18],
    [-0.22, 0.58, 0.22],
    [0.36, 0.46, 0.26],
    [-0.36, 0.48, -0.18],
    [0.12, 0.54, -0.36],
    [-0.08, 0.68, -0.14],
    [0.32, 0.48, -0.10],
  ];
  for (const [fx, fy, fz] of pts) {
    flowersB.icosa(0.095, 0, fx, fy, fz, 0xffffff, 1, 0.9, 1);
  }
  return { leavesGeo: leavesB.build(), flowersGeo: flowersB.build() };
}

function createRockGeo() {
  const b = new GeomBatcher();
  b.dodeca(0.56, -0.06, 0.34, 0.02, 0xffffff, 0.2, 0.4, 0.1, 1.18, 0.78, 1.05);
  b.dodeca(0.35, 0.46, 0.22, 0.22, 0xf2ece2, -0.3, 0.8, 0.2, 1.08, 0.76, 0.96);
  b.dodeca(0.28, -0.44, 0.18, -0.26, 0xe8e1d5, 0.4, -0.5, 0.3, 1.0, 0.74, 1.12);
  return b.build();
}

function createCottageGeos() {
  const baseB = new GeomBatcher();
  const plaster = 0xfaf2e1;
  const timber = 0x7e5335;
  const timberDark = 0x674229;
  const stone = 0xcfc7b8;
  const windowGlow = 0xffe48c;
  const sill = 0xefe4ce;

  // Stone foundation plinth
  baseB.box(1.52, 0.18, 1.28, 0, 0.09, 0, stone);
  // Warm cream plaster cottage walls
  baseB.box(1.38, 0.96, 1.14, 0, 0.66, 0, plaster);
  // Gable attic triangles (inset gently so pitched pastel roof overhangs cleanly)
  baseB.box(1.30, 0.30, 0.64, 0, 1.24, 0, plaster);
  baseB.box(1.30, 0.18, 0.28, 0, 1.44, 0, plaster);

  // Corner & horizontal half-timber brown beams
  for (const sx of [-0.67, 0.67]) {
    for (const sz of [-0.55, 0.55]) {
      baseB.box(0.09, 1.02, 0.09, sx, 0.66, sz, timber);
    }
  }
  baseB.box(1.44, 0.08, 1.20, 0, 1.12, 0, timber);
  baseB.box(1.42, 0.07, 1.18, 0, 0.21, 0, timberDark);
  // Center vertical timber ribs
  baseB.box(0.07, 0.92, 0.06, -0.26, 0.66, 0.56, timber);
  baseB.box(0.07, 0.92, 0.06, 0.26, 0.66, 0.56, timber);
  baseB.box(0.07, 0.92, 0.06, 0, 0.66, -0.56, timber);

  // Cozy front wooden door + stone doorstep + warm knob
  baseB.box(0.36, 0.58, 0.07, -0.22, 0.47, 0.565, 0x8f5d3a);
  baseB.box(0.42, 0.06, 0.14, -0.22, 0.16, 0.62, stone);
  baseB.box(0.045, 0.045, 0.05, -0.10, 0.46, 0.60, 0xf4c95d);

  // Warm glowing cottage windows (front right, back, and both sides)
  const addWindow = (wx, wy, wz, ry = 0) => {
    baseB.box(0.34, 0.34, 0.06, wx, wy, wz, timber, 0, ry, 0);
    baseB.box(0.26, 0.26, 0.075, wx, wy, wz, windowGlow, 0, ry, 0);
    baseB.box(0.035, 0.27, 0.085, wx, wy, wz, timber, 0, ry, 0);
    baseB.box(0.27, 0.035, 0.085, wx, wy, wz, timber, 0, ry, 0);
    baseB.box(0.38, 0.055, 0.11, wx, wy - 0.18, wz, sill, 0, ry, 0);
  };
  addWindow(0.32, 0.64, 0.565, 0);
  addWindow(-0.32, 0.66, -0.565, 0);
  addWindow(0.32, 0.66, -0.565, 0);
  addWindow(0.685, 0.66, 0, Math.PI * 0.5);
  addWindow(-0.685, 0.66, 0, Math.PI * 0.5);

  // Cozy stone chimney
  baseB.box(0.28, 0.90, 0.28, 0.44, 1.56, -0.28, stone);
  baseB.box(0.34, 0.08, 0.34, 0.44, 2.02, -0.28, 0xbab1a1);
  baseB.box(0.20, 0.04, 0.20, 0.44, 2.06, -0.28, 0x3b4454);

  // Roof geometry (white vertex color -> tinted cleanly via setColorAt!)
  const roofB = new GeomBatcher();
  // Two thick cozy pitched roof planes overhanging walls
  roofB.box(1.66, 0.14, 0.92, 0, 1.38, 0.34, 0xffffff, 0.62, 0, 0);
  roofB.box(1.66, 0.14, 0.92, 0, 1.38, -0.34, 0xf2f2f2, -0.62, 0, 0);
  // Crisp ridge cap beam
  roofB.box(1.70, 0.15, 0.18, 0, 1.66, 0, 0xfafafa);
  // Little front awning / porch hood over door
  roofB.box(0.52, 0.08, 0.30, -0.22, 0.84, 0.68, 0xf6f6f6, 0.36, 0, 0);

  return { baseGeo: baseB.build(), roofGeo: roofB.build() };
}

function createCloudGeo() {
  const b = new GeomBatcher();
  b.sphere(1.35, 10, 8, 0, 0.25, 0, 0xffffff, 1.28, 0.72, 1.0);
  b.sphere(1.02, 10, 8, -1.25, 0.08, 0.15, 0xf7fcff, 1.12, 0.66, 0.94);
  b.sphere(0.98, 10, 8, 1.28, 0.10, -0.10, 0xf5fbff, 1.10, 0.64, 0.92);
  b.sphere(0.86, 9, 7, 0.45, 0.62, 0.16, 0xffffff, 1.0, 0.72, 0.92);
  b.sphere(0.74, 9, 7, -0.52, 0.52, -0.20, 0xf9fdff, 1.0, 0.70, 0.90);
  return b.build();
}

export class EkoWorld {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    this.settings = {
      shadows: true,
      clouds: true,
      windLines: true,
    };

    // Spring animation state per hexKey: { t, dur }
    this._tileAnims = new Map();
    this._propAnims = new Map();

    // Pools for particles
    this._poofs = [];
    this._splashes = [];
    this._cloudSeeds = [];
    this._windSeeds = [];

    this._buildAtmosphere();
    this._buildTerrainMeshes();
    this._buildPropMeshes();
    this._buildAmbientDetails();
    this._buildParticleMeshes();
  }

  _buildAtmosphere() {
    this.scene.background = new THREE.Color(0x52ccf6);
    this.scene.fog = new THREE.Fog(0x9ee8fa, 52, 138);

    // Vibrant pastel cyan sky dome
    const skyGeo = new THREE.SphereGeometry(165, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: getSkyDomeTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.name = 'sky_dome';
    this.scene.add(this.skyDome);

    // Cozy pastel daylight lighting
    this.hemiLight = new THREE.HemisphereLight(0xe6f9ff, 0x7fc46e, 1.05);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7e2, 1.35);
    this.sunLight.position.set(24, 38, 22);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 96;
    const d = 28;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0007;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0xbbeeff, 0.38);
    this.rimLight.position.set(-22, 16, -24);
    this.scene.add(this.rimLight);

    // Sunlit deep turquoise ocean plane
    this.oceanTex = getOceanTexture();
    const oceanGeo = new THREE.PlaneGeometry(290, 290);
    oceanGeo.rotateX(-Math.PI * 0.5);
    const oceanMat = safeStdMat({
      map: this.oceanTex,
      color: 0xffffff,
      roughness: 0.34,
      metalness: 0.08,
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.position.y = OCEAN_Y;
    this.oceanMesh.receiveShadow = true;
    this.oceanMesh.name = 'ocean_plane';
    this.scene.add(this.oceanMesh);
  }

  _buildTerrainMeshes() {
    // Sedimentary cream/tan cliff column (unit height 0..1)
    const cliffGeo = new THREE.CylinderGeometry(HEX_RADIUS * 0.994, HEX_RADIUS * 0.998, 1.0, 6);
    cliffGeo.translate(0, 0.5, 0);
    const cliffMat = safeStdMat({
      map: getCliffTexture(),
      roughness: 0.80,
      metalness: 0.02,
    });
    this.cliffInst = initInstancedMesh(cliffGeo, cliffMat, MAX_HEXES, true, true);
    this.cliffInst.name = 'hex_cliffs';
    this.scene.add(this.cliffInst);

    // Bevelled soft lime-green grass cap
    const grassGeo = createBevelledGrassHexGeo();
    const grassMat = safeStdMat({
      map: getGrassTexture(),
      roughness: 0.72,
      metalness: 0.02,
    });
    this.grassInst = initInstancedMesh(grassGeo, grassMat, MAX_HEXES, true, true);
    this.grassInst.name = 'hex_grass_caps';
    this.scene.add(this.grassInst);

    // Carved freshwater pond rim + sparkling turquoise water inset
    const pondRimGeo = createPondRimGeo();
    const pondRimMat = safeStdMat({
      vertexColors: true,
      roughness: 0.74,
      metalness: 0.02,
    });
    this.pondRimInst = initInstancedMesh(pondRimGeo, pondRimMat, MAX_HEXES, true, true);
    this.pondRimInst.name = 'hex_pond_rims';
    this.scene.add(this.pondRimInst);

    const pondWaterGeo = new THREE.CylinderGeometry(HEX_RADIUS * 0.84, HEX_RADIUS * 0.84, 0.12, 6);
    const pondWaterMat = safeStdMat({
      map: getPondWaterTexture(),
      roughness: 0.28,
      metalness: 0.10,
    });
    this.pondWaterInst = initInstancedMesh(pondWaterGeo, pondWaterMat, MAX_HEXES, false, true);
    this.pondWaterInst.name = 'hex_pond_water';
    this.scene.add(this.pondWaterInst);

    // Pulsing coastal sea-foam hex collar around shoreline tiles
    const foamGeo = new THREE.CylinderGeometry(HEX_RADIUS * 1.135, HEX_RADIUS * 1.155, 0.04, 6);
    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xe6fbff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    this.foamInst = initInstancedMesh(foamGeo, foamMat, MAX_HEXES, false, false);
    this.foamInst.name = 'coastal_foam';
    this.scene.add(this.foamInst);

    // Subtle ocean expansion guide rings (shown when Hex Land tool is active)
    const guideGeo = createHexOutlineGeo(HEX_RADIUS * 0.94, 0.91);
    const guideMat = new THREE.MeshBasicMaterial({
      color: 0xeaffff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.guideInst = initInstancedMesh(guideGeo, guideMat, 140, false, false);
    this.guideInst.name = 'ocean_expand_guides';
    this.scene.add(this.guideInst);

    // Crisp active hover / selected hex ring
    const hoverGeo = createHexOutlineGeo(HEX_RADIUS * 1.03, 0.87);
    const hoverMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.hoverRing = new THREE.Mesh(hoverGeo, hoverMat);
    this.hoverRing.visible = false;
    this.hoverRing.name = 'hex_hover_ring';
    this.scene.add(this.hoverRing);
  }

  _buildPropMeshes() {
    const vtxMat = safeStdMat({ vertexColors: true, roughness: 0.66, metalness: 0.04 });
    const tintMat = safeStdMat({ vertexColors: true, roughness: 0.62, metalness: 0.04 });

    const oak = createOakGeos();
    this.oakTrunkInst = initInstancedMesh(oak.trunkGeo, vtxMat, MAX_PROPS_PER_TYPE, true, true);
    this.oakCanopyInst = initInstancedMesh(oak.canopyGeo, tintMat, MAX_PROPS_PER_TYPE, true, true);
    this.oakTrunkInst.name = 'props_oak_trunks';
    this.oakCanopyInst.name = 'props_oak_canopies';

    const pine = createPineGeos();
    this.pineTrunkInst = initInstancedMesh(pine.trunkGeo, vtxMat, MAX_PROPS_PER_TYPE, true, true);
    this.pineCanopyInst = initInstancedMesh(pine.canopyGeo, tintMat, MAX_PROPS_PER_TYPE, true, true);
    this.pineTrunkInst.name = 'props_pine_trunks';
    this.pineCanopyInst.name = 'props_pine_canopies';

    const bush = createBushGeos();
    this.bushLeavesInst = initInstancedMesh(bush.leavesGeo, vtxMat, MAX_PROPS_PER_TYPE, true, true);
    this.bushFlowersInst = initInstancedMesh(bush.flowersGeo, tintMat, MAX_PROPS_PER_TYPE, true, true);
    this.bushLeavesInst.name = 'props_bush_leaves';
    this.bushFlowersInst.name = 'props_bush_flowers';

    const rockGeo = createRockGeo();
    this.rockInst = initInstancedMesh(rockGeo, tintMat, MAX_PROPS_PER_TYPE, true, true);
    this.rockInst.name = 'props_rocks';

    const cot = createCottageGeos();
    this.cottageBaseInst = initInstancedMesh(cot.baseGeo, vtxMat, MAX_PROPS_PER_TYPE, true, true);
    this.cottageRoofInst = initInstancedMesh(cot.roofGeo, tintMat, MAX_PROPS_PER_TYPE, true, true);
    this.cottageBaseInst.name = 'props_cottage_bases';
    this.cottageRoofInst.name = 'props_cottage_roofs';

    this.scene.add(
      this.oakTrunkInst,
      this.oakCanopyInst,
      this.pineTrunkInst,
      this.pineCanopyInst,
      this.bushLeavesInst,
      this.bushFlowersInst,
      this.rockInst,
      this.cottageBaseInst,
      this.cottageRoofInst
    );
  }

  _buildAmbientDetails() {
    const rng = createRng(8842);

    // Fluffy pastel cartoon clouds drifting softly across the cyan sky
    const cloudGeo = createCloudGeo();
    const cloudMat = safeStdMat({
      vertexColors: true,
      roughness: 0.90,
      metalness: 0.0,
      emissive: 0xdff6ff,
      emissiveIntensity: 0.16,
    });
    this.cloudInst = initInstancedMesh(cloudGeo, cloudMat, MAX_CLOUDS, false, false);
    this.cloudInst.name = 'cartoon_clouds';
    this.cloudInst.count = MAX_CLOUDS;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const ang = (i / MAX_CLOUDS) * Math.PI * 2 + rng.range(-0.14, 0.14);
      const radius = rng.range(30, 62);
      this._cloudSeeds.push({
        x: Math.cos(ang) * radius,
        y: rng.range(8.5, 14.5),
        z: Math.sin(ang) * radius,
        scale: rng.range(1.35, 2.55),
        rotY: rng.range(0, Math.PI * 2),
        speed: rng.range(0.42, 1.05),
        bobPhase: rng.range(0, Math.PI * 2),
      });
    }
    this.scene.add(this.cloudInst);

    // Cozy stylized breeze wind lines (toggleable in Settings)
    const windGeo = new THREE.BoxGeometry(2.5, 0.026, 0.04);
    const windMat = new THREE.MeshBasicMaterial({
      color: 0xf4fdff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.windInst = initInstancedMesh(windGeo, windMat, MAX_WIND, false, false);
    this.windInst.name = 'wind_lines';
    this.windInst.count = MAX_WIND;
    for (let i = 0; i < MAX_WIND; i++) {
      this._windSeeds.push({
        x: rng.range(-28, 28),
        y: rng.range(4.2, 9.6),
        z: rng.range(-24, 24),
        speed: rng.range(3.2, 5.4),
        len: rng.range(0.75, 1.4),
        phase: rng.range(0, Math.PI * 2),
      });
    }
    this.scene.add(this.windInst);
  }

  _buildParticleMeshes() {
    const poofGeo = new THREE.IcosahedronGeometry(0.24, 1);
    const poofMat = safeStdMat({
      color: 0xffffff,
      roughness: 0.76,
      metalness: 0.0,
    });
    this.poofInst = initInstancedMesh(poofGeo, poofMat, MAX_POOFS, false, false);
    this.poofInst.name = 'poof_particles';
    this.scene.add(this.poofInst);

    const splashGeo = new THREE.RingGeometry(0.26, 0.44, 16);
    splashGeo.rotateX(-Math.PI * 0.5);
    const splashMat = new THREE.MeshBasicMaterial({
      color: 0xe6fbff,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.splashInst = initInstancedMesh(splashGeo, splashMat, MAX_SPLASHES, false, false);
    this.splashInst.name = 'water_splash_rings';
    this.scene.add(this.splashInst);
  }

  applySettings(settings) {
    this.settings.shadows = Boolean(settings.shadows);
    this.settings.clouds = Boolean(settings.clouds);
    this.settings.windLines = Boolean(settings.windLines);

    this.sunLight.castShadow = this.settings.shadows;
    this.cloudInst.visible = this.settings.clouds;
    this.windInst.visible = this.settings.windLines;
  }

  triggerTilePop(q, r) {
    this._tileAnims.set(hexKey(q, r), { t: 0, dur: 0.42 });
  }

  triggerPropPop(q, r) {
    this._propAnims.set(hexKey(q, r), { t: 0, dur: 0.45 });
  }

  spawnPoof(x, y, z, hexColor = 0xffffff, count = 8) {
    for (let i = 0; i < count; i++) {
      if (this._poofs.length >= MAX_POOFS) this._poofs.shift();
      const ang = (i / count) * Math.PI * 2 + (this.time * 3.1 + i) * 0.37;
      const spd = 1.1 + ((i * 7) % 5) * 0.32;
      this._poofs.push({
        x: x + Math.cos(ang) * 0.25,
        y: y + 0.15,
        z: z + Math.sin(ang) * 0.25,
        vx: Math.cos(ang) * spd,
        vy: 1.8 + ((i * 3) % 4) * 0.45,
        vz: Math.sin(ang) * spd,
        age: 0,
        life: 0.48 + ((i * 5) % 4) * 0.08,
        size: 0.75 + ((i * 11) % 5) * 0.14,
        color: hexColor,
      });
    }
  }

  spawnSplash(x, y, z) {
    if (this._splashes.length >= MAX_SPLASHES) this._splashes.shift();
    this._splashes.push({ x, y: y + 0.06, z, age: 0, life: 0.58 });
  }

  _springScale(anim) {
    if (!anim) return 1.0;
    const p = Math.min(1, anim.t / anim.dur);
    if (p >= 1) return 1.0;
    // Bouncy Townscaper overshoot spring curve
    return 1.0 + 0.32 * Math.exp(-6.5 * p) * Math.sin(p * Math.PI * 2.5);
  }

  /**
   * Synchronizes all InstancedMeshes cleanly from current island state (zero allocations).
   */
  syncIsland(tilesMap, propsMap, { activeTool = 'land', hoverHex = null, selectedHex = null, mode = 'build' } = {}) {
    let cliffIdx = 0;
    let grassIdx = 0;
    let pondRimIdx = 0;
    let pondWaterIdx = 0;
    let foamIdx = 0;

    // 1. Hex Columns, Grass Caps, Ponds & Coastal Foam
    for (const tile of tilesMap.values()) {
      if (!tile || tile.elevation <= 0) continue;
      const key = hexKey(tile.q, tile.r);
      const { x, z } = hexToWorld(tile.q, tile.r);
      const anim = this._tileAnims.get(key);
      const syBounce = this._springScale(anim);

      const isWater = tile.type === 'water';
      const topY = tile.elevation * LEVEL_HEIGHT;
      const colHeight = (isWater ? Math.max(0.22, topY - 0.18) : Math.max(0.24, topY - 0.14)) + 0.38;

      // Cliff sedimentary body
      _dummy.position.set(x, -0.38, z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, colHeight * syBounce, 1);
      _dummy.updateMatrix();
      this.cliffInst.setMatrixAt(cliffIdx, _dummy.matrix);
      // Warm cream-tan subtle shade by elevation
      const shade = 0.94 + Math.min(4, tile.elevation - 1) * 0.018;
      _color.setRGB(shade, shade * 0.985, shade * 0.955);
      this.cliffInst.setColorAt(cliffIdx, _color);
      cliffIdx++;

      if (isWater) {
        // Recessed turquoise pond basin
        _dummy.position.set(x, topY * syBounce, z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, syBounce, 1);
        _dummy.updateMatrix();
        this.pondRimInst.setMatrixAt(pondRimIdx, _dummy.matrix);
        this.pondRimInst.setColorAt(pondRimIdx, _white);
        pondRimIdx++;

        const shimmer = Math.sin(this.time * 2.4 + tile.q * 0.9 + tile.r * 1.1) * 0.016;
        _dummy.position.set(x, topY * syBounce - 0.21 + shimmer, z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        this.pondWaterInst.setMatrixAt(pondWaterIdx, _dummy.matrix);
        this.pondWaterInst.setColorAt(pondWaterIdx, _white);
        pondWaterIdx++;
      } else {
        // Bevelled pastel lime-green grass cap
        _dummy.position.set(x, topY * syBounce - 0.04, z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(1, syBounce, 1);
        _dummy.updateMatrix();
        this.grassInst.setMatrixAt(grassIdx, _dummy.matrix);
        // Subtle playful sunlit tile-to-tile pastel variation
        const hash = Math.abs((tile.q * 37 + tile.r * 17) % 5);
        const gTint = [0xffffff, 0xf7ffea, 0xeeffde, 0xfbffec, 0xe8f9d6][hash];
        _color.setHex(gTint);
        this.grassInst.setColorAt(grassIdx, _color);
        grassIdx++;
      }

      // Coastal foam ring if bordering ocean
      const nbs = getNeighbors(tile.q, tile.r);
      let isCoastal = nbs.length < 6;
      if (!isCoastal) {
        for (let i = 0; i < nbs.length; i++) {
          const nt = tilesMap.get(nbs[i].key);
          if (!nt || nt.elevation <= 0) {
            isCoastal = true;
            break;
          }
        }
      }
      if (isCoastal && foamIdx < MAX_HEXES) {
        const pulse = 1.0 + Math.sin(this.time * 2.1 + tile.q * 0.7 + tile.r * 0.5) * 0.036;
        _dummy.position.set(x, OCEAN_Y + 0.045, z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(pulse, 1, pulse);
        _dummy.updateMatrix();
        this.foamInst.setMatrixAt(foamIdx, _dummy.matrix);
        foamIdx++;
      }
    }

    this.cliffInst.count = cliffIdx;
    this.grassInst.count = grassIdx;
    this.pondRimInst.count = pondRimIdx;
    this.pondWaterInst.count = pondWaterIdx;
    this.foamInst.count = foamIdx;

    this.cliffInst.instanceMatrix.needsUpdate = true;
    this.cliffInst.instanceColor.needsUpdate = true;
    this.grassInst.instanceMatrix.needsUpdate = true;
    this.grassInst.instanceColor.needsUpdate = true;
    this.pondRimInst.instanceMatrix.needsUpdate = true;
    this.pondWaterInst.instanceMatrix.needsUpdate = true;
    this.foamInst.instanceMatrix.needsUpdate = true;

    // 2. Ocean expansion guide rings when Hex Land tool is active in Build Mode
    let guideIdx = 0;
    if (mode === 'build' && activeTool === 'land') {
      const seen = new Set();
      for (const tile of tilesMap.values()) {
        if (!tile || tile.elevation <= 0) continue;
        const nbs = getNeighbors(tile.q, tile.r);
        for (let i = 0; i < nbs.length; i++) {
          const nb = nbs[i];
          if (seen.has(nb.key) || tilesMap.has(nb.key)) continue;
          seen.add(nb.key);
          if (guideIdx >= 140) break;
          const pos = hexToWorld(nb.q, nb.r);
          _dummy.position.set(pos.x, OCEAN_Y + 0.06, pos.z);
          _dummy.rotation.set(0, 0, 0);
          _dummy.scale.set(1, 1, 1);
          _dummy.updateMatrix();
          this.guideInst.setMatrixAt(guideIdx, _dummy.matrix);
          guideIdx++;
        }
      }
    }
    this.guideInst.count = guideIdx;
    this.guideInst.instanceMatrix.needsUpdate = true;

    // 3. Active Hover / Selected Hex Highlight Ring
    const targetHex = mode === 'build' ? (selectedHex || hoverHex) : null;
    if (targetHex) {
      const t = tilesMap.get(hexKey(targetHex.q, targetHex.r));
      const { x, z } = hexToWorld(targetHex.q, targetHex.r);
      const y = t && t.elevation > 0 ? getTileSurfaceY(t) + 0.07 : OCEAN_Y + 0.08;
      this.hoverRing.position.set(x, y, z);
      this.hoverRing.material.color.setHex(selectedHex ? 0xffe066 : 0xffffff);
      this.hoverRing.visible = true;
    } else {
      this.hoverRing.visible = false;
    }

    // 4. Modular Props & Cottages
    let oakIdx = 0;
    let pineIdx = 0;
    let bushIdx = 0;
    let rockIdx = 0;
    let cotIdx = 0;

    for (const prop of propsMap.values()) {
      const key = hexKey(prop.q, prop.r);
      const tile = tilesMap.get(key);
      if (!tile || tile.elevation <= 0 || tile.type !== 'land') continue;

      const { x, z } = hexToWorld(prop.q, prop.r);
      const tileBounce = this._springScale(this._tileAnims.get(key));
      const propBounce = this._springScale(this._propAnims.get(key));
      const baseY = tile.elevation * LEVEL_HEIGHT * tileBounce;
      const rotRad = ((prop.rotDeg || 0) * Math.PI) / 180;
      const palette = PROP_COLOR_PALETTES[prop.type] || PROP_COLOR_PALETTES.cottage;
      const tintHex = palette[(prop.colorIdx || 0) % palette.length];
      _color.setHex(tintHex);

      // Gentle breeze sway on trees
      const sway =
        prop.type === 'oak' || prop.type === 'pine'
          ? Math.sin(this.time * 1.8 + prop.q * 0.7 + prop.r * 0.9) * 0.032
          : 0;

      _dummy.position.set(x, baseY, z);
      _dummy.rotation.set(sway, rotRad, sway * 0.6);
      const sXZ = 1 + (propBounce - 1) * 0.35;
      _dummy.scale.set(sXZ, propBounce, sXZ);
      _dummy.updateMatrix();

      if (prop.type === 'oak' && oakIdx < MAX_PROPS_PER_TYPE) {
        this.oakTrunkInst.setMatrixAt(oakIdx, _dummy.matrix);
        this.oakCanopyInst.setMatrixAt(oakIdx, _dummy.matrix);
        this.oakCanopyInst.setColorAt(oakIdx, _color);
        oakIdx++;
      } else if (prop.type === 'pine' && pineIdx < MAX_PROPS_PER_TYPE) {
        this.pineTrunkInst.setMatrixAt(pineIdx, _dummy.matrix);
        this.pineCanopyInst.setMatrixAt(pineIdx, _dummy.matrix);
        this.pineCanopyInst.setColorAt(pineIdx, _color);
        pineIdx++;
      } else if (prop.type === 'bush' && bushIdx < MAX_PROPS_PER_TYPE) {
        this.bushLeavesInst.setMatrixAt(bushIdx, _dummy.matrix);
        this.bushFlowersInst.setMatrixAt(bushIdx, _dummy.matrix);
        this.bushFlowersInst.setColorAt(bushIdx, _color);
        bushIdx++;
      } else if (prop.type === 'rock' && rockIdx < MAX_PROPS_PER_TYPE) {
        this.rockInst.setMatrixAt(rockIdx, _dummy.matrix);
        this.rockInst.setColorAt(rockIdx, _color);
        rockIdx++;
      } else if (prop.type === 'cottage' && cotIdx < MAX_PROPS_PER_TYPE) {
        this.cottageBaseInst.setMatrixAt(cotIdx, _dummy.matrix);
        this.cottageRoofInst.setMatrixAt(cotIdx, _dummy.matrix);
        this.cottageRoofInst.setColorAt(cotIdx, _color);
        cotIdx++;
      }
    }

    this.oakTrunkInst.count = oakIdx;
    this.oakCanopyInst.count = oakIdx;
    this.pineTrunkInst.count = pineIdx;
    this.pineCanopyInst.count = pineIdx;
    this.bushLeavesInst.count = bushIdx;
    this.bushFlowersInst.count = bushIdx;
    this.rockInst.count = rockIdx;
    this.cottageBaseInst.count = cotIdx;
    this.cottageRoofInst.count = cotIdx;

    const mark = (m, hasCol = false) => {
      m.instanceMatrix.needsUpdate = true;
      if (hasCol) m.instanceColor.needsUpdate = true;
    };
    mark(this.oakTrunkInst);
    mark(this.oakCanopyInst, true);
    mark(this.pineTrunkInst);
    mark(this.pineCanopyInst, true);
    mark(this.bushLeavesInst);
    mark(this.bushFlowersInst, true);
    mark(this.rockInst, true);
    mark(this.cottageBaseInst);
    mark(this.cottageRoofInst, true);
  }

  update(dt, tilesMap, propsMap, syncOpts) {
    const clampedDt = Math.min(Math.max(dt || 0.016, 0), 0.1);
    this.time += clampedDt;

    // Gentle sunlit ocean ripple drift
    this.oceanTex.offset.x = (this.time * 0.022) % 1;
    this.oceanTex.offset.y = (this.time * 0.014) % 1;

    // Advance tile & prop spring animations
    for (const [k, anim] of this._tileAnims) {
      anim.t += clampedDt;
      if (anim.t >= anim.dur) this._tileAnims.delete(k);
    }
    for (const [k, anim] of this._propAnims) {
      anim.t += clampedDt;
      if (anim.t >= anim.dur) this._propAnims.delete(k);
    }

    // Drift fluffy cartoon clouds
    if (this.settings.clouds) {
      for (let i = 0; i < MAX_CLOUDS; i++) {
        const c = this._cloudSeeds[i];
        c.x += c.speed * clampedDt;
        if (c.x > 85) c.x = -85;
        const bob = Math.sin(this.time * 0.6 + c.bobPhase) * 0.45;
        _dummy.position.set(c.x, c.y + bob, c.z);
        _dummy.rotation.set(0, c.rotY, 0);
        _dummy.scale.set(c.scale, c.scale, c.scale);
        _dummy.updateMatrix();
        this.cloudInst.setMatrixAt(i, _dummy.matrix);
      }
      this.cloudInst.instanceMatrix.needsUpdate = true;
    }

    // Drift stylized breeze wind lines
    if (this.settings.windLines) {
      for (let i = 0; i < MAX_WIND; i++) {
        const w = this._windSeeds[i];
        w.x += w.speed * clampedDt;
        if (w.x > 34) w.x = -34;
        const fade = Math.sin(((w.x + 34) / 68) * Math.PI);
        const yBob = Math.sin(this.time * 1.4 + w.phase) * 0.4;
        _dummy.position.set(w.x, w.y + yBob, w.z);
        _dummy.rotation.set(0, 0, Math.cos(this.time * 1.4 + w.phase) * 0.06);
        _dummy.scale.set(w.len * Math.max(0.01, fade), 1, Math.max(0.01, fade));
        _dummy.updateMatrix();
        this.windInst.setMatrixAt(i, _dummy.matrix);
      }
      this.windInst.instanceMatrix.needsUpdate = true;
    }

    // Update poof particles
    let pIdx = 0;
    for (let i = this._poofs.length - 1; i >= 0; i--) {
      const p = this._poofs[i];
      p.age += clampedDt;
      if (p.age >= p.life) {
        this._poofs.splice(i, 1);
        continue;
      }
      p.x += p.vx * clampedDt;
      p.y += p.vy * clampedDt;
      p.z += p.vz * clampedDt;
      p.vy -= 4.2 * clampedDt;
      const frac = p.age / p.life;
      const sc = p.size * Math.sin((1 - frac) * Math.PI * 0.85);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.age * 2, p.age * 3, 0);
      _dummy.scale.set(sc, sc, sc);
      _dummy.updateMatrix();
      this.poofInst.setMatrixAt(pIdx, _dummy.matrix);
      _color.setHex(p.color);
      this.poofInst.setColorAt(pIdx, _color);
      pIdx++;
    }
    this.poofInst.count = pIdx;
    this.poofInst.instanceMatrix.needsUpdate = true;
    this.poofInst.instanceColor.needsUpdate = true;

    // Update water splash rings
    let sIdx = 0;
    for (let i = this._splashes.length - 1; i >= 0; i--) {
      const sp = this._splashes[i];
      sp.age += clampedDt;
      if (sp.age >= sp.life) {
        this._splashes.splice(i, 1);
        continue;
      }
      const frac = sp.age / sp.life;
      const sc = 0.55 + frac * 1.85;
      _dummy.position.set(sp.x, sp.y, sp.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(sc, 1, sc);
      _dummy.updateMatrix();
      this.splashInst.setMatrixAt(sIdx, _dummy.matrix);
      sIdx++;
    }
    this.splashInst.count = sIdx;
    this.splashInst.instanceMatrix.needsUpdate = true;

    // Sync island instanced geometry (fast O(N<=331) zero-allocation update!)
    this.syncIsland(tilesMap, propsMap, syncOpts);
  }
}
