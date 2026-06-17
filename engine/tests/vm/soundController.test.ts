import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SoundController } from '../../src/vm/soundController';
import { VmState } from '../../src/vm/state';

// Minimal fakes for the slice of the Web Audio API playSound() touches - see
// tests/resources/soundPlayer.test.ts for the same shapes. This stands in
// for the "audio sink" the story calls for mocking, with no real audio
// hardware involved.

class FakeAudioParam {
  value = 0;
}

class FakeOscillatorNode {
  type = 'sine';
  frequency = new FakeAudioParam();
  stoppedAt: number[] = [];
  connect(): void {}
  start(): void {}
  stop(time?: number): void {
    this.stoppedAt.push(time ?? -1);
  }
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect(): void {}
}

class FakeAudioBuffer {
  private channels = new Map<number, Float32Array>();
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  getChannelData(channel: number): Float32Array {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Float32Array(this.length));
    }
    return this.channels.get(channel)!;
  }
}

class FakeBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  stoppedAt: number[] = [];
  connect(): void {}
  start(): void {}
  stop(time?: number): void {
    this.stoppedAt.push(time ?? -1);
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  oscillators: FakeOscillatorNode[] = [];
  bufferSources: FakeBufferSourceNode[] = [];

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }
  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }
}

// Builds real, decodable SOUND-resource bytes (see src/resources/sound.ts
// for the format) so tests exercise the actual decoder rather than a fake.
function encodeNote(durationTicks: number, divisor: number, attenuationNibble: number): number[] {
  return [
    durationTicks & 0xff,
    (durationTicks >> 8) & 0xff,
    divisor & 0x3f,
    (divisor >> 6) & 0x0f,
    attenuationNibble & 0x0f,
  ];
}

function buildSoundBytes(voiceNotes: Array<Array<{ durationTicks: number; divisor: number; attenuationNibble: number }>>): Uint8Array {
  const voiceBytes = voiceNotes.map((notes) => {
    const bytes: number[] = [];
    for (const note of notes) bytes.push(...encodeNote(note.durationTicks, note.divisor, note.attenuationNibble));
    bytes.push(0xff, 0xff);
    return bytes;
  });

  const header: number[] = [];
  let offset = voiceBytes.length * 2;
  for (const bytes of voiceBytes) {
    header.push(offset & 0xff, (offset >> 8) & 0xff);
    offset += bytes.length;
  }

  return new Uint8Array([...header, ...voiceBytes.flat()]);
}

/** A single full-volume tone note of the given duration in voice 0, silence elsewhere. */
function toneSoundBytes(durationTicks: number): Uint8Array {
  return buildSoundBytes([[{ durationTicks, divisor: 100, attenuationNibble: 0 }], [], [], []]);
}

/** A sound with no notes in any voice - total duration 0. */
function emptySoundBytes(): Uint8Array {
  return buildSoundBytes([[], [], [], []]);
}

const DONE_FLAG = 41;

