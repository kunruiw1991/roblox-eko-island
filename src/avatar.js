/**
 * Authentic Smooth Untextured Light-Gray Roblox R6 Dummy Avatar for eko Beta Test.
 * - Classic R6 proportions: legs 0.38x0.72x0.38, torso 0.78x0.78x0.40,
 *   arms 0.38x0.72x0.38, rounded-top cylinder head.
 * - Feet rest cleanly at local y = 0; +Z is forward.
 * - Strict PBR compliance: metalness <= 0.22, roughness >= 0.28.
 */

import * as THREE from '../vendor/three.module.min.js';
import { GeomBatcher, safeStdMat } from './geom_utils.js';
import { getDummyFaceTexture } from './textures.js';

let _assets = null;

function buildAssets() {
  if (_assets) return _assets;

  const bodyMat = safeStdMat({
    vertexColors: true,
    roughness: 0.56,
    metalness: 0.05,
  });

  const headMat = safeStdMat({
    map: getDummyFaceTexture(),
    roughness: 0.52,
    metalness: 0.05,
  });

  // Classic untextured light-gray Roblox Dummy shades
  const lightGray = 0xd3dbe5;
  const midGray = 0xc5cfd9;
  const jointGray = 0xb4bfcc;
  const legGray = 0xbfc9d6;

  // Torso (0.78 x 0.78 x 0.40) centered at 0
  const torsoBatch = new GeomBatcher();
  torsoBatch.box(0.78, 0.78, 0.40, 0, 0, 0, midGray);
  torsoBatch.box(0.72, 0.06, 0.36, 0, -0.37, 0, jointGray);
  const torsoGeo = torsoBatch.build();

  // Arm (0.38 x 0.72 x 0.38) hanging down from shoulder pivot at y = 0
  const armBatch = new GeomBatcher();
  armBatch.box(0.38, 0.72, 0.38, 0, -0.32, 0, lightGray);
  armBatch.box(0.35, 0.05, 0.35, 0, 0.02, 0, jointGray);
  const armGeo = armBatch.build();

  // Leg (0.38 x 0.72 x 0.38) hanging down from hip pivot at y = 0 -> sole at y = -0.72
  const legBatch = new GeomBatcher();
  legBatch.box(0.38, 0.72, 0.38, 0, -0.36, 0, legGray);
  legBatch.box(0.38, 0.07, 0.39, 0, -0.685, 0.005, jointGray);
  const legGeo = legBatch.build();

  // Classic Roblox rounded-top cylinder head (face centered at +Z via UV offset)
  const headGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.46, 18);
  // Rotate so Cylinder seam is at -Z and U=0.5 faces +Z cleanly!
  // CylinderGeometry starts theta=0 at +Z (U=0) and wraps CCW -> U=0.5 is -Z.
  // Rotating by PI puts U=0.5 directly at +Z!
  headGeo.rotateY(Math.PI);
  headGeo.translate(0, 0.27, 0);

  // Soft contact shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.56, 20);
  shadowGeo.rotateX(-Math.PI * 0.5);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x1e3a4c,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });

  _assets = {
    bodyMat,
    headMat,
    torsoGeo,
    armGeo,
    legGeo,
    headGeo,
    shadowGeo,
    shadowMat,
  };
  return _assets;
}

