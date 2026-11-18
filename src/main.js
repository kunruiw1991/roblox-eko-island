/**
 * Entry point, input controller, zero-runaway touch/mouse gesture router,
 * and window.__ROBLOX_EKO__ test seam for eko Beta Test.
 */

import { EkoUI } from './ui.js';
import { EkoGame } from './game.js';

const canvas = document.getElementById('game-canvas');
let game = null;

const ui = new EkoUI({
  onSelectTool: (toolId) => game && game.selectTool(toolId),
  onUndo: () => game && game.undo(),
  onLoadPreset: (id) => game && game.loadPreset(id),
  onToggleMode: () => game && game.toggleMode(),
  onResetCamera: () => game && game.resetCameraPivot(),
  onRadialAction: (action) => game && game.radialAction(action),
  onCloseRadial: () => game && game.closeRadial(),
  onToggleSnap: () => {
    if (!game) return;
    game.setSetting('rotationSnap', game.settings.rotationSnap === 15 ? 60 : 15);
  },
  onToggleSetting: (key) => {
    if (!game) return;
    game.setSetting(key, !game.settings[key]);
  },
  onToggleMusic: () => {
    if (!game) return;
    game.audio.unlock();
    game.audio.setMusicOn(!game.audio.musicOn);
    game._save();
    game._syncUiAll();
  },
  onToggleSfx: () => {
    if (!game) return;
    game.audio.unlock();
    game.audio.setSfxOn(!game.audio.sfxOn);
    game._save();
    game._syncUiAll();
  },
  onToggleAudioQuick: () => {
    if (!game) return;
    game.audio.unlock();
    const turnOn = !(game.audio.musicOn || game.audio.sfxOn);
    game.audio.setMusicOn(turnOn);
    game.audio.setSfxOn(turnOn);
    game._save();
    game._syncUiAll();
    ui.showToast(turnOn ? 'Sound ON' : 'Sound Muted', 1.6);
  },
  onClearIsland: () => game && game.clearIsland(),
  onResetSave: () => game && game.resetSave(),
  onTouchMove: (x, z) => {
    if (!game) return;
    game.touchInput.x = x;
    game.touchInput.z = z;
  },
  onTouchJump: () => game && game.queueJump(),
  onTouchWave: () => game && game.triggerEmote(),
  onModalChange: (modal) => {
    if (game && modal) {
      game.keys.clear();
      game.touchInput.x = 0;
      game.touchInput.z = 0;
      game.manualOrbitDragging = false;
      activePointers.clear();
      singlePointerId = null;
      pinchPrevDist = 0;
    }
  },
});

game = new EkoGame(canvas, ui);

// ---------------- IPADOS AUDIO UNLOCK & INSTANT TOUCH AUTO-DETECT ----------------
window.addEventListener(
  'touchstart',
  () => {
    game.audio.unlock();
    ui.notifyTouchPointer();
  },
  { passive: true }
);
window.addEventListener(
  'pointerdown',
  (e) => {
    game.audio.unlock();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      ui.notifyTouchPointer();
    }
  },
  { passive: true, capture: true }
);

// ---------------- KEYBOARD CONTROLS ----------------
const DIGIT_TOOL_MAP = {
  Digit1: 'land',
  Digit2: 'raise',
  Digit3: 'lower',
  Digit4: 'pond',
  Digit5: 'oak',
  Digit6: 'pine',
  Digit7: 'bush',
  Digit8: 'rock',
  Digit9: 'cottage',
};

