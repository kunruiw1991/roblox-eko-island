/**
 * Cozy Pastel Marimba & Ambient Kalimba WebAudio Engine for eko Beta Test.
 * Pure procedural WebAudio synthesis (zero external assets, zero spoken TTS).
 */

const STEP_DURATION = 0.38; // Relaxed meditative ~79 BPM eighth notes

// Cozy C-Lydian / major pentatonic pastel chord pads
const CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [293.66, 369.99, 440.0, 587.33], // Dadd9
  [246.94, 329.63, 392.0, 493.88], // Em7
  [220.0, 261.63, 329.63, 392.0],  // Am7
];

// Gentle sparse kalimba / marimba melody (Hz; 0 = rest)
const KALIMBA_LINE = [
  523.25, 0, 659.25, 0, 783.99, 0, 659.25, 0,
  587.33, 0, 739.99, 0, 659.25, 0, 0, 0,
  493.88, 0, 587.33, 0, 659.25, 0, 783.99, 0,
  523.25, 0, 440.0, 0, 392.0, 0, 0, 0,
];

// Warm pentatonic marimba scale mapped to hex elevations 1..5
const ELEV_NOTES = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

export class EkoAudioManager {
  constructor() {
    this.musicOn = true;
    this.sfxOn = true;
    this._ctx = null;
    this._masterGain = null;
    this._sfxGain = null;
    this._musicGain = null;
    this._unlocked = false;
    this._musicAccum = 0;
    this._musicStep = 0;
    this._lastStepMs = 0;
    this._fallbackTimer = null;
  }

  _ensureContext() {
    if (this._ctx) return this._ctx;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);

      const sfx = ctx.createGain();
      sfx.gain.value = this.sfxOn ? 0.78 : 0.0;
      sfx.connect(master);

      const musicFilter = ctx.createBiquadFilter();
      musicFilter.type = 'lowpass';
      musicFilter.frequency.value = 1700;
      musicFilter.Q.value = 0.6;

      const music = ctx.createGain();
      music.gain.value = this.musicOn ? 0.11 : 0.0;
      music.connect(musicFilter);
      musicFilter.connect(master);

