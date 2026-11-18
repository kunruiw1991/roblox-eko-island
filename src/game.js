/**
 * Core Game Engine for eko Beta Test.
 * - Hex-grid island terraforming & modular cozy cottage/flora sandbox (Build Mode).
 * - Contextual radial prop editing (Rotate, Duplicate, Recolor, Delete).
 * - 8 pre-sculpted starter island presets (Presets 1-8) + 40-step Undo + localStorage auto-save.
 * - 1-tap 3rd-Person R6 Dummy Explorer (Walk Mode) with hill auto-stepping, jumping, pond splashes,
 *   joyful emote, and strict zero-runaway camera-relative controls.
 */

import * as THREE from '../vendor/three.module.min.js';
import {
  COLOR_SWATCH_NAMES,
  DEFAULT_PROP_COLOR_IDX,
  HEX_RADIUS,
  LEVEL_HEIGHT,
  MAX_ELEVATION,
  OCEAN_Y,
  PROP_COLOR_PALETTES,
  PROP_TYPES,
  TILE_LIMIT,
  getNeighbors,
  getTileSurfaceY,
  hexDistance,
  hexKey,
  hexToWorld,
  inGrid,
  worldToHex,
} from './hex.js';
import { PRESET_META, buildPresetData } from './presets.js';
import { EkoWorld } from './world.js';
import { animateR6Dummy, createR6Dummy } from './avatar.js';
import { EkoAudioManager } from './audio.js';
import { createRng } from './rng.js';