window.addEventListener('keydown', (e) => {
  game.audio.unlock();
  if (e.metaKey || e.altKey || e.ctrlKey) {
    game.keys.clear();
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && game.mode === 'build' && !ui.activeModal) {
      e.preventDefault();
      game.undo();
    }
    return;
  }

  if (e.code === 'Escape') {
    if (ui.activeModal) {
      ui.closeModals();
    } else if (game.selectedPropKey) {
      game.closeRadial();
    } else {
      ui.openModal('settings');
    }
    return;
  }

  if (e.code === 'Tab') {
    e.preventDefault();
    if (!ui.activeModal) {
      game.toggleMode();
    }
    return;
  }

  if (ui.activeModal) return;

  if (
    e.code === 'Space' ||
    e.code === 'ArrowUp' ||
    e.code === 'ArrowDown' ||
    e.code === 'ArrowLeft' ||
    e.code === 'ArrowRight'
  ) {
    e.preventDefault();
  }

  game.keys.add(e.code);
  if (e.repeat) return;

  if (game.mode === 'walk') {
    if (e.code === 'Space') {
      game.queueJump();
    } else if (e.code === 'KeyE') {
      game.triggerEmote();
    }
    return;
  }

  // Build Mode hotkeys (matching video: V = Oak, C = Pine, plus 1-9 & Z Undo!)
  if (DIGIT_TOOL_MAP[e.code]) {
    game.selectTool(DIGIT_TOOL_MAP[e.code]);
  } else if (e.code === 'KeyV') {
    game.selectTool('oak');
  } else if (e.code === 'KeyC') {
    game.selectTool('pine');
  } else if (e.code === 'KeyZ') {
    game.undo();
  } else if (e.code === 'KeyR' && game.selectedPropKey) {
    game.radialAction('rotate');
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    if (game.selectedPropKey) game.radialAction('delete');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'MetaLeft' || e.code === 'MetaRight') game.keys.clear();
  game.keys.delete(e.code);
});

// ---------------- ZERO-RUNAWAY GLOBAL INPUT RESET ----------------
const activePointers = new Map();
let singlePointerId = null;
let dragStartX = 0;
let dragStartY = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let dragMoved = false;
let pinchUsed = false;
let pinchPrevDist = 0;
let pinchPrevMidX = 0;
let pinchPrevMidY = 0;

function resetAllInputs() {
  game.keys.clear();
  game.setInput(0, 0);
  game.touchInput.x = 0;
  game.touchInput.z = 0;
  game.manualOrbitDragging = false;
  activePointers.clear();
  singlePointerId = null;
  pinchPrevDist = 0;
  ui.resetTouchStick();
}

window.addEventListener('blur', resetAllInputs);
window.addEventListener('pagehide', resetAllInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetAllInputs();
});

// Order-proof release when every finger leaves the glass (iPadOS safety!)
const releaseIfNoTouches = (e) => {
  if (e.touches && e.touches.length === 0) {
    ui.resetTouchStick();
    const stale = [...activePointers.keys()];
    setTimeout(() => {
      for (const id of stale) activePointers.delete(id);
      if (activePointers.size === 0) {
        singlePointerId = null;
        pinchPrevDist = 0;
        game.manualOrbitDragging = false;
      }
    }, 0);
  }
};
window.addEventListener('touchend', releaseIfNoTouches, { passive: true });
window.addEventListener('touchcancel', releaseIfNoTouches, { passive: true });

// ---------------- POINTER ORBIT, 2-FINGER PINCH ZOOM/PAN & TAP SCULPT ----------------
function getTwoPointerMetrics() {
  if (activePointers.size < 2) return null;
  const pts = Array.from(activePointers.values());
  const dx = pts[0].x - pts[1].x;
  const dy = pts[0].y - pts[1].y;
  return {
    dist: Math.hypot(dx, dy),
    midX: (pts[0].x + pts[1].x) * 0.5,
    midY: (pts[0].y + pts[1].y) * 0.5,
  };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    if (ui.activeModal) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.07 : 0.93;
    game.setCameraZoom(game.camZoomScale * factor);
  },
  { passive: false }
);

