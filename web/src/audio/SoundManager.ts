/**
 * SoundManager — synthesizes retro 8-bit sounds via Web Audio API.
 *
 * No external audio files required. AudioContext is created lazily on first
 * play to comply with browser autoplay policies.
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

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

  // ---------------------------------------------------------------------------
  // Sounds
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
    gain.gain.linearRampToValueAtTime(0.15, now + 0.01); // 10 ms attack
    gain.gain.linearRampToValueAtTime(0, now + 0.25); // decay over 250 ms

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // --- Short noise burst for impact ---
    const bufferSize = ctx.sampleRate * 0.06; // 60 ms of noise
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, now);
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
      gain.gain.linearRampToValueAtTime(0.12, t + 0.005); // quick attack
      gain.gain.setValueAtTime(0.12, t + noteDuration - 0.01);
      gain.gain.linearRampToValueAtTime(0, t + noteDuration + 0.02); // slight overlap tail

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
      gain.gain.linearRampToValueAtTime(0.1, now + 0.01);
      gain.gain.setValueAtTime(0.1, now + 0.18);
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
      gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
      gain.gain.setValueAtTime(0.15, t + noteDuration - 0.005);
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
      gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
      gain.gain.setValueAtTime(0.15, t + noteDuration);
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
      gain.gain.setValueAtTime(0.08, chordStart);
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
      gain.gain.linearRampToValueAtTime(0.12, t + 0.005);
      gain.gain.setValueAtTime(0.12, t + noteDuration - 0.005);
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
      gain.gain.setValueAtTime(0.06, chordStart);
      gain.gain.exponentialRampToValueAtTime(0.001, chordStart + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(chordStart);
      osc.stop(chordStart + 0.6);
    }
  }
}

export const soundManager = new SoundManager();