      this._ctx = ctx;
      this._masterGain = master;
      this._sfxGain = sfx;
      this._musicGain = music;
      return ctx;
    } catch {
      return null;
    }
  }

  unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return false;
    this._unlocked = true;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!this._fallbackTimer && typeof setInterval === 'function') {
      this._fallbackTimer = setInterval(() => {
        if (!this.musicOn || !this._ctx || this._ctx.state !== 'running') return;
        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (nowMs - this._lastStepMs > 360) {
          this._advanceMusic(0.12);
        }
      }, 120);
    }
    return true;
  }

  setMusicOn(v) {
    this.musicOn = Boolean(v);
    if (this._ctx && this._musicGain) {
      const now = this._ctx.currentTime;
      this._musicGain.gain.cancelScheduledValues(now);
      this._musicGain.gain.setTargetAtTime(this.musicOn ? 0.11 : 0.0, now, 0.03);
    }
    if (!this.musicOn) this._musicAccum = 0;
  }

  setSfxOn(v) {
    this.sfxOn = Boolean(v);
    if (this._ctx && this._sfxGain) {
      const now = this._ctx.currentTime;
      this._sfxGain.gain.cancelScheduledValues(now);
      this._sfxGain.gain.setTargetAtTime(this.sfxOn ? 0.78 : 0.0, now, 0.02);
    }
  }

  getState() {
    return { musicOn: this.musicOn, sfxOn: this.sfxOn, unlocked: this._unlocked };
  }

  stepMusic(dt = 0.016) {
    this._lastStepMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._advanceMusic(dt);
  }

  _advanceMusic(dt) {
    if (!this.musicOn || !this._unlocked || !this._ctx || this._ctx.state !== 'running') return;
    this._musicAccum += Math.min(Math.max(dt || 0, 0), 0.12);
    while (this._musicAccum >= STEP_DURATION) {
      this._musicAccum -= STEP_DURATION;
      this._triggerMusicStep(this._musicStep);
      this._musicStep = (this._musicStep + 1) % 32;
    }
  }

  _triggerMusicStep(step) {
    const ctx = this._ctx;
    if (!ctx || !this._musicGain || !this.musicOn) return;
    const now = ctx.currentTime + 0.01;
    const bar = Math.floor(step / 8);
    const beat = step % 8;

    if (beat === 0) {
      const chord = CHORDS[bar];
      for (const freq of chord) {
        this._tone(this._musicGain, freq, 'sine', now, 2.5, 0.12, 0.18);
      }
    }
    const mel = KALIMBA_LINE[step];
    if (mel > 0) {
      this._tone(this._musicGain, mel, 'triangle', now, 0.45, 0.22, 0.008);
      this._tone(this._musicGain, mel * 2, 'sine', now, 0.18, 0.05, 0.006);
    }
  }

  _tone(dest, freq, type, startTime, dur, peak, attack = 0.008, endFreq = null) {
    const ctx = this._ctx;
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), startTime + dur);
    }
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(peak, startTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  _canSfx() {
    return Boolean(this.sfxOn && this._unlocked && this._ctx && this._ctx.state === 'running');
  }

  playHexPop(elevation = 1) {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    const idx = Math.max(0, Math.min(ELEV_NOTES.length - 1, elevation));
    const f = ELEV_NOTES[idx];
    // Warm woody marimba pop
    this._tone(this._sfxGain, f, 'sine', now, 0.22, 0.34, 0.004, f * 1.04);
    this._tone(this._sfxGain, f * 2.0, 'triangle', now, 0.09, 0.12, 0.003);
  }

  playHexLower() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 330, 'sine', now, 0.18, 0.26, 0.005, 196);
  }

  playPondCarve() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    // Bubbly turquoise water plop!
    this._tone(this._sfxGain, 260, 'sine', now, 0.14, 0.28, 0.005, 590);
    this._tone(this._sfxGain, 440, 'sine', now + 0.06, 0.16, 0.22, 0.005, 760);
  }

  playFloraPop() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 440, 'triangle', now, 0.14, 0.26, 0.004, 587.33);
    this._tone(this._sfxGain, 659.25, 'sine', now + 0.045, 0.16, 0.18, 0.005);
  }

  playCottagePop() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 261.63, 'triangle', now, 0.18, 0.30, 0.005);
    this._tone(this._sfxGain, 392.0, 'sine', now + 0.05, 0.22, 0.24, 0.006);
    this._tone(this._sfxGain, 523.25, 'sine', now + 0.10, 0.28, 0.20, 0.008);
  }

  playRotate() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 523.25, 'triangle', now, 0.09, 0.22, 0.003, 620);
  }

  playRecolor() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 587.33, 'sine', now, 0.12, 0.22, 0.004);
    this._tone(this._sfxGain, 783.99, 'sine', now + 0.05, 0.18, 0.20, 0.004);
  }

  playDelete() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 392, 'triangle', now, 0.15, 0.24, 0.004, 185);
  }

  playPresetChime() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    const notes = [392.0, 493.88, 587.33, 783.99];
    notes.forEach((f, i) => {
      this._tone(this._sfxGain, f, 'sine', now + i * 0.06, 0.32, 0.20, 0.006);
    });
  }

  playJump() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 280, 'sine', now, 0.16, 0.26, 0.005, 560);
  }

  playSplash() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 320, 'sine', now, 0.11, 0.18, 0.004, 620);
  }

  playEmote() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 523.25, 'sine', now, 0.14, 0.24, 0.004);
    this._tone(this._sfxGain, 659.25, 'sine', now + 0.07, 0.16, 0.24, 0.004);
    this._tone(this._sfxGain, 783.99, 'sine', now + 0.14, 0.26, 0.22, 0.005);
  }

  playClick() {
    if (!this._canSfx()) return;
    const now = this._ctx.currentTime + 0.004;
    this._tone(this._sfxGain, 640, 'triangle', now, 0.06, 0.16, 0.002);
  }
}
