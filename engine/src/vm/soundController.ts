/**
 * Wires the `sound` / `load.sound` / `stop.sound` AGI commands to the SOUND
 * resource decoder and Web Audio player. Owns the set of decoded sounds and
 * at most one in-flight playback: starting a new sound (or `stop.sound`) cuts
 * off whatever was already playing, and each sound's completion flag is set
 * either immediately - if the sound-enabled flag is off - or once its total
 * duration has elapsed, so logic blocked on that flag never hangs.
 */

import { decodeSound, playSound, TICKS_PER_SECOND, type DecodedSound, type SoundPlaybackHandle } from '../resources/sound';
import type { CommandImpl } from './interpreter';
import type { VmState } from './state';

export interface SoundControllerOptions {
  state: VmState;
  audioContext: AudioContext;
  /** Loads the raw bytes of SOUND resource n; returns undefined if not found. */
  soundLoader?: (soundNumber: number) => Uint8Array | undefined;
  /** Receives one line per first-seen missing sound resource. Defaults to console.warn. */
  logger?: (message: string) => void;
}

function totalDurationSeconds(sound: DecodedSound): number {
  return Math.max(
    0,
    ...sound.voices.map((voice) => voice.reduce((sum, note) => sum + note.durationTicks, 0) / TICKS_PER_SECOND),
  );
}

export class SoundController {
  private readonly state: VmState;
  private readonly audioContext: AudioContext;
  private readonly soundLoader?: (soundNumber: number) => Uint8Array | undefined;
  private readonly logger: (message: string) => void;
  private readonly loaded = new Map<number, DecodedSound>();
  private readonly loggedOnce = new Set<string>();
  private current: { handle: SoundPlaybackHandle; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(options: SoundControllerOptions) {
    this.state = options.state;
    this.audioContext = options.audioContext;
    this.soundLoader = options.soundLoader;
    this.logger = options.logger ?? ((message) => console.warn(message));
  }

  /** Decodes and caches SOUND resource `soundNumber`, if not already cached. */
  loadSound(soundNumber: number): void {
    if (this.loaded.has(soundNumber)) {
      return;
    }
    const bytes = this.soundLoader?.(soundNumber);
    if (!bytes) {
      this.logOnce(`load:${soundNumber}`, `load.sound(${soundNumber}): no sound loader configured or resource not found`);
      return;
    }
    this.loaded.set(soundNumber, decodeSound(bytes));
  }

  /** Plays SOUND resource `soundNumber`, setting flag `doneFlag` on completion (auto-loading the resource if `load.sound` wasn't called first). */
  play(soundNumber: number, doneFlag: number): void {
    this.loadSound(soundNumber);
    const sound = this.loaded.get(soundNumber);
    if (!sound) {
      // loadSound() already logged why the resource isn't available.
      return;
    }

    this.stop();

    if (!this.state.isSoundEnabled()) {
      this.state.setFlag(doneFlag, true);
      return;
    }

    const handle = playSound(this.audioContext, sound);
    const timer = setTimeout(() => {
      this.current = null;
      this.state.setFlag(doneFlag, true);
    }, totalDurationSeconds(sound) * 1000);
    this.current = { handle, timer };
  }

  /** Stops whatever is currently playing, if anything, without touching any flag. */
  stop(): void {
    if (!this.current) {
      return;
    }
    clearTimeout(this.current.timer);
    this.current.handle.stop();
    this.current = null;
  }

  private logOnce(key: string, message: string): void {
    if (this.loggedOnce.has(key)) {
      return;
    }
    this.loggedOnce.add(key);
    this.logger(message);
  }

  /** VM command implementations for `load.sound`, `sound`, and `stop.sound`, ready to spread into the Interpreter's `commands` option. */
  get commands(): Record<string, CommandImpl> {
    return {
      'load.sound': (ctx) => {
        const soundNumber = ctx.args[0];
        if (typeof soundNumber !== 'number') {
          return;
        }
        this.loadSound(soundNumber);
      },
      sound: (ctx) => {
        const soundNumber = ctx.args[0];
        const doneFlag = ctx.args[1];
        if (typeof soundNumber !== 'number' || typeof doneFlag !== 'number') {
          return;
        }
        this.play(soundNumber, doneFlag);
      },
      'stop.sound': () => this.stop(),
    };
  }
}