export function createR6Dummy() {
  const a = buildAssets();
  const group = new THREE.Group();
  group.name = 'r6_dummy';

  // Contact shadow
  const shadow = new THREE.Mesh(a.shadowGeo, a.shadowMat);
  shadow.position.y = 0.025;
  group.add(shadow);

  // Character body root (for bounce/spin emote without displacing shadow)
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  // Legs
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.20, 0.72, 0);
  const leftLeg = new THREE.Mesh(a.legGeo, a.bodyMat);
  leftLeg.castShadow = true;
  leftLeg.receiveShadow = true;
  leftLegPivot.add(leftLeg);
  bodyRoot.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.20, 0.72, 0);
  const rightLeg = new THREE.Mesh(a.legGeo, a.bodyMat);
  rightLeg.castShadow = true;
  rightLeg.receiveShadow = true;
  rightLegPivot.add(rightLeg);
  bodyRoot.add(rightLegPivot);

  // Torso
  const torso = new THREE.Mesh(a.torsoGeo, a.bodyMat);
  torso.position.set(0, 1.11, 0);
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyRoot.add(torso);

  // Arms
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.59, 1.46, 0);
  const leftArm = new THREE.Mesh(a.armGeo, a.bodyMat);
  leftArm.castShadow = true;
  leftArm.receiveShadow = true;
  leftArmPivot.add(leftArm);
  bodyRoot.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.59, 1.46, 0);
  const rightArm = new THREE.Mesh(a.armGeo, a.bodyMat);
  rightArm.castShadow = true;
  rightArm.receiveShadow = true;
  rightArmPivot.add(rightArm);
  bodyRoot.add(rightArmPivot);

  // Head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.50, 0);
  const head = new THREE.Mesh(a.headGeo, a.headMat);
  head.castShadow = true;
  head.receiveShadow = true;
  headPivot.add(head);
  bodyRoot.add(headPivot);

  return {
    group,
    bodyRoot,
    shadow,
    headPivot,
    torso,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    _walkPhase: 0,
  };
}

export function animateR6Dummy(
  rig,
  { speed = 0, airborne = false, emoteTimer = 0, heightAboveGround = 0, dt = 0.016, time = 0 } = {}
) {
  if (!rig) return;
  const clampedDt = Math.min(Math.max(dt || 0.016, 0), 0.1);
  const moveFactor = Math.min(1, Math.max(0, speed / 6.8));

  if (moveFactor > 0.04) {
    rig._walkPhase = (rig._walkPhase || 0) + clampedDt * (7.5 + moveFactor * 5.2);
  } else {
    rig._walkPhase = (rig._walkPhase || 0) * Math.max(0, 1 - clampedDt * 8);
  }

  const phase = rig._walkPhase || 0;
  const swing = Math.sin(phase) * 0.78 * moveFactor;
  const walkBob = Math.abs(Math.sin(phase)) * 0.05 * moveFactor;
  const idleBreath = Math.sin(time * 2.5) * 0.012;

  if (emoteTimer > 0) {
    const p = 1 - Math.min(1, emoteTimer / 1.15);
    const hop = Math.sin(p * Math.PI) * 0.42;
    rig.bodyRoot.position.y = hop;
    rig.bodyRoot.rotation.y = p * Math.PI * 2;
    rig.rightArmPivot.rotation.x = -2.65;
    rig.rightArmPivot.rotation.z = -0.35 + Math.sin(time * 20) * 0.36;
    rig.leftArmPivot.rotation.x = -0.5;
    rig.leftArmPivot.rotation.z = 0.32;
    rig.leftLegPivot.rotation.x = -0.18 * Math.sin(p * Math.PI);
    rig.rightLegPivot.rotation.x = 0.18 * Math.sin(p * Math.PI);
    rig.headPivot.rotation.z = Math.sin(time * 14) * 0.12;
  } else if (airborne) {
    rig.bodyRoot.position.y = 0;
    rig.bodyRoot.rotation.y = 0;
    rig.leftArmPivot.rotation.x = -2.35;
    rig.rightArmPivot.rotation.x = -2.35;
    rig.leftArmPivot.rotation.z = 0.18;
    rig.rightArmPivot.rotation.z = -0.18;
    rig.leftLegPivot.rotation.x = 0.34;
    rig.rightLegPivot.rotation.x = -0.26;
    rig.headPivot.rotation.z = 0;
  } else {
    rig.bodyRoot.position.y = walkBob + idleBreath;
    rig.bodyRoot.rotation.y = 0;
    rig.leftArmPivot.rotation.x = -swing;
    rig.rightArmPivot.rotation.x = swing;
    rig.leftArmPivot.rotation.z = 0.04;
    rig.rightArmPivot.rotation.z = -0.04;
    rig.leftLegPivot.rotation.x = swing;
    rig.rightLegPivot.rotation.x = -swing;
    rig.headPivot.rotation.z = Math.sin(phase) * 0.03 * moveFactor;
  }

  // Keep shadow anchored near ground surface and fade gently when jumping
  const sScale = Math.max(0.45, 1 - Math.max(0, heightAboveGround) * 0.2);
  rig.shadow.position.y = Math.max(-heightAboveGround + 0.03, -2.5);
  rig.shadow.scale.set(sScale, sScale, sScale);
}
