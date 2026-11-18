/**
 * Roblox + Pastel eko HUD, Curved Horizontal Dock, Contextual Radial Menu,
 * Presets 1-8 Modal, Settings Modal, and Unlatchable iPad Touch Controls.
 */

import { COLOR_SWATCH_HEX, COLOR_SWATCH_NAMES } from './hex.js';
import { PRESET_META } from './presets.js';

/**
 * Binds an interactive button cleanly for multi-touch iPad + mouse + keyboard:
 * - Fires immediately on primary `pointerdown` (works even while another finger holds the stick or rests on glass).
 * - Swallows ALL pointer/mouse/touch `click` events (`e.detail > 0 || e.pointerType`), eliminating BOTH
 *   slow-press double-firing (150ms-5000ms) AND ghost clicks onto newly opened radial/modal buttons!
 * - Preserves keyboard activation (`Enter`/`Space`) and programmatic `.click()` (`e.detail === 0 && !e.pointerType`).
 */
function bindTouchAndClick(el, fn) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    if (el.disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.disabled) return;
    if (e.detail > 0 || (e.pointerType && e.pointerType !== '')) return;
    fn(e);
  });
}

export class EkoUI {
  constructor(callbacks) {
    this.cb = callbacks;

    this.el = {
      topLeftHud: document.getElementById('top-left-hud'),
      topRightHud: document.getElementById('top-right-hud'),
      btnPresets: document.getElementById('btn-presets'),
      btnSettings: document.getElementById('btn-settings'),
      btnAudio: document.getElementById('btn-audio'),
      audioIconOn: document.getElementById('ico-audio-on'),
      audioIconOff: document.getElementById('ico-audio-off'),
      tileCounterText: document.getElementById('tile-counter-text'),

      btnCamReset: document.getElementById('btn-cam-reset'),
      btnToggleMode: document.getElementById('btn-toggle-mode'),
      modeBtnIcon: document.getElementById('mode-btn-icon'),
      modeBtnLabel: document.getElementById('mode-btn-label'),

      toastBanner: document.getElementById('toast-banner'),
      walkHint: document.getElementById('walk-desktop-hint'),

      // Bottom Curved Build Dock
      buildDockWrap: document.getElementById('build-dock-wrap'),
      buildDock: document.getElementById('build-dock'),
      btnUndo: document.getElementById('btn-undo'),

      // Contextual Radial Menu
      radialMenu: document.getElementById('radial-menu'),
      radialLabel: document.getElementById('radial-label'),
      radialSwatchDot: document.getElementById('radial-swatch-dot'),
      btnRadRotate: document.getElementById('btn-rad-rotate'),
      btnRadDuplicate: document.getElementById('btn-rad-duplicate'),
      btnRadRecolor: document.getElementById('btn-rad-recolor'),
      btnRadDelete: document.getElementById('btn-rad-delete'),
      btnRadClose: document.getElementById('btn-rad-close'),

      // Walk Mode Touch Controls
      touchControls: document.getElementById('touch-controls'),
      stickZone: document.getElementById('touch-stick-zone'),
      stickBase: document.getElementById('touch-stick-base'),
      stickKnob: document.getElementById('touch-stick-knob'),
      touchRightBtns: document.getElementById('touch-right-btns'),
      btnTouchWave: document.getElementById('btn-touch-wave'),
      btnTouchJump: document.getElementById('btn-touch-jump'),

      // Modals
      backdrop: document.getElementById('modal-backdrop'),
      modalPresets: document.getElementById('modal-presets'),
      presetsGrid: document.getElementById('presets-grid'),
      modalSettings: document.getElementById('modal-settings'),

      // Settings Controls
      setTileBarFill: document.getElementById('set-tile-bar-fill'),
      setTileCountVal: document.getElementById('set-tile-count-val'),
      btnSetSnap: document.getElementById('btn-set-snap'),
      btnSetRandRot: document.getElementById('btn-set-rand-rot'),
      btnSetWind: document.getElementById('btn-set-wind'),
      btnSetShadows: document.getElementById('btn-set-shadows'),
      btnSetClouds: document.getElementById('btn-set-clouds'),
      btnSetMusic: document.getElementById('btn-set-music'),
      btnSetSfx: document.getElementById('btn-set-sfx'),
      btnSetTouch: document.getElementById('btn-set-touch'),
      btnClearIsland: document.getElementById('btn-clear-island'),
      btnResetIsland: document.getElementById('btn-reset-island'),
    };

    this.activeModal = null;
    this._modalOpenedAt = 0;
    this.touchMode = 'auto'; // 'auto' | 'on' | 'off'
    this._seenTouchPointer = false;
    this.stickPointerId = null;
    this._currentMode = 'build';
    this._toastTimer = 0;
    this._lastRadialPos = { x: 0, y: 0 };
    this._clearArmed = false;

    this._buildPresetsGrid();
    this._bindEvents();
    this.syncTouchVisibility('build');
  }