describe('SoundController', () => {
  let state: VmState;
  let audioContext: FakeAudioContext;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new VmState();
    audioContext = new FakeAudioContext();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function controller(soundLoader: (n: number) => Uint8Array | undefined = () => undefined): SoundController {
    return new SoundController({ state, audioContext: audioContext as unknown as AudioContext, soundLoader });
  }

  it('load.sound() decodes and caches the resource exactly once', () => {
    const loader = vi.fn(() => emptySoundBytes());
    const ctrl = controller(loader);

    ctrl.loadSound(5);
    ctrl.loadSound(5);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('load.sound() with no loader configured logs once and does not throw', () => {
    const logger = vi.fn();
    const ctrl = new SoundController({ state, audioContext: audioContext as unknown as AudioContext, logger });

    expect(() => ctrl.loadSound(99)).not.toThrow();
    ctrl.loadSound(99);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0][0]).toContain('99');
  });

  it('play() schedules playback on the audio sink and sets the done flag once the sound finishes', () => {
    const ctrl = controller(() => toneSoundBytes(60)); // 60 ticks == 1 second
    ctrl.loadSound(3);

    ctrl.play(3, DONE_FLAG);

    expect(audioContext.oscillators).toHaveLength(1);
    expect(state.getFlag(DONE_FLAG)).toBe(false);

    vi.advanceTimersByTime(999);
    expect(state.getFlag(DONE_FLAG)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(state.getFlag(DONE_FLAG)).toBe(true);
  });

  it('play() auto-loads the resource via the configured loader when load.sound was not called first', () => {
    const loader = vi.fn(() => emptySoundBytes());
    const ctrl = controller(loader);

    ctrl.play(7, DONE_FLAG);

    expect(loader).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(0);
    expect(state.getFlag(DONE_FLAG)).toBe(true);
  });

  it('play() logs once and does not set the flag when the resource cannot be loaded', () => {
    const logger = vi.fn();
    const ctrl = new SoundController({ state, audioContext: audioContext as unknown as AudioContext, logger });

    ctrl.play(123, DONE_FLAG);

    vi.advanceTimersByTime(10_000);
    expect(state.getFlag(DONE_FLAG)).toBe(false);
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('honors the sound-enabled flag: when sound is off, play() skips the audio sink and sets the flag immediately', () => {
    const ctrl = controller(() => toneSoundBytes(60));
    state.setSoundEnabled(false);

    ctrl.play(2, DONE_FLAG);

    expect(audioContext.oscillators).toHaveLength(0);
    expect(state.getFlag(DONE_FLAG)).toBe(true);
  });

  it('starting a new sound stops whatever was already playing and never sets its done flag', () => {
    const ctrl = controller((n) => toneSoundBytes(n === 1 ? 600 : 60)); // sound 1: 10s, sound 2: 1s
    const otherDoneFlag = 50;

    ctrl.play(1, DONE_FLAG);
    const stopsAfterFirstPlay = audioContext.oscillators[0].stoppedAt.length;

    ctrl.play(2, otherDoneFlag);
    // play() interrupts the prior sound via handle.stop(), an extra stop()
    // call on top of the natural one playSound() schedules up front.
    expect(audioContext.oscillators[0].stoppedAt.length).toBeGreaterThan(stopsAfterFirstPlay);

    vi.advanceTimersByTime(20_000);
    expect(state.getFlag(DONE_FLAG)).toBe(false);
    expect(state.getFlag(otherDoneFlag)).toBe(true);
  });

  it('stop() stops the currently playing sound and never sets its done flag', () => {
    const ctrl = controller(() => toneSoundBytes(600));

    ctrl.play(1, DONE_FLAG);
    ctrl.stop();

    expect(audioContext.oscillators[0].stoppedAt.length).toBeGreaterThanOrEqual(1);
    vi.advanceTimersByTime(20_000);
    expect(state.getFlag(DONE_FLAG)).toBe(false);
  });

  it('stop() with nothing playing is a safe no-op', () => {
    const ctrl = controller();
    expect(() => ctrl.stop()).not.toThrow();
  });

  describe('commands', () => {
    it('exposes load.sound/sound/stop.sound wired to a CommandContext-shaped call', () => {
      const ctrl = controller(() => emptySoundBytes());
      const { commands } = ctrl;

      commands['load.sound']({ state, args: [4] });
      commands['sound']({ state, args: [4, DONE_FLAG] });
      vi.advanceTimersByTime(0);
      expect(state.getFlag(DONE_FLAG)).toBe(true);

      commands['stop.sound']({ state, args: [] });
      expect(() => commands['stop.sound']({ state, args: [] })).not.toThrow();
    });

    it('ignores non-numeric args rather than throwing', () => {
      const ctrl = controller();
      const { commands } = ctrl;
      expect(() => commands['load.sound']({ state, args: ['nope'] })).not.toThrow();
      expect(() => commands['sound']({ state, args: ['nope', 'also-nope'] })).not.toThrow();
    });
  });
});
