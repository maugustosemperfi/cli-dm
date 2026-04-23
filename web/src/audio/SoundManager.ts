/**
 * SoundManager — synthesizes retro 8-bit one-shot sound effects via Web Audio.
 *
 * No external audio files required. AudioContext is created lazily on first
 * play to comply with browser autoplay policies. All audio here is event-driven
 * (action sounds, level-up, achievement, etc.); there is no ambient/background
 * soundscape.
 */

import type { ActionType } from "../protocol/events";

class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private masterVolume = 0.5;
  private zoomVolume = 1.0;

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

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  toggle(): void {
    this.enabled = !this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Camera zoom → volume mapping for event SFX. */
  setZoomVolume(zoom: number): void {
    // zoom 0.3→0.3, zoom 1.0→1.0, zoom 2.0→0.8
    if (zoom <= 1.0) {
      this.zoomVolume = zoom;
    } else {
      this.zoomVolume = 1.0 - (zoom - 1.0) * 0.2;
    }
    this.zoomVolume = Math.max(0.1, Math.min(1.0, this.zoomVolume));
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
  }

  getMasterVolume(): number {
    return this.masterVolume;
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
  // Event sounds
  // ---------------------------------------------------------------------------

  /**
   * Descending warning tone — retro "damage / blocked" sound.
   */
  async playBlocked(): Promise<void> {
    if (!this.enabled) return;
    const ctx = await this.getContext();
    const now = ctx.currentTime;

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

    // Short noise burst for impact
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