  _buildPresetsGrid() {
    this.el.presetsGrid.innerHTML = '';
    for (const meta of PRESET_META) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-card';
      btn.dataset.presetId = String(meta.id);
      btn.innerHTML = `
        <div class="preset-card-top">
          <span class="preset-num" style="background:${meta.badge};color:#10221c;">${meta.id}</span>
          <span class="preset-dot" style="background:${meta.accent};"></span>
        </div>
        <div class="preset-name">${meta.name}</div>
        <div class="preset-sub">${meta.subtitle}</div>
      `;
      bindTouchAndClick(btn, () => {
        this.closeModals();
        this.cb.onLoadPreset(meta.id);
      });
      this.el.presetsGrid.appendChild(btn);
    }
  }

  _bindEvents() {
    // Topbar — all bound via pointerdown + exact click-swallow so held stick / resting fingers never block them!
    bindTouchAndClick(this.el.btnPresets, () => {
      if (this.activeModal === 'presets') this.closeModals();
      else this.openModal('presets');
    });
    bindTouchAndClick(this.el.btnSettings, () => {
      if (this.activeModal === 'settings') this.closeModals();
      else this.openModal('settings');
    });
    bindTouchAndClick(this.el.btnAudio, () => {
      this.cb.onToggleAudioQuick();
    });
    bindTouchAndClick(this.el.btnCamReset, () => {
      this.cb.onResetCamera();
    });

    // WALK <-> BUILD Pill
    bindTouchAndClick(this.el.btnToggleMode, () => {
      this.cb.onToggleMode();
    });

    // Bottom Curved Build Dock tool buttons
    this.el.buildDock.querySelectorAll('[data-tool]').forEach((btn) => {
      bindTouchAndClick(btn, () => {
        this.cb.onSelectTool(btn.dataset.tool);
      });
    });
    bindTouchAndClick(this.el.btnUndo, () => {
      this.cb.onUndo();
    });

    // Contextual Radial Menu buttons
    bindTouchAndClick(this.el.btnRadRotate, () => this.cb.onRadialAction('rotate'));
    bindTouchAndClick(this.el.btnRadDuplicate, () => this.cb.onRadialAction('duplicate'));
    bindTouchAndClick(this.el.btnRadRecolor, () => this.cb.onRadialAction('recolor'));
    bindTouchAndClick(this.el.btnRadDelete, () => this.cb.onRadialAction('delete'));
    bindTouchAndClick(this.el.btnRadClose, () => this.cb.onCloseRadial());

    // Modal close buttons + backdrop close strictly on backdrop's OWN pointerdown (never click, so slow presses never self-close!)
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      bindTouchAndClick(btn, () => this.closeModals());
    });
    this.el.backdrop.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target !== this.el.backdrop) return;
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() - (this._modalOpenedAt || 0) < 450) return;
      this.closeModals();
    });
    this.el.backdrop.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Settings Controls — all pointerdown + click-swallow
    bindTouchAndClick(this.el.btnSetSnap, () => this.cb.onToggleSnap());
    bindTouchAndClick(this.el.btnSetRandRot, () => this.cb.onToggleSetting('randomRotation'));
    bindTouchAndClick(this.el.btnSetWind, () => this.cb.onToggleSetting('windLines'));
    bindTouchAndClick(this.el.btnSetShadows, () => this.cb.onToggleSetting('shadows'));
    bindTouchAndClick(this.el.btnSetClouds, () => this.cb.onToggleSetting('clouds'));
    bindTouchAndClick(this.el.btnSetMusic, () => this.cb.onToggleMusic());
    bindTouchAndClick(this.el.btnSetSfx, () => this.cb.onToggleSfx());
    bindTouchAndClick(this.el.btnSetTouch, () => {
      this.touchMode = this.touchMode === 'auto' ? 'on' : this.touchMode === 'on' ? 'off' : 'auto';
      this.el.btnSetTouch.textContent = this.touchMode.toUpperCase();
      this.el.btnSetTouch.classList.toggle('on', this.touchMode === 'on');
      this.syncTouchVisibility(this._currentMode);
    });
    bindTouchAndClick(this.el.btnClearIsland, () => {
      if (!this._clearArmed) {
        this._clearArmed = true;
        this.el.btnClearIsland.textContent = 'Confirm Clear?';
        return;
      }
      this._clearArmed = false;
      this.el.btnClearIsland.textContent = 'Clear Canvas';
      this.closeModals();
      this.cb.onClearIsland();
    });
    bindTouchAndClick(this.el.btnResetIsland, () => {
      this._clearArmed = false;
      this.el.btnClearIsland.textContent = 'Clear Canvas';
      this.closeModals();
      this.cb.onResetSave();
    });

    // ---------------- UNLATCHABLE IPAD THUMBSTICK & RIGHT ACTION BUTTONS ----------------
    const stickZone = this.el.stickZone;
    const stickBase = this.el.stickBase;
    const knob = this.el.stickKnob;

    const updateStick = (clientX, clientY) => {
      const rect = stickBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = Math.max(24, rect.width * 0.36);
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > maxR && len > 0.001) {
        dx = (dx / len) * maxR;
        dy = (dy / len) * maxR;
      }
      knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      const normLen = Math.min(1, len / maxR);
      if (normLen < 0.08) {
        this.cb.onTouchMove(0, 0);
      } else {
        const rescaled = (normLen - 0.08) / 0.92;
        const ux = dx / Math.max(0.001, Math.hypot(dx, dy));
        const uy = dy / Math.max(0.001, Math.hypot(dx, dy));
        this.cb.onTouchMove(ux * rescaled, uy * rescaled);
      }
    };

    stickZone.addEventListener('pointerdown', (e) => {
      // A new finger on the stick always takes over cleanly: never latch stale pointerId!
      if (this.stickPointerId !== null) this.resetTouchStick();
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        this._seenTouchPointer = true;
      }
      this.stickPointerId = e.pointerId;
      stickBase.classList.add('active');
      try {
        stickZone.setPointerCapture(e.pointerId);
      } catch (_) {}
      updateStick(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
    });

    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointerId) return;
      updateStick(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
    });

    const endStick = (e) => {
      if (e.pointerId !== this.stickPointerId) return;
      this.resetTouchStick();
      e.stopPropagation();
    };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);
    stickZone.addEventListener('lostpointercapture', endStick);

    // Capture-phase global release guarantees pointerup/pointercancel can never be lost!
    const endStickGlobal = (e) => {
      if (this.stickPointerId !== null && e.pointerId === this.stickPointerId) {
        this.resetTouchStick();
      }
    };
    window.addEventListener('pointerup', endStickGlobal, true);
    window.addEventListener('pointercancel', endStickGlobal, true);

    // Right-side Walk Mode action buttons wired on pointerdown (multi-touch while holding stick!)
    this.el.btnTouchJump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb.onTouchJump();
    });
    this.el.btnTouchWave.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb.onTouchWave();
    });
  }

  isTouchDevice() {
    if (this.touchMode === 'on') return true;
    if (this.touchMode === 'off') return false;
    if (this._seenTouchPointer) return true;
    const coarse =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      (window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(any-pointer: coarse)').matches);
    const hasTouch =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));
    return Boolean(coarse || hasTouch);
  }

  notifyTouchPointer() {
    if (!this._seenTouchPointer) {
      this._seenTouchPointer = true;
      this.syncTouchVisibility(this._currentMode);
    }
  }

  syncTouchVisibility(mode) {
    this._currentMode = mode || this._currentMode;
    const isTouch = this.isTouchDevice();
    document.body.classList.toggle('touch-device', isTouch);
    const showWalkTouch = isTouch && this._currentMode === 'walk' && !this.activeModal;
    this.el.touchControls.classList.toggle('hidden', !showWalkTouch);
    if (!showWalkTouch && this.stickPointerId !== null) {
      this.resetTouchStick();
    }
    this.el.walkHint.classList.toggle('hidden', isTouch || this._currentMode !== 'walk');
  }

  resetTouchStick() {
    this.stickPointerId = null;
    if (this.el.stickBase) this.el.stickBase.classList.remove('active');
    if (this.el.stickKnob) this.el.stickKnob.style.transform = 'translate(0px, 0px)';
    this.cb.onTouchMove(0, 0);
  }

  openModal(name) {
    this.closeModals(true);
    this.activeModal = name;
    this._modalOpenedAt = performance.now();
    this._clearArmed = false;
    if (this.el.btnClearIsland) this.el.btnClearIsland.textContent = 'Clear Canvas';

    this.el.backdrop.classList.remove('hidden');
    if (name === 'presets') {
      this.el.modalPresets.classList.remove('hidden');
    } else if (name === 'settings') {
      this.el.modalSettings.classList.remove('hidden');
    }
    this.hideRadialMenu();
    this.resetTouchStick();
    this.syncTouchVisibility(this._currentMode);
    this.cb.onModalChange(name);
  }

  closeModals(silent = false) {
    const had = this.activeModal !== null;
    this.activeModal = null;
    this._clearArmed = false;
    if (this.el.btnClearIsland) this.el.btnClearIsland.textContent = 'Clear Canvas';
    this.el.backdrop.classList.add('hidden');
    this.el.modalPresets.classList.add('hidden');
    this.el.modalSettings.classList.add('hidden');
    this.syncTouchVisibility(this._currentMode);
    if (had && !silent) {
      this.cb.onModalChange(null);
    }
  }

  showToast(text, duration = 2.4) {
    this.el.toastBanner.textContent = text;
    this.el.toastBanner.classList.remove('hidden');
    this._toastTimer = duration;
  }

  dismissToast() {
    this._toastTimer = 0;
    this.el.toastBanner.classList.add('hidden');
  }

  tick(dt) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) {
        this.el.toastBanner.classList.add('hidden');
      }
    }
  }

  showRadialMenu(screenX, screenY, prop) {
    if (this.activeModal || !prop) {
      this.hideRadialMenu();
      return;
    }
    const W = window.innerWidth || 1280;
    const H = window.innerHeight || 800;
    const padX = W <= 480 ? 94 : 112;
    const topSafe = H <= 480 ? 174 : 122;
    const botSafe = W <= 600 ? 228 : H <= 480 ? 152 : 178;
    const cx = Math.max(padX, Math.min(W - padX, screenX));
    const cy = Math.max(topSafe, Math.min(H - botSafe, screenY));

    this.el.radialMenu.style.left = `${cx.toFixed(0)}px`;
    this.el.radialMenu.style.top = `${cy.toFixed(0)}px`;
    const typeName = prop.type.charAt(0).toUpperCase() + prop.type.slice(1);
    const colName = COLOR_SWATCH_NAMES[prop.colorIdx % 5] || 'Pastel';
    this.el.radialLabel.textContent = `${typeName} · ${colName}`;
    this.el.radialSwatchDot.style.background = COLOR_SWATCH_HEX[prop.colorIdx % 5] || '#e2725b';
    this.el.radialMenu.classList.remove('hidden');
  }

  hideRadialMenu() {
    this.el.radialMenu.classList.add('hidden');
  }

  syncState({ mode, activeTool, tileCount, tileLimit, activePresetId, canUndo, settings, audio }) {
    this._currentMode = mode;

    // Tile counters (topbar + settings modal)
    this.el.tileCounterText.textContent = `${tileCount} / ${tileLimit}`;
    this.el.setTileCountVal.textContent = `${tileCount} / ${tileLimit}`;
    const pct = Math.min(100, (tileCount / Math.max(1, tileLimit)) * 100);
    this.el.setTileBarFill.style.width = `${pct.toFixed(1)}%`;

    // Mode pill & Build dock visibility
    const isWalk = mode === 'walk';
    this.el.buildDockWrap.classList.toggle('hidden', isWalk);
    this.el.btnToggleMode.classList.toggle('walk-active', isWalk);
    this.el.modeBtnLabel.textContent = isWalk ? 'BUILD MODE' : 'WALK ISLAND';
    this.el.modeBtnIcon.textContent = isWalk ? '🔨' : '🚶';

    // Active tool highlight
    this.el.buildDock.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === activeTool);
    });
    this.el.btnUndo.disabled = !canUndo;

    // Active preset highlight
    this.el.presetsGrid.querySelectorAll('.preset-card').forEach((card) => {
      card.classList.toggle('active', Number(card.dataset.presetId) === activePresetId);
    });

    // Audio icon
    const anyAudio = Boolean(audio.musicOn || audio.sfxOn);
    this.el.audioIconOn.classList.toggle('hidden', !anyAudio);
    this.el.audioIconOff.classList.toggle('hidden', anyAudio);

    // Settings toggles
    this.el.btnSetSnap.textContent = `${settings.rotationSnap}°`;
    this.el.btnSetSnap.classList.toggle('on', settings.rotationSnap === 15);

    const syncToggle = (btn, on) => {
      btn.textContent = on ? 'ON' : 'OFF';
      btn.classList.toggle('on', Boolean(on));
    };
    syncToggle(this.el.btnSetRandRot, settings.randomRotation);
    syncToggle(this.el.btnSetWind, settings.windLines);
    syncToggle(this.el.btnSetShadows, settings.shadows);
    syncToggle(this.el.btnSetClouds, settings.clouds);
    syncToggle(this.el.btnSetMusic, audio.musicOn);
    syncToggle(this.el.btnSetSfx, audio.sfxOn);

    this.el.btnSetTouch.textContent = this.touchMode.toUpperCase();
    this.el.btnSetTouch.classList.toggle('on', this.touchMode === 'on');

    this.syncTouchVisibility(mode);
  }
}