canvas.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  game.audio.unlock();
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    ui.notifyTouchPointer();
  }
  activePointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY,
    type: e.pointerType,
  });
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (_) {}

  if (activePointers.size === 1) {
    singlePointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    dragMoved = false;
    pinchUsed = false;
    pinchPrevDist = 0;
    game.manualOrbitDragging = true;
  } else if (activePointers.size === 2) {
    singlePointerId = null;
    dragMoved = true;
    pinchUsed = true;
    const m = getTwoPointerMetrics();
    pinchPrevDist = m ? m.dist : 0;
    pinchPrevMidX = m ? m.midX : 0;
    pinchPrevMidY = m ? m.midY : 0;
    game.manualOrbitDragging = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const tracked = activePointers.get(e.pointerId);
  if (tracked) {
    tracked.x = e.clientX;
    tracked.y = e.clientY;

    if (activePointers.size >= 2) {
      const m = getTwoPointerMetrics();
      if (m && !ui.activeModal) {
        if (pinchPrevDist > 12 && m.dist > 12) {
          game.setCameraZoom(game.camZoomScale * (pinchPrevDist / m.dist));
        }
        if (game.mode === 'build') {
          game.panCameraByScreenDelta(m.midX - pinchPrevMidX, m.midY - pinchPrevMidY);
        }
        pinchPrevDist = m.dist;
        pinchPrevMidX = m.midX;
        pinchPrevMidY = m.midY;
      }
      return;
    }

    if (e.pointerId === singlePointerId) {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      const deadzone = e.pointerType === 'touch' ? 10 : 6;
      if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > deadzone) {
        dragMoved = true;
      }
      if (dragMoved && !ui.activeModal) {
        const yawSpeed = e.pointerType === 'touch' ? 0.0068 : 0.0064;
        const pitchSpeed = e.pointerType === 'touch' ? 0.0046 : 0.0044;
        game.setCameraOrbit(game.camYaw - dx * yawSpeed, game.camPitch + dy * pitchSpeed);
      }
    }
  } else if (game.mode === 'build' && e.pointerType !== 'touch') {
    game.updateHoverFromPointer(e.clientX, e.clientY);
  }
});

const endCanvasPointer = (e) => {
  const wasTracked = activePointers.delete(e.pointerId);
  if (!wasTracked) return;

  if (activePointers.size === 0) {
    // STRICT INVARIANT: pointercancel MUST NEVER trigger a hex placement or tap!
    const shouldTap = e.type === 'pointerup' && e.pointerId === singlePointerId && !dragMoved && !pinchUsed;
    singlePointerId = null;
    pinchPrevDist = 0;
    game.manualOrbitDragging = false;
    if (shouldTap) {
      game.handleCanvasClick(e.clientX, e.clientY);
    }
  } else if (activePointers.size === 1) {
    const [remId, remPt] = activePointers.entries().next().value;
    singlePointerId = remId;
    lastPointerX = remPt.x;
    lastPointerY = remPt.y;
    dragMoved = true;
    pinchPrevDist = 0;
  }
};
canvas.addEventListener('pointerup', endCanvasPointer);
canvas.addEventListener('pointercancel', endCanvasPointer);

window.addEventListener('resize', () => {
  game.resize();
  game.render();
});

// ---------------- TEST & AUTOMATION SEAM ----------------
window.__ROBLOX_EKO__ = {
  getState: () => game.getState(),
  step: (dt = 1 / 60, n = 1) => {
    game.step(dt, n);
    return game.getState();
  },
  render: () => {
    game.render();
  },
  selectTool: (toolId) => game.selectTool(toolId),
  tapHex: (q, r) => game.tapHex(q, r),
  getHex: (q, r) => game.getHex(q, r),
  openRadialForHex: (q, r) => game.openRadialForHex(q, r),
  radialAction: (action) => game.radialAction(action),
  closeRadial: () => game.closeRadial(),
  loadPreset: (id) => game.loadPreset(id),
  setMode: (mode) => game.setMode(mode),
  toggleMode: () => game.toggleMode(),
  setInput: (x, z) => game.setInput(x, z),
  queueJump: () => game.queueJump(),
  triggerEmote: () => game.triggerEmote(),
  setCameraOrbit: (yaw, pitch) => {
    game.setCameraOrbit(yaw, pitch);
    game._updateCamera(1.0);
  },
  setCameraZoom: (scale) => {
    game.setCameraZoom(scale);
    game._updateCamera(1.0);
  },
  setCameraFocus: (x, z) => {
    game.setCameraFocus(x, z);
    game._updateCamera(1.0);
  },
  setSetting: (key, val) => game.setSetting(key, val),
  undo: () => game.undo(),
  clearIsland: () => game.clearIsland(),
  resetSave: () => game.resetSave(),
  projectHexToScreen: (q, r) => game.projectHexToScreen(q, r),
  audio: game.audio,
  get rendererInfo() {
    return {
      calls: game.renderer.info.render.calls,
      triangles: game.renderer.info.render.triangles,
      geometries: game.renderer.info.memory.geometries,
      textures: game.renderer.info.memory.textures,
    };
  },
  _game: game,
  _scene: game.scene,
};
