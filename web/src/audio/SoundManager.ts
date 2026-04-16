/**
 * SoundManager — synthesizes retro 8-bit sounds via Web Audio API.
 *
 * No external audio files required. AudioContext is created lazily on first
 * play to comply with browser autoplay policies.
 */

import type { ActionType } from "../protocol/events";

class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  // --- Ambient state ---
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientLfoOsc: OscillatorNode | null = null;
  private ambientLfoGain: GainNode | null = null;
  private ambientNoiseSource: AudioBufferSourceNode | null = null;
  private ambientNoiseGain: GainNode | null = null;
  private dissonanceOscs: OscillatorNode[] = [];
  private dissonanceGain: GainNode | null = null;
  private isAmbientPlaying = false;
  private ambientEnabled = true;
  private ambientVolume = 0.15;
  private masterVolume = 0.5;
  private zoomVolume = 1.0;
  private activityLevel = 0; // 0-1
  private isNight = false;
  private dayNightIntervalId: ReturnType<typeof setInterval> | null = null;
  private hasErrors = false;

  /** Lazily create (or resume) the AudioContext. */
  private async getContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  /** Effective gain accounting for master, zoom, and ambient volumes. */
  private effectiveAmbientGain(): number {
    return this.ambientVolume * this.masterVolume * this.zoomVolume;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopAmbient();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ---------------------------------------------------------------------------
  // Ambient Engine
  // ---------------------------------------------------------------------------

  async startAmbient(): Promise<void> {
    if (this.isAmbientPlaying || !this.ambientEnabled) return;
    const ctx = await this.getContext();
    this.isAmbientPlaying = true;

    // Base drone — sine wave, low pitch
    this.ambientOsc = ctx.createOscillator();
    this.ambientOsc.type = "sine";
    this.ambientOsc.frequency.setValueAtTime(80, ctx.currentTime);

    // LFO for subtle wobble
    this.ambientLfoOsc = ctx.createOscillator();
    this.ambientLfoOsc.frequency.setValueAtTime(0.5, ctx.currentTime);
    this.ambientLfoGain = ctx.createGain();
    this.ambientLfoGain.gain.setValueAtTime(3, ctx.currentTime);
    this.ambientLfoOsc.connect(this.ambientLfoGain);
    this.ambientLfoGain.connect(this.ambientOsc.frequency);
    this.ambientLfoOsc.start();

    // Main gain envelope
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.setValueAtTime(this.effectiveAmbientGain(), ctx.currentTime);
    this.ambientOsc.connect(this.ambientGain).connect(ctx.destination);
    this.ambientOsc.start();

    // Noise layer (off initially, increases with activity)
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    this.ambientNoiseSource = ctx.createBufferSource();
    this.ambientNoiseSource.buffer = noiseBuffer;
    this.ambientNoiseSource.loop = true;

    this.ambientNoiseGain = ctx.createGain();
    this.ambientNoiseGain.gain.setValueAtTime(0, ctx.currentTime);

    const bpFilter = ctx.createBiquadFilter();
    bpFilter.type = "bandpass";
    bpFilter.frequency.setValueAtTime(200, ctx.currentTime);
    bpFilter.Q.setValueAtTime(1.5, ctx.currentTime);

    this.ambientNoiseSource.connect(bpFilter).connect(this.ambientNoiseGain).connect(ctx.destination);
    this.ambientNoiseSource.start();

    // Dissonance layer (controlled by error state)
    this.dissonanceGain = ctx.createGain();
    this.dissonanceGain.gain.setValueAtTime(0, ctx.currentTime);
    this.dissonanceGain.connect(ctx.destination);

    const detunedFreqs = [110, 116.5]; // slightly detuned for beat frequency
    for (const freq of detunedFreqs) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.connect(this.dissonanceGain);
      osc.start();
      this.dissonanceOscs.push(osc);
    }

    // Start day/night ambient sounds
    this.scheduleDayNightSounds();
  }

  stopAmbient(): void {
    if (!this.isAmbientPlaying) return;
    this.isAmbientPlaying = false;

    try { this.ambientOsc?.stop(); } catch { /* already stopped */ }
    try { this.ambientLfoOsc?.stop(); } catch { /* already stopped */ }
    try { this.ambientNoiseSource?.stop(); } catch { /* already stopped */ }
    for (const osc of this.dissonanceOscs) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.dissonanceOscs = [];

    this.ambientOsc = null;
    this.ambientGain = null;
    this.ambientLfoOsc = null;
    this.ambientLfoGain = null;
    this.ambientNoiseSource = null;
    this.ambientNoiseGain = null;
    this.dissonanceGain = null;

    if (this.dayNightIntervalId !== null) {
      clearInterval(this.dayNightIntervalId);
      this.dayNightIntervalId = null;
    }
  }

  setAmbientEnabled(on: boolean): void {
    this.ambientEnabled = on;
    if (!on) this.stopAmbient();
    else if (this.enabled && !this.isAmbientPlaying) this.startAmbient();
  }

  isAmbientEnabled(): boolean {
    return this.ambientEnabled;
  }

  /** Activity level 0-1 adjusts ambient pitch and noise volume. */
  setActivityLevel(level: number): void {
    this.activityLevel = Math.max(0, Math.min(1, level));
    if (!this.ctx || !this.isAmbientPlaying) return;
    const now = this.ctx.currentTime;

    // Drone frequency: 80Hz (quiet) → 200Hz (busy)
    const freq = 80 + this.activityLevel * 120;
    this.ambientOsc?.frequency.linearRampToValueAtTime(freq, now + 0.5);

    // LFO speed increases with activity
    this.ambientLfoOsc?.frequency.linearRampToValueAtTime(0.5 + this.activityLevel * 2, now + 0.5);

    // Noise layer fades in with activity (0 → 0.04)
    const noiseVol = this.activityLevel * 0.04 * this.masterVolume * this.zoomVolume;
    this.ambientNoiseGain?.gain.linearRampToValueAtTime(noiseVol, now + 0.5);
  }

  /** Switch day/night ambient character. */
  setDayNight(night: boolean): void {
    if (this.isNight === night) return;
    this.isNight = night;
    // The day/night sound scheduler will pick up the change
  }

  /** Error atmosphere — enable/disable dissonant undertone. */
  setErrorAtmosphere(hasErrors: boolean): void {
    if (this.hasErrors === hasErrors) return;
    this.hasErrors = hasErrors;
    if (!this.ctx || !this.dissonanceGain) return;
    const now = this.ctx.currentTime;
    const targetGain = hasErrors ? 0.03 * this.masterVolume * this.zoomVolume : 0;
    this.dissonanceGain.gain.linearRampToValueAtTime(targetGain, now + 2);
  }

  /** Camera zoom → volume mapping. */
  setZoomVolume(zoom: number): void {
    // zoom 0.3→0.3, zoom 1.0→1.0, zoom 2.0→0.8
    if (zoom <= 1.0) {
      this.zoomVolume = zoom;
    } else {
      this.zoomVolume = 1.0 - (zoom - 1.0) * 0.2;
    }
    this.zoomVolume = Math.max(0.1, Math.min(1.0, this.zoomVolume));
    this.updateAmbientVolume();
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    this.updateAmbientVolume();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  private updateAmbientVolume(): void {
    if (!this.ctx || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    this.ambientGain.gain.linearRampToValueAtTime(this.effectiveAmbientGain(), now + 0.1);
    // Re-apply activity-dependent noise volume
    const noiseVol = this.activityLevel * 0.04 * this.masterVolume * this.zoomVolume;
    this.ambientNoiseGain?.gain.linearRampToValueAtTime(noiseVol, now + 0.1);
    // Re-apply error dissonance
    if (this.dissonanceGain) {
      const disVol = this.hasErrors ? 0.03 * this.masterVolume * this.zoomVolume : 0;
      this.dissonanceGain.gain.linearRampToValueAtTime(disVol, now + 0.1);
    }
  }

  // --- Day/night ambient creature sounds ---

  private scheduleDayNightSounds(): void {
    if (this.dayNightIntervalId !== null) return;
    this.dayNightIntervalId = setInterval(() => {
      if (!this.enabled || !this.isAmbientPlaying || !this.ambientEnabled) return;
      // Random chance each tick (every 3s)
      if (Math.random() > 0.4) return;
      if (this.isNight) {
        if (Math.random() < 0.6) this.playCricket();
        else this.playOwlHoot();
      } else {
        this.playBirdChirp();
      }
    }, 3000);
  }

  private async playBirdChirp(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.06 * this.masterVolume * this.zoomVolume;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    // Glide up then down: 800→1200→800
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.05);
    osc.frequency.linearRampToValueAtTime(800, now + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + 0.1);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  private async playCricket(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.04 * this.masterVolume * this.zoomVolume;

    // 3 short pulses at 4000Hz
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(4000 + Math.random() * 500, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.005);
      gain.gain.linearRampToValueAtTime(0, t + 0.02);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.025);
    }
  }

  private async playOwlHoot(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.05 * this.masterVolume * this.zoomVolume;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    // Low sine dipping down: 300→200
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(200, now + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.02);
    gain.gain.setValueAtTime(vol, now + 0.2);
    gain.gain.linearRampToValueAtTime(0, now + 0.35);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  // ---------------------------------------------------------------------------
  // Victory fanfare (all tasks complete)
  // ---------------------------------------------------------------------------

  async playVictoryFanfare(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.12 * this.masterVolume;

    // Triumphant chord: C5 + E5 + G5 + C6
    const freqs = [523, 659, 784, 1047];
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.05);
      gain.gain.setValueAtTime(vol, now + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Action-specific sounds (short, subtle)
  // ---------------------------------------------------------------------------

  async playActionSound(action: ActionType): Promise<void> {
    if (!this.enabled) return;
    switch (action) {
      case "read": return this.playReadSound();
      case "edit": return this.playEditSound();
      case "test": return this.playTestSound();
      case "build": return this.playBuildSound();
      case "git": return this.playGitSound();
      case "shell": return this.playShellSound();
      case "thinking": return this.playThinkingSound();
      default: return;
    }
  }

  /** Page-turn: short noise burst with bandpass filter. */
  private async playReadSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.08 * this.masterVolume * this.zoomVolume;

    const bufferSize = ctx.sampleRate * 0.08;
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2000, now);
    bp.Q.setValueAtTime(2, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.08);

    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.1);
  }

  /** Chisel tap: short impulse, metallic ring. */
  private async playEditSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.1 * this.masterVolume * this.zoomVolume;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** Clash/ding: triangle wave burst. */
  private async playTestSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.1 * this.masterVolume * this.zoomVolume;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1200, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  /** Anvil ring: square wave with quick decay. */
  private async playBuildSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.1 * this.masterVolume * this.zoomVolume;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(300, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    // Harmonics layer
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(900, now);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(vol * 0.3, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain).connect(ctx.destination);
    osc2.connect(gain2).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
    osc2.start(now);
    osc2.stop(now + 0.17);
  }

  /** Scroll unrolling: filtered noise sweep down. */
  private async playGitSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.08 * this.masterVolume * this.zoomVolume;

    const bufferSize = ctx.sampleRate * 0.2;
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(3000, now);
    bp.frequency.linearRampToValueAtTime(500, now + 0.2);
    bp.Q.setValueAtTime(1, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);

    src.connect(bp).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.22);
  }

  /** Crackling: random short impulses. */
  private async playShellSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.06 * this.masterVolume * this.zoomVolume;

    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.04 + Math.random() * 0.02;
      const bufSize = ctx.sampleRate * 0.015;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < bufSize; j++) d[j] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

      src.connect(gain).connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.02);
    }
  }

  /** Mystical hum: sine with vibrato. */
  private async playThinkingSound(): Promise<void> {
    const ctx = await this.getContext();
    const now = ctx.currentTime;
    const vol = 0.06 * this.masterVolume * this.zoomVolume;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);

    // Vibrato LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(6, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(15, now);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.05);
    gain.gain.setValueAtTime(vol, now + 0.15);
    gain.gain.linearRampToValueAtTime(0, now + 0.25);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
    lfo.start(now);
    lfo.stop(now + 0.28);
  }

  // ---------------------------------------------------------------------------
  // Existing event sounds (preserved)
  // ---------------------------------------------------------------------------

  /**
   * Descending warning tone — retro "damage / blocked" sound.
   *
   * Square wave sliding from E5 (660 Hz) down to A3 (220 Hz) over 250 ms,
   * with a short noise burst overlay for impact texture.
   */
  async playBlocked(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    // --- Main descending tone ---
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.linearRampToValueAtTime(220, now + 0.25);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15 * this.masterVolume, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + 0.25);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // --- Short noise burst for impact ---
    const bufferSize = ctx.sampleRate * 0.06;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08 * this.masterVolume, now);
    noiseGain.gain.linearRampToValueAtTime(0, now + 0.06);

    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.06);
  }

  /**
   * Ascending victory arpeggio — retro "item get / complete" sound.
   *
   * Four notes in quick sequence: C5, E5, G5, C6 (80 ms each, square wave).
   */
  async playComplete(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
    const noteDuration = 0.08;

    for (let i = 0; i < notes.length; i++) {
      const t = now + i * noteDuration;

      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(notes[i], t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12 * this.masterVolume, t + 0.005);
      gain.gain.setValueAtTime(0.12 * this.masterVolume, t + noteDuration - 0.01);
      gain.gain.linearRampToValueAtTime(0, t + noteDuration + 0.02);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteDuration + 0.02);
    }
  }

  /**
   * Flat dissonant buzz — retro "wrong / error" sound.
   *
   * Two slightly detuned square waves (220 Hz + 233 Hz) creating a beat
   * frequency, 200 ms duration.
   */
  async playError(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    const freqs = [220, 233];

    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1 * this.masterVolume, now + 0.01);
      gain.gain.setValueAtTime(0.1 * this.masterVolume, now + 0.18);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);

      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  }
  /**
   * Ascending coin pickup — retro "loot collected" sound.
   *
   * Three quick triangle-wave notes: C6, E6, G6 (40 ms each).
   */
  async playLoot(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    const notes = [1047, 1319, 1568]; // C6, E6, G6
    const noteDuration = 0.04;

    for (let i = 0; i < notes.length; i++) {
      const t = now + i * noteDuration;

      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(notes[i], t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15 * this.masterVolume, t + 0.005);
      gain.gain.setValueAtTime(0.15 * this.masterVolume, t + noteDuration - 0.005);
      gain.gain.linearRampToValueAtTime(0, t + noteDuration + 0.03);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteDuration + 0.03);
    }
  }
  /**
   * Ascending fanfare — retro "level up" sound.
   *
   * Six-note ascending sine arpeggio with sustain: C5→E5→G5→C6→E6→G6.
   * Longer notes (100ms) with overlapping tails for a triumphant feel.
   */
  async playLevelUp(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    const notes = [523, 659, 784, 1047, 1319, 1568]; // C5→E5→G5→C6→E6→G6
    const noteDuration = 0.1;

    for (let i = 0; i < notes.length; i++) {
      const t = now + i * noteDuration;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(notes[i], t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15 * this.masterVolume, t + 0.01);
      gain.gain.setValueAtTime(0.15 * this.masterVolume, t + noteDuration);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDuration + 0.3);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteDuration + 0.3);
    }

    // Final chord — C6+E6+G6 together for impact
    const chord = [1047, 1319, 1568];
    const chordStart = now + notes.length * noteDuration;
    for (const freq of chord) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, chordStart);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08 * this.masterVolume, chordStart);
      gain.gain.exponentialRampToValueAtTime(0.001, chordStart + 0.5);

      osc.connect(gain).connect(ctx.destination);
      osc.start(chordStart);
      osc.stop(chordStart + 0.5);
    }
  }
  /**
   * Ascending pentatonic run with shimmer chord — retro "achievement unlocked" sound.
   */
  async playAchievement(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

    // Ascending pentatonic run
    const notes = [523, 587, 659, 784, 880];
    const noteDuration = 0.05;

    for (let i = 0; i < notes.length; i++) {
      const t = now + i * noteDuration;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(notes[i], t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12 * this.masterVolume, t + 0.005);
      gain.gain.setValueAtTime(0.12 * this.masterVolume, t + noteDuration - 0.005);
      gain.gain.linearRampToValueAtTime(0, t + noteDuration + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteDuration + 0.04);
    }

    // Sustained shimmer chord
    const chordStart = now + notes.length * noteDuration;
    for (const freq of [1047, 1319]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 2, chordStart);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06 * this.masterVolume, chordStart);
      gain.gain.exponentialRampToValueAtTime(0.001, chordStart + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(chordStart);
      osc.stop(chordStart + 0.6);
    }
  }
}

export const soundManager = new SoundManager();