export const SAVE_KEY = 'roblox_eko_island_save';
const MAX_UNDO = 40;

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _proj = new THREE.Vector3();

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class EkoGame {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = new EkoAudioManager();
    this.rng = createRng(202607);

    // Three.js WebGL2 Renderer (clean boot without eager shader pre-compilation)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.25, 260);
    this.camera.rotation.order = 'YXZ';

    this.world = new EkoWorld(this.scene);

    // R6 Dummy Avatar (visible only in Walk Mode)
    this.avatarRig = createR6Dummy();
    this.avatarRig.group.visible = false;
    this.scene.add(this.avatarRig.group);

    // Island Data
    this.tiles = new Map(); // hexKey -> { q, r, elevation: 1..5, type: 'land'|'water' }
    this.props = new Map(); // hexKey -> { q, r, type, rotDeg, colorIdx }
    this.undoStack = [];
    this.activePresetId = 1;

    // Mode & Tools
    this.mode = 'build'; // 'build' | 'walk'
    this.activeTool = 'land'; // 'land' | 'raise' | 'lower' | 'pond' | 'oak' | 'pine' | 'bush' | 'rock' | 'cottage'
    this.hoverHex = null; // { q, r } | null
    this.selectedPropKey = null; // hexKey | null (opens contextual radial menu)

    // Settings matching video ground truth
    this.settings = {
      rotationSnap: 60, // 15 | 60
      randomRotation: true,
      shadows: true,
      clouds: true,
      windLines: true,
    };

    // Camera Orbit & Pan State (framed so vibrant cyan sky & fluffy clouds shine above the island!)
    this.camYaw = 0.68;
    this.camPitch = 0.36;
    this.camZoomScale = 1.0;
    this.camFocusX = 0;
    this.camFocusY = 1.85;
    this.camFocusZ = 0;
    this._curCamX = 0;
    this._curCamY = 18;
    this._curCamZ = 22;
    this._curLookX = 0;
    this._curLookY = 1;
    this._curLookZ = 0;
    this.manualOrbitDragging = false;

    // R6 Walk Mode Player State
    this.player = {
      x: 0,
      y: LEVEL_HEIGHT,
      z: 0,
      vy: 0,
      yaw: 0,
      speed: 0,
      grounded: true,
      jumpQueued: false,
      emoteTimer: 0,
      inWater: false,
      splashCooldown: 0,
      jumps: 0,
      emotes: 0,
    };

    // Live Input State
    this.keys = new Set();
    this.touchInput = { x: 0, z: 0 };
    this.testInput = { x: 0, z: 0 };

    // Time & loop tracking
    this.elapsed = 0;
    this._lastRafMs = 0;
    this._rafId = 0;

    // Load saved island or default Preset 1
    if (!this._loadSave()) {
      this._applyPresetInternal(1, false);
    }

    this.world.applySettings(this.settings);
    this.resize();
    this._snapCameraImmediate();
    this.world.syncIsland(this.tiles, this.props, {
      activeTool: this.activeTool,
      hoverHex: this.hoverHex,
      selectedHex: this._getSelectedHex(),
      mode: this.mode,
    });
    this._syncUiAll();
    this.render();
    this._startLoop();
  }

  _startLoop() {
    const tick = (nowMs) => {
      this._rafId = requestAnimationFrame(tick);
      if (!this._lastRafMs) this._lastRafMs = nowMs;
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - this._lastRafMs) / 1000));
      this._lastRafMs = nowMs;
      this.step(dt, 1);
      this.render();
    };
    this._rafId = requestAnimationFrame(tick);
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1280);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight || 800);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.ui.syncTouchVisibility(this.mode);
    this._updateRadialPosition();
  }

  // ---------------- SAVE & UNDO ----------------
  getTileCount() {
    return this.tiles.size + this.props.size;
  }

  _snapshotState() {
    return {
      tiles: Array.from(this.tiles.values()).map((t) => ({ ...t })),
      props: Array.from(this.props.values()).map((p) => ({ ...p })),
      activePresetId: this.activePresetId,
    };
  }

  _pushUndo() {
    this.undoStack.push(this._snapshotState());
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  undo() {
    if (this.undoStack.length === 0) {
      this.ui.showToast('Nothing to undo');
      return false;
    }
    const snap = this.undoStack.pop();
    this.selectedPropKey = null;
    this._restoreSnapshot(snap);
    this.audio.playHexLower();
    this._save();
    this._syncUiAll();
    this.ui.showToast('Undid last change');
    return true;
  }

  _restoreSnapshot(snap) {
    this.tiles.clear();
    this.props.clear();
    for (const t of snap.tiles || []) {
      if (inGrid(t.q, t.r) && t.elevation > 0) {
        this.tiles.set(hexKey(t.q, t.r), {
          q: t.q,
          r: t.r,
          elevation: clamp(Math.round(t.elevation), 1, MAX_ELEVATION),
          type: t.type === 'water' ? 'water' : 'land',
        });
      }
    }
    for (const p of snap.props || []) {
      const k = hexKey(p.q, p.r);
      const t = this.tiles.get(k);
      if (t && t.type === 'land' && PROP_TYPES.includes(p.type)) {
        this.props.set(k, {
          q: p.q,
          r: p.r,
          type: p.type,
          rotDeg: ((Number(p.rotDeg) || 0) % 360 + 360) % 360,
          colorIdx: clamp(Math.round(Number(p.colorIdx) || 0), 0, 4),
        });
      }
    }
    if (snap.activePresetId) this.activePresetId = snap.activePresetId;
  }

  _save() {
    try {
      const payload = {
        v: 1,
        activePresetId: this.activePresetId,
        tiles: Array.from(this.tiles.values()),
        props: Array.from(this.props.values()),
        settings: { ...this.settings },
        audio: { musicOn: this.audio.musicOn, sfxOn: this.audio.sfxOn },
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors in restricted sandboxes
    }
  }

  _loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tiles) || data.tiles.length === 0) return false;
      this._restoreSnapshot(data);
      if (data.settings) {
        this.settings.rotationSnap = data.settings.rotationSnap === 15 ? 15 : 60;
        this.settings.randomRotation = Boolean(data.settings.randomRotation);
        this.settings.shadows = data.settings.shadows !== false;
        this.settings.clouds = data.settings.clouds !== false;
        this.settings.windLines = data.settings.windLines !== false;
      }
      if (data.audio) {
        this.audio.setMusicOn(data.audio.musicOn !== false);
        this.audio.setSfxOn(data.audio.sfxOn !== false);
      }
      return true;
    } catch {
      return false;
    }
  }

  resetSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {}
    this.undoStack = [];
    this.settings = {
      rotationSnap: 60,
      randomRotation: true,
      shadows: true,
      clouds: true,
      windLines: true,
    };
    this.world.applySettings(this.settings);
    this.setMode('build');
    this.selectTool('land');
    this._applyPresetInternal(1, false);
    this.resetCameraPivot();
    this._snapCameraImmediate();
    this._save();
    this._syncUiAll();
    this.ui.showToast('Starter Meadow Cove restored!');
    return true;
  }

  clearIsland() {
    this._pushUndo();
    this.selectedPropKey = null;
    this._applyPresetInternal(8, true);
    if (this.mode === 'walk') {
      if (this.tiles.size > 0) {
        this._placePlayerOnSafeHex();
      } else {
        this.setMode('build');
      }
    }
    this.ui.showToast('Canvas cleared — start sculpting!');
    return true;
  }

  // ---------------- PRESETS ----------------
  loadPreset(presetId) {
    const id = clamp(Math.round(Number(presetId) || 1), 1, 8);
    this._pushUndo();
    this.selectedPropKey = null;
    this._applyPresetInternal(id, true);
    this.audio.playPresetChime();
    const meta = PRESET_META.find((m) => m.id === id);
    this.ui.showToast(`Loaded Preset ${id}: ${meta ? meta.name : 'Island'}`);
    if (this.mode === 'walk') {
      this._placePlayerOnSafeHex();
    }
    return true;
  }

  _applyPresetInternal(id, triggerPops = true) {
    const data = buildPresetData(id);
    this.activePresetId = id;
    this._restoreSnapshot({ ...data, activePresetId: id });
    if (triggerPops) {
      for (const t of this.tiles.values()) {
        this.world.triggerTilePop(t.q, t.r);
      }
      for (const p of this.props.values()) {
        this.world.triggerPropPop(p.q, p.r);
      }
    }
    this._save();
    this._syncUiAll();
  }

  // ---------------- TOOLS & TERRAFORMING ----------------
  selectTool(toolId) {
    const valid = ['land', 'raise', 'lower', 'pond', 'oak', 'pine', 'bush', 'rock', 'cottage'];
    if (!valid.includes(toolId)) return false;
    this.activeTool = toolId;
    if (this.selectedPropKey && (toolId === 'lower' || toolId === 'pond' || toolId === 'raise')) {
      this.selectedPropKey = null;
    }
    this.audio.playClick();
    this._syncUiAll();
    return true;
  }

  getHex(q, r) {
    const k = hexKey(q, r);
    const tile = this.tiles.get(k) || null;
    const prop = this.props.get(k) || null;
    return {
      q,
      r,
      tile: tile ? { ...tile } : null,
      prop: prop ? { ...prop } : null,
    };
  }

  _getSelectedHex() {
    if (!this.selectedPropKey) return null;
    const p = this.props.get(this.selectedPropKey);
    return p ? { q: p.q, r: p.r } : null;
  }

  tapHex(q, r, { fromPropHit = false } = {}) {
    if (this.mode !== 'build') return false;
    if (!inGrid(q, r)) return false;

    const k = hexKey(q, r);
    const tile = this.tiles.get(k) || null;
    const prop = this.props.get(k) || null;
    const { x, z } = hexToWorld(q, r);

    // Clicking an existing placed prop with a prop tool (or Land tool on already-land tile) opens Contextual Radial Menu!
    const isPropTool = PROP_TYPES.includes(this.activeTool);
    if (prop && (fromPropHit || isPropTool || this.activeTool === 'land')) {
      this.selectedPropKey = k;
      this.audio.playClick();
      this._syncUiAll();
      this._updateRadialPosition();
      return true;
    }

    // Dismiss radial menu when performing a fresh edit elsewhere
    if (this.selectedPropKey) {
      this.selectedPropKey = null;
    }

    // 1. Hex Land Tool: expand island into ocean (or convert pond back to grass!)
    if (this.activeTool === 'land') {
      if (!tile) {
        if (this.getTileCount() >= TILE_LIMIT) {
          this.ui.showToast(`Tile limit reached (${TILE_LIMIT})`);
          return false;
        }
        this._pushUndo();
        this.tiles.set(k, { q, r, elevation: 1, type: 'land' });
        this.world.triggerTilePop(q, r);
        this.world.spawnPoof(x, LEVEL_HEIGHT, z, 0xa8f074, 8);
        this.audio.playHexPop(1);
        this._save();
        this._syncUiAll();
        return true;
      }
      if (tile.type === 'water') {
        this._pushUndo();
        tile.type = 'land';
        this.world.triggerTilePop(q, r);
        this.world.spawnPoof(x, tile.elevation * LEVEL_HEIGHT, z, 0xa8f074, 7);
        this.audio.playHexPop(tile.elevation);
        this._save();
        this._syncUiAll();
        return true;
      }
      // Already bare land: gently raise 1 level up to 2 so tapping twice feels rewarding
      if (tile.elevation < MAX_ELEVATION) {
        this._pushUndo();
        tile.elevation += 1;
        this.world.triggerTilePop(q, r);
        this.world.spawnPoof(x, tile.elevation * LEVEL_HEIGHT, z, 0xf2e4c8, 7);
        this.audio.playHexPop(tile.elevation);
        this._save();
        this._syncUiAll();
        return true;
      }
      return false;
    }

    // 2. Cliff + Tool: raise hill / cliff 1..5 (or create level 1 land on ocean)
    if (this.activeTool === 'raise') {
      if (!tile) {
        if (this.getTileCount() >= TILE_LIMIT) {
          this.ui.showToast(`Tile limit reached (${TILE_LIMIT})`);
          return false;
        }
        this._pushUndo();
        this.tiles.set(k, { q, r, elevation: 1, type: 'land' });
        this.world.triggerTilePop(q, r);
        this.world.spawnPoof(x, LEVEL_HEIGHT, z, 0xf2e4c8, 8);
        this.audio.playHexPop(1);
        this._save();
        this._syncUiAll();
        return true;
      }
      if (tile.elevation >= MAX_ELEVATION) {
        this.ui.showToast('Max cliff height (5)');
        return false;
      }
      this._pushUndo();
      tile.elevation += 1;
      this.world.triggerTilePop(q, r);
      if (prop) this.world.triggerPropPop(q, r);
      this.world.spawnPoof(x, tile.elevation * LEVEL_HEIGHT, z, 0xf0dfc0, 8);
      this.audio.playHexPop(tile.elevation);
      this._save();
      this._syncUiAll();
      return true;
    }

    // 3. Lower / Erase Tool: remove prop first, otherwise lower elevation down to ocean (0)
    if (this.activeTool === 'lower') {
      if (prop) {
        this._pushUndo();
        const py = tile ? tile.elevation * LEVEL_HEIGHT + 0.6 : 1.0;
        this.props.delete(k);
        this.world.spawnPoof(x, py, z, 0xffffff, 10);
        this.audio.playDelete();
        this._save();
        this._syncUiAll();
        return true;
      }
      if (!tile) return false;
      if (this.tiles.size <= 1 && tile.elevation <= 1) {
        this.ui.showToast('Keep at least 1 island tile!');
        return false;
      }
      this._pushUndo();
      const oldY = tile.elevation * LEVEL_HEIGHT;
      if (tile.type === 'water' && tile.elevation > 1) {
        tile.elevation -= 1;
        this.world.triggerTilePop(q, r);
      } else if (tile.elevation > 1) {
        tile.elevation -= 1;
        this.world.triggerTilePop(q, r);
      } else {
        this.tiles.delete(k);
      }
      this.world.spawnPoof(x, oldY, z, 0xd8f3ff, 8);
      this.audio.playHexLower();
      this._save();
      this._syncUiAll();
      return true;
    }

    // 4. Water / Pond Tool: carve sparkling turquoise pond inset inside land!
    if (this.activeTool === 'pond') {
      if (!tile) {
        if (this.getTileCount() >= TILE_LIMIT) {
          this.ui.showToast(`Tile limit reached (${TILE_LIMIT})`);
          return false;
        }
        this._pushUndo();
        this.tiles.set(k, { q, r, elevation: 1, type: 'water' });
        this.world.triggerTilePop(q, r);
        this.world.spawnSplash(x, LEVEL_HEIGHT - 0.12, z);
        this.audio.playPondCarve();
        this._save();
        this._syncUiAll();
        return true;
      }
      this._pushUndo();
      if (prop) this.props.delete(k);
      if (tile.type === 'water') {
        tile.type = 'land';
        this.world.triggerTilePop(q, r);
        this.world.spawnPoof(x, tile.elevation * LEVEL_HEIGHT, z, 0xa8f074, 7);
        this.audio.playHexPop(tile.elevation);
      } else {
        tile.type = 'water';
        this.world.triggerTilePop(q, r);
        this.world.spawnSplash(x, tile.elevation * LEVEL_HEIGHT - 0.14, z);
        this.world.spawnPoof(x, tile.elevation * LEVEL_HEIGHT, z, 0x62eef9, 8);
        this.audio.playPondCarve();
      }
      this._save();
      this._syncUiAll();
      return true;
    }

    // 5. Placeable Props & Modular Cottages
    if (isPropTool) {
      if (!tile || tile.type !== 'land') {
        this.ui.showToast('Tap a grassy land tile to place!');
        return false;
      }
      if (this.getTileCount() >= TILE_LIMIT) {
        this.ui.showToast(`Tile limit reached (${TILE_LIMIT})`);
        return false;
      }
      this._pushUndo();
      const snap = this.settings.rotationSnap || 60;
      const steps = Math.max(1, Math.round(360 / snap));
      const rotDeg = this.settings.randomRotation ? this.rng.int(0, steps - 1) * snap : 0;
      const colorIdx = DEFAULT_PROP_COLOR_IDX[this.activeTool] ?? 0;

      this.props.set(k, {
        q,
        r,
        type: this.activeTool,
        rotDeg,
        colorIdx,
      });
      this.world.triggerPropPop(q, r);
      const pal = PROP_COLOR_PALETTES[this.activeTool] || PROP_COLOR_PALETTES.cottage;
      this.world.spawnPoof(x, tile.elevation * LEVEL_HEIGHT + 0.5, z, pal[colorIdx], 9);
      if (this.activeTool === 'cottage') {
        this.audio.playCottagePop();
      } else {
        this.audio.playFloraPop();
      }
      this._save();
      this._syncUiAll();
      return true;
    }

    return false;
  }

  // ---------------- CONTEXTUAL RADIAL MENU ----------------
  openRadialForHex(q, r) {
    const k = hexKey(q, r);
    if (!this.props.has(k)) return false;
    this.selectedPropKey = k;
    this.audio.playClick();
    this._syncUiAll();
    this._updateRadialPosition();
    return true;
  }

  closeRadial() {
    if (!this.selectedPropKey) return false;
    this.selectedPropKey = null;
    this._syncUiAll();
    return true;
  }

  radialAction(action) {
    if (!this.selectedPropKey) return false;
    const prop = this.props.get(this.selectedPropKey);
    const tile = this.tiles.get(this.selectedPropKey);
    if (!prop || !tile) {
      this.selectedPropKey = null;
      this._syncUiAll();
      return false;
    }
    const { x, z } = hexToWorld(prop.q, prop.r);
    const baseY = tile.elevation * LEVEL_HEIGHT;

    if (action === 'rotate') {
      this._pushUndo();
      const step = this.settings.rotationSnap === 15 ? 15 : 60;
      prop.rotDeg = (prop.rotDeg + step) % 360;
      this.world.triggerPropPop(prop.q, prop.r);
      this.audio.playRotate();
      this._save();
      this._syncUiAll();
      return true;
    }

    if (action === 'recolor') {
      this._pushUndo();
      prop.colorIdx = (prop.colorIdx + 1) % 5;
      this.world.triggerPropPop(prop.q, prop.r);
      const pal = PROP_COLOR_PALETTES[prop.type] || PROP_COLOR_PALETTES.cottage;
      this.world.spawnPoof(x, baseY + 0.85, z, pal[prop.colorIdx], 7);
      this.audio.playRecolor();
      this._save();
      this._syncUiAll();
      this.ui.showToast(`Color: ${COLOR_SWATCH_NAMES[prop.colorIdx]}`);
      return true;
    }

    if (action === 'duplicate') {
      if (this.getTileCount() >= TILE_LIMIT) {
        this.ui.showToast(`Tile limit reached (${TILE_LIMIT})`);
        return false;
      }
      // Find nearest open land neighbor hex (search radius 1..4)
      const dest = this._findNearestOpenLandHex(prop.q, prop.r);
      if (!dest) {
        this.ui.showToast('No open land neighbor to duplicate!');
        return false;
      }
      this._pushUndo();
      const dk = hexKey(dest.q, dest.r);
      this.props.set(dk, {
        q: dest.q,
        r: dest.r,
        type: prop.type,
        rotDeg: prop.rotDeg,
        colorIdx: prop.colorIdx,
      });
      this.selectedPropKey = dk;
      const dPos = hexToWorld(dest.q, dest.r);
      const dTile = this.tiles.get(dk);
      this.world.triggerPropPop(dest.q, dest.r);
      const pal = PROP_COLOR_PALETTES[prop.type] || PROP_COLOR_PALETTES.cottage;
      this.world.spawnPoof(dPos.x, dTile.elevation * LEVEL_HEIGHT + 0.55, dPos.z, pal[prop.colorIdx], 9);
      this.audio.playCottagePop();
      this._save();
      this._syncUiAll();
      this._updateRadialPosition();
      return true;
    }

    if (action === 'delete') {
      this._pushUndo();
      this.props.delete(this.selectedPropKey);
      this.selectedPropKey = null;
      this.world.spawnPoof(x, baseY + 0.7, z, 0xffffff, 11);
      this.audio.playDelete();
      this._save();
      this._syncUiAll();
      return true;
    }

    return false;
  }

  _findNearestOpenLandHex(q, r) {
    // Immediate 6 neighbors first
    const nbs = getNeighbors(q, r);
    for (const nb of nbs) {
      const t = this.tiles.get(nb.key);
      if (t && t.type === 'land' && !this.props.has(nb.key)) {
        return { q: nb.q, r: nb.r };
      }
    }
    // Otherwise nearest open land tile anywhere on the island
    let best = null;
    let bestDist = Infinity;
    for (const t of this.tiles.values()) {
      if (t.type !== 'land') continue;
      const k = hexKey(t.q, t.r);
      if (this.props.has(k)) continue;
      const d = hexDistance(t.q, t.r, q, r);
      if (d > 0 && d < bestDist) {
        bestDist = d;
        best = { q: t.q, r: t.r };
      }
    }
    return best;
  }

  // ---------------- SETTINGS ----------------
  setSetting(key, val) {
    if (key === 'rotationSnap') {
      this.settings.rotationSnap = val === 15 ? 15 : 60;
    } else if (key === 'randomRotation') {
      this.settings.randomRotation = Boolean(val);
    } else if (key === 'shadows') {
      this.settings.shadows = Boolean(val);
    } else if (key === 'clouds') {
      this.settings.clouds = Boolean(val);
    } else if (key === 'windLines') {
      this.settings.windLines = Boolean(val);
    } else {
      return false;
    }
    this.world.applySettings(this.settings);
    this.audio.playClick();
    this._save();
    this._syncUiAll();
    return true;
  }

  // ---------------- BUILD <-> 3RD-PERSON R6 WALK MODE ----------------
  toggleMode() {
    return this.setMode(this.mode === 'build' ? 'walk' : 'build');
  }

  setMode(newMode) {
    const target = newMode === 'walk' ? 'walk' : 'build';
    if (target === this.mode) return true;

    // Always reset movement inputs & stick on mode switch (zero-runaway invariant!)
    this.keys.clear();
    this.touchInput.x = 0;
    this.touchInput.z = 0;
    this.testInput.x = 0;
    this.testInput.z = 0;
    this.ui.resetTouchStick();
    this.selectedPropKey = null;
    this.hoverHex = null;

    this.mode = target;
    if (this.mode === 'walk') {
      this._placePlayerOnSafeHex();
      this.avatarRig.group.visible = true;
      this.camPitch = clamp(this.camPitch, 0.24, 0.72);
      this.camZoomScale = clamp(this.camZoomScale, 0.75, 1.35);
      this.audio.playPresetChime();
      this.ui.showToast('Walking Island — Explore as R6 Dummy!');
    } else {
      this.avatarRig.group.visible = false;
      this.camFocusX = clamp(this.player.x * 0.55, -14, 14);
      this.camFocusZ = clamp(this.player.z * 0.55, -14, 14);
      this.camPitch = clamp(this.camPitch, 0.38, 1.02);
      this.audio.playClick();
      this.ui.showToast('Build Mode — Sculpt & decorate!');
    }

    this._syncUiAll();
    return true;
  }

  _placePlayerOnSafeHex() {
    let best = null;
    let bestScore = Infinity;
    for (const t of this.tiles.values()) {
      if (t.elevation <= 0) continue;
      const k = hexKey(t.q, t.r);
      const hasProp = this.props.has(k);
      const isWater = t.type === 'water';
      const dist = hexDistance(t.q, t.r, 0, 0);
      const score = dist + (hasProp ? 12 : 0) + (isWater ? 4 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (!best) {
      this.tiles.set(hexKey(0, 0), { q: 0, r: 0, elevation: 1, type: 'land' });
      best = this.tiles.get(hexKey(0, 0));
    }
    const { x, z } = hexToWorld(best.q, best.r);
    const y = getTileSurfaceY(best);
    this.player.x = x;
    this.player.y = y;
    this.player.z = z;
    this.player.vy = 0;
    this.player.speed = 0;
    this.player.grounded = true;
    this.player.jumpQueued = false;
    this.player.emoteTimer = 0;
    this.player.inWater = best.type === 'water';
    this.avatarRig.group.position.set(x, y, z);
    this.avatarRig.group.rotation.y = this.player.yaw;
  }

  queueJump() {
    if (this.mode !== 'walk') return false;
    this.player.jumpQueued = true;
    return true;
  }

  triggerEmote() {
    if (this.mode !== 'walk') return false;
    this.player.emoteTimer = 1.15;
    this.player.emotes += 1;
    this.audio.playEmote();
    this.world.spawnPoof(this.player.x, this.player.y + 1.5, this.player.z, 0xffe066, 6);
    return true;
  }

  setInput(x, z) {
    this.testInput.x = clamp(Number(x) || 0, -1, 1);
    this.testInput.z = clamp(Number(z) || 0, -1, 1);
  }

  // ---------------- CAMERA CONTROLS ----------------
  setCameraOrbit(yaw, pitch) {
    this.camYaw = wrapAngle(yaw);
    const minPitch = this.mode === 'walk' ? 0.16 : 0.24;
    const maxPitch = this.mode === 'walk' ? 1.12 : 1.32;
    this.camPitch = clamp(pitch, minPitch, maxPitch);
  }

  setCameraZoom(scale) {
    this.camZoomScale = clamp(scale, 0.52, 1.85);
  }

  setCameraFocus(x, z) {
    this.camFocusX = clamp(Number(x) || 0, -18, 18);
    this.camFocusZ = clamp(Number(z) || 0, -18, 18);
  }

  panCameraByScreenDelta(dxPx, dyPx) {
    if (this.mode !== 'build') return;
    const speed = 0.036 * this.camZoomScale;
    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);
    // Screen right = (cosY, -sinY), Screen down = (sinY, cosY)
    const moveX = (-dxPx * cosY - dyPx * sinY) * speed;
    const moveZ = (dxPx * sinY - dyPx * cosY) * speed;
    this.setCameraFocus(this.camFocusX + moveX, this.camFocusZ + moveZ);
  }

  resetCameraPivot() {
    this.camYaw = 0.68;
    this.camPitch = this.mode === 'walk' ? 0.30 : 0.36;
    this.camZoomScale = 1.0;
    this.camFocusX = 0;
    this.camFocusZ = 0;
    this.audio.playClick();
  }

  _snapCameraImmediate() {
    this._updateCamera(1.0);
  }

  _updateCamera(lerpAlpha) {
    let targetX;
    let targetY;
    let targetZ;
    let dist;

    if (this.mode === 'walk') {
      targetX = this.player.x;
      targetY = this.player.y + 1.48;
      targetZ = this.player.z;
      dist = 10.6 * this.camZoomScale;
    } else {
      targetX = this.camFocusX;
      targetY = this.camFocusY;
      targetZ = this.camFocusZ;
      dist = 24.0 * this.camZoomScale;
    }

    const horiz = Math.cos(this.camPitch) * dist;
    const desiredX = targetX + Math.sin(this.camYaw) * horiz;
    const desiredY = Math.max(1.2, targetY + Math.sin(this.camPitch) * dist);
    const desiredZ = targetZ + Math.cos(this.camYaw) * horiz;

    if (lerpAlpha >= 0.999) {
      this._curCamX = desiredX;
      this._curCamY = desiredY;
      this._curCamZ = desiredZ;
      this._curLookX = targetX;
      this._curLookY = targetY;
      this._curLookZ = targetZ;
    } else {
      this._curCamX += (desiredX - this._curCamX) * lerpAlpha;
      this._curCamY += (desiredY - this._curCamY) * lerpAlpha;
      this._curCamZ += (desiredZ - this._curCamZ) * lerpAlpha;
      this._curLookX += (targetX - this._curLookX) * lerpAlpha;
      this._curLookY += (targetY - this._curLookY) * lerpAlpha;
      this._curLookZ += (targetZ - this._curLookZ) * lerpAlpha;
    }

    this.camera.position.set(this._curCamX, this._curCamY, this._curCamZ);
    this.camera.lookAt(this._curLookX, this._curLookY, this._curLookZ);
    // Zero roll invariant
    this.camera.rotation.z = 0;
  }

  // ---------------- RAYCASTING & POINTER INTERACTION ----------------
  _pickHexFromScreen(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, this.camera);
    const ro = _raycaster.ray.origin;
    const rd = _raycaster.ray.direction;

    let bestHit = null;
    let bestT = Infinity;

    const hitVertCylinder = (cx, cz, yMin, yMax, rad) => {
      // Intersect top cap plane y = yMax
      let minHitT = Infinity;
      if (Math.abs(rd.y) > 1e-5) {
        const tTop = (yMax - ro.y) / rd.y;
        if (tTop > 0.1) {
          const hx = ro.x + rd.x * tTop - cx;
          const hz = ro.z + rd.z * tTop - cz;
          if (hx * hx + hz * hz <= rad * rad) {
            minHitT = Math.min(minHitT, tTop);
          }
        }
      }
      // Intersect vertical side cylinder
      const ox = ro.x - cx;
      const oz = ro.z - cz;
      const a = rd.x * rd.x + rd.z * rd.z;
      if (a > 1e-6) {
        const b = 2 * (ox * rd.x + oz * rd.z);
        const c = ox * ox + oz * oz - rad * rad;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          const t0 = (-b - sq) / (2 * a);
          const t1 = (-b + sq) / (2 * a);
          for (const tc of [t0, t1]) {
            if (tc > 0.1 && tc < minHitT) {
              const hy = ro.y + rd.y * tc;
              if (hy >= yMin && hy <= yMax) {
                minHitT = tc;
              }
            }
          }
        }
      }
      return minHitT;
    };

    // 1. Check Props (so tapping a cottage roof or oak canopy directly hits its hex!)
    for (const prop of this.props.values()) {
      const tile = this.tiles.get(hexKey(prop.q, prop.r));
      if (!tile || tile.elevation <= 0) continue;
      const { x, z } = hexToWorld(prop.q, prop.r);
      const baseY = tile.elevation * LEVEL_HEIGHT;
      const h = prop.type === 'pine' ? 2.4 : prop.type === 'oak' ? 2.2 : prop.type === 'cottage' ? 1.9 : 0.9;
      const rad = prop.type === 'cottage' ? 0.96 : 0.84;
      const t = hitVertCylinder(x, z, baseY, baseY + h, rad);
      if (t < bestT) {
        bestT = t;
        bestHit = { q: prop.q, r: prop.r, hitProp: true };
      }
    }

    // 2. Check Hex Terrain Columns
    for (const tile of this.tiles.values()) {
      if (tile.elevation <= 0) continue;
      const { x, z } = hexToWorld(tile.q, tile.r);
      const topY = tile.elevation * LEVEL_HEIGHT;
      const t = hitVertCylinder(x, z, OCEAN_Y, topY, HEX_RADIUS * 0.95);
      if (t < bestT) {
        bestT = t;
        bestHit = { q: tile.q, r: tile.r, hitProp: false };
      }
    }

    // 3. Ocean plane fallback (y = 0)
    if (Math.abs(rd.y) > 1e-5) {
      const tOcean = (OCEAN_Y - ro.y) / rd.y;
      if (tOcean > 0.1 && tOcean < bestT) {
        const ox = ro.x + rd.x * tOcean;
        const oz = ro.z + rd.z * tOcean;
        const hr = worldToHex(ox, oz);
        if (inGrid(hr.q, hr.r)) {
          bestHit = { q: hr.q, r: hr.r, hitProp: false };
        }
      }
    }

    return bestHit;
  }

  updateHoverFromPointer(clientX, clientY) {
    if (this.mode !== 'build' || this.ui.activeModal) {
      this.hoverHex = null;
      return;
    }
    const hit = this._pickHexFromScreen(clientX, clientY);
    this.hoverHex = hit ? { q: hit.q, r: hit.r } : null;
  }

  handleCanvasClick(clientX, clientY) {
    if (this.ui.activeModal) return;
    if (this.mode !== 'build') return;
    const hit = this._pickHexFromScreen(clientX, clientY);
    if (!hit) {
      if (this.selectedPropKey) this.closeRadial();
      return;
    }
    this.tapHex(hit.q, hit.r, { fromPropHit: hit.hitProp });
  }

  projectHexToScreen(q, r) {
    const rect = this.canvas.getBoundingClientRect();
    const k = hexKey(q, r);
    const tile = this.tiles.get(k);
    const { x, z } = hexToWorld(q, r);
    const y = tile && tile.elevation > 0 ? getTileSurfaceY(tile) + (this.props.has(k) ? 0.6 : 0.0) : OCEAN_Y;
    _proj.set(x, y, z).project(this.camera);
    return {
      x: rect.left + (_proj.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-_proj.y * 0.5 + 0.5) * rect.height,
      inFront: _proj.z >= -1 && _proj.z <= 1,
    };
  }

  _updateRadialPosition() {
    if (!this.selectedPropKey || this.mode !== 'build') {
      this.ui.hideRadialMenu();
      return;
    }
    const prop = this.props.get(this.selectedPropKey);
    const tile = this.tiles.get(this.selectedPropKey);
    if (!prop || !tile) {
      this.selectedPropKey = null;
      this.ui.hideRadialMenu();
      return;
    }
    const { x, z } = hexToWorld(prop.q, prop.r);
    const y = tile.elevation * LEVEL_HEIGHT + 1.05;
    _proj.set(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.left + (_proj.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-_proj.y * 0.5 + 0.5) * rect.height;
    this.ui.showRadialMenu(sx, sy, prop);
  }

  // ---------------- WALK MODE PHYSICS ----------------
  _getMoveInput() {
    let ix = this.testInput.x + this.touchInput.x;
    let iz = this.testInput.z + this.touchInput.z;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    return { ix, iz, mag: Math.min(1, len) };
  }

  _sampleGroundAt(wx, wz) {
    const h = worldToHex(wx, wz);
    if (!inGrid(h.q, h.r)) return { walkable: false, y: OCEAN_Y, isWater: false, tile: null };
    const tile = this.tiles.get(hexKey(h.q, h.r));
    if (!tile || tile.elevation <= 0) {
      return { walkable: false, y: OCEAN_Y, isWater: false, tile: null };
    }
    return {
      walkable: true,
      y: getTileSurfaceY(tile),
      isWater: tile.type === 'water',
      tile,
    };
  }

  _hitsCottage(wx, wz) {
    const h = worldToHex(wx, wz);
    const k = hexKey(h.q, h.r);
    const p = this.props.get(k);
    if (p && p.type === 'cottage') {
      const pos = hexToWorld(h.q, h.r);
      return Math.hypot(wx - pos.x, wz - pos.z) < 0.72;
    }
    return false;
  }

  _stepWalkMode(dt) {
    const p = this.player;
    // Safety guard: never strand the R6 dummy over empty ocean
    const curGround = this._sampleGroundAt(p.x, p.z);
    if (!curGround.walkable) {
      if (this.tiles.size > 0) {
        this._placePlayerOnSafeHex();
      } else {
        this.setMode('build');
        return;
      }
    }
    const { ix, iz, mag } = this._getMoveInput();

    if (p.emoteTimer > 0) {
      p.emoteTimer = Math.max(0, p.emoteTimer - dt);
    }

    // Jump trigger
    if (p.jumpQueued) {
      p.jumpQueued = false;
      if (p.grounded) {
        p.vy = 9.9;
        p.grounded = false;
        p.jumps += 1;
        this.audio.playJump();
        this.world.spawnPoof(p.x, p.y + 0.1, p.z, 0xe8f9d6, 5);
      }
    }

    // Camera-relative horizontal velocity — ZERO automatic camYaw changes!
    const maxSpeed = p.inWater ? 4.6 : 6.6;
    if (mag > 0.05) {
      const sinY = Math.sin(this.camYaw);
      const cosY = Math.cos(this.camYaw);
      // Forward = (-sinY, -cosY), Right = (cosY, -sinY)
      const moveX = ix * cosY + iz * sinY;
      const moveZ = -ix * sinY + iz * cosY;
      const mLen = Math.hypot(moveX, moveZ) || 1;
      const dirX = moveX / mLen;
      const dirZ = moveZ / mLen;

      const stepDist = maxSpeed * mag * dt;
      const canMoveTo = (nx, nz) => {
        const g = this._sampleGroundAt(nx, nz);
        if (!g.walkable) return false;
        // Allow stepping smoothly across <= 1 level; block sheer >= 2-level cliff unless jumping over it!
        if (g.y - p.y > LEVEL_HEIGHT + 0.14) return false;
        if (this._hitsCottage(nx, nz) && p.y < g.y + 1.4) return false;
        return true;
      };

      const nx = p.x + dirX * stepDist;
      const nz = p.z + dirZ * stepDist;
      let moved = false;
      if (canMoveTo(nx, nz)) {
        p.x = nx;
        p.z = nz;
        moved = true;
      } else if (canMoveTo(nx, p.z)) {
        p.x = nx;
        moved = true;
      } else if (canMoveTo(p.x, nz)) {
        p.z = nz;
        moved = true;
      }

      p.speed = moved ? maxSpeed * mag : 0;
      const targetYaw = Math.atan2(dirX, dirZ);
      const diff = wrapAngle(targetYaw - p.yaw);
      p.yaw = wrapAngle(p.yaw + diff * Math.min(1, dt * 14));
    } else {
      p.speed = 0;
    }

    // Vertical gravity & smooth auto-step on tiered hexes
    const ground = this._sampleGroundAt(p.x, p.z);
    const groundY = ground.walkable ? ground.y : OCEAN_Y;
    p.inWater = ground.isWater;

    if (!p.grounded) {
      p.vy -= 22.5 * dt;
      p.y += p.vy * dt;
      if (p.y <= groundY) {
        p.y = groundY;
        p.vy = 0;
        p.grounded = true;
        if (p.inWater) {
          this.world.spawnSplash(p.x, groundY, p.z);
          this.audio.playSplash();
        }
      }
    } else {
      const diff = groundY - p.y;
      if (diff > 0.01 && diff <= LEVEL_HEIGHT + 0.16) {
        // Effortless smooth auto-step up 1-tier hex hill!
        p.y = Math.min(groundY, p.y + Math.max(diff * 16, 4.5) * dt);
      } else if (diff < -0.18) {
        // Walked off a cliff edge -> fall smoothly down!
        p.grounded = false;
        p.vy = 0;
      } else {
        p.y = groundY;
      }
    }

    // Pond wading splashes!
    if (p.splashCooldown > 0) p.splashCooldown -= dt;
    if (p.inWater && p.grounded && p.speed > 0.6 && p.splashCooldown <= 0) {
      this.world.spawnSplash(p.x, groundY, p.z);
      this.audio.playSplash();
      p.splashCooldown = 0.28;
    }

    // Update R6 dummy rig transform & limb animation
    this.avatarRig.group.position.set(p.x, p.y, p.z);
    this.avatarRig.group.rotation.y = p.yaw;
    animateR6Dummy(this.avatarRig, {
      speed: p.speed,
      airborne: !p.grounded,
      emoteTimer: p.emoteTimer,
      heightAboveGround: Math.max(0, p.y - groundY),
      dt,
      time: this.elapsed,
    });
  }

  // ---------------- FIXED SIMULATION STEP & RENDER ----------------
  step(dt = 1 / 60, n = 1) {
    const steps = Math.max(1, Math.min(3000, Math.round(n)));
    const stepDt = Math.min(0.05, Math.max(0.001, dt));
    for (let i = 0; i < steps; i++) {
      this.elapsed += stepDt;
      this.audio.stepMusic(stepDt);
      this.ui.tick(stepDt);

      if (this.mode === 'walk') {
        this._stepWalkMode(stepDt);
      }
      this._updateCamera(Math.min(1, stepDt * 11));
      this.world.update(stepDt, this.tiles, this.props, {
        activeTool: this.activeTool,
        hoverHex: this.hoverHex,
        selectedHex: this._getSelectedHex(),
        mode: this.mode,
      });
    }
    this._updateRadialPosition();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  _syncUiAll() {
    this.ui.syncState({
      mode: this.mode,
      activeTool: this.activeTool,
      tileCount: this.getTileCount(),
      tileLimit: TILE_LIMIT,
      activePresetId: this.activePresetId,
      canUndo: this.undoStack.length > 0,
      settings: this.settings,
      audio: this.audio.getState(),
      selectedProp: this.selectedPropKey ? this.props.get(this.selectedPropKey) : null,
    });
    this._updateRadialPosition();
  }

  getState() {
    let maxElevation = 0;
    let pondCount = 0;
    for (const t of this.tiles.values()) {
      if (t.elevation > maxElevation) maxElevation = t.elevation;
      if (t.type === 'water') pondCount++;
    }
    const sel = this.selectedPropKey ? this.props.get(this.selectedPropKey) : null;
    return {
      mode: this.mode,
      activeTool: this.activeTool,
      activePresetId: this.activePresetId,
      landCount: this.tiles.size,
      pondCount,
      propCount: this.props.size,
      tileCount: this.getTileCount(),
      tileLimit: TILE_LIMIT,
      maxElevation,
      undoDepth: this.undoStack.length,
      selectedProp: sel ? { ...sel } : null,
      settings: { ...this.settings },
      player: {
        x: Number(this.player.x.toFixed(3)),
        y: Number(this.player.y.toFixed(3)),
        z: Number(this.player.z.toFixed(3)),
        yaw: Number(this.player.yaw.toFixed(3)),
        speed: Number(this.player.speed.toFixed(3)),
        grounded: this.player.grounded,
        inWater: this.player.inWater,
        jumps: this.player.jumps,
        emotes: this.player.emotes,
      },
      camYaw: Number(this.camYaw.toFixed(4)),
      camPitch: Number(this.camPitch.toFixed(4)),
      camZoomScale: Number(this.camZoomScale.toFixed(4)),
      cameraRotZ: Number(this.camera.rotation.z.toFixed(5)),
      drawCalls: this.renderer.info.render.calls,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }
}
