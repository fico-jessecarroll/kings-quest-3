import { describe, expect, it } from 'vitest';
import { playSound, type DecodedSound } from '../../src/resources/sound';

// Minimal fakes for the slice of the Web Audio API playSound() touches.
// These let us test scheduling logic without any real audio hardware.

class FakeAudioParam {
  value = 0;
}

class FakeOscillatorNode {
  type = 'sine';
  frequency = new FakeAudioParam();
  connectedTo: unknown[] = [];
  startedAt: number[] = [];
  stoppedAt: number[] = [];
  connect(target: unknown): void {
    this.connectedTo.push(target);
  }
  start(time: number): void {
    this.startedAt.push(time);
  }
  stop(time?: number): void {
    this.stoppedAt.push(time ?? -1);
  }
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connectedTo: unknown[] = [];
  connect(target: unknown): void {
    this.connectedTo.push(target);
  }
}

class FakeAudioBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  private channels = new Map<number, Float32Array>();
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
  connectedTo: unknown[] = [];
  startedAt: number[] = [];
  stoppedAt: number[] = [];
  connect(target: unknown): void {
    this.connectedTo.push(target);
  }
  start(time: number): void {
    this.startedAt.push(time);
  }
  stop(time?: number): void {
    this.stoppedAt.push(time ?? -1);
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  destination = { isDestination: true };
  oscillators: FakeOscillatorNode[] = [];
  gains: FakeGainNode[] = [];
  bufferSources: FakeBufferSourceNode[] = [];
  buffers: FakeAudioBuffer[] = [];

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }
  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }
}

function soundWithVoices(voices: DecodedSound['voices']): DecodedSound {
  return { voices };
}

describe('playSound', () => {
  it('plays a tone voice note as a square-wave oscillator at the note frequency and volume', () => {
    const ctx = new FakeAudioContext();
    const sound = soundWithVoices([
      [{ durationTicks: 30, frequencyHz: 440, volume: 0.5 }],
      [],
      [],
      [],
    ]);

    playSound(ctx as unknown as AudioContext, sound);

    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].type).toBe('square');
    expect(ctx.oscillators[0].frequency.value).toBe(440);
    expect(ctx.gains[0].gain.value).toBe(0.5);
    expect(ctx.oscillators[0].connectedTo).toEqual([ctx.gains[0]]);
    expect(ctx.gains[0].connectedTo).toEqual([ctx.destination]);
  });

  it('schedules sequential notes back-to-back using durationTicks converted to seconds', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 10;
    const sound = soundWithVoices([
      [
        { durationTicks: 60, frequencyHz: 100, volume: 1 },
        { durationTicks: 30, frequencyHz: 200, volume: 1 },
      ],
      [],
      [],
      [],
    ]);

    playSound(ctx as unknown as AudioContext, sound);

    expect(ctx.oscillators[0].startedAt[0]).toBeCloseTo(10);
    expect(ctx.oscillators[0].stoppedAt[0]).toBeCloseTo(11);
    expect(ctx.oscillators[1].startedAt[0]).toBeCloseTo(11);
    expect(ctx.oscillators[1].stoppedAt[0]).toBeCloseTo(11.5);
  });

  it('does not create any node for a silent (volume 0) rest', () => {
    const ctx = new FakeAudioContext();
    const sound = soundWithVoices([
      [{ durationTicks: 30, frequencyHz: 440, volume: 0 }],
      [],
      [],
      [],
    ]);

    playSound(ctx as unknown as AudioContext, sound);

    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.gains).toHaveLength(0);
  });

  it('plays the noise voice through a looping noise buffer instead of an oscillator', () => {
    const ctx = new FakeAudioContext();
    const sound = soundWithVoices([
      [],
      [],
      [],
      [{ durationTicks: 30, frequencyHz: 0, volume: 1 }],
    ]);

    playSound(ctx as unknown as AudioContext, sound);

    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.bufferSources).toHaveLength(1);
    expect(ctx.bufferSources[0].loop).toBe(true);
    expect(ctx.bufferSources[0].buffer).toBe(ctx.buffers[0]);
    expect(ctx.bufferSources[0].connectedTo).toEqual([ctx.gains[0]]);
  });

  it('reuses a single noise buffer across multiple noise-voice notes', () => {
    const ctx = new FakeAudioContext();
    const sound = soundWithVoices([
      [],
      [],
      [],
      [
        { durationTicks: 10, frequencyHz: 0, volume: 1 },
        { durationTicks: 10, frequencyHz: 0, volume: 1 },
      ],
    ]);

    playSound(ctx as unknown as AudioContext, sound);

    expect(ctx.buffers).toHaveLength(1);
    expect(ctx.bufferSources).toHaveLength(2);
  });

  it('stop() stops every scheduled node', () => {
    const ctx = new FakeAudioContext();
    const sound = soundWithVoices([
      [{ durationTicks: 30, frequencyHz: 440, volume: 1 }],
      [],
      [],
      [{ durationTicks: 30, frequencyHz: 0, volume: 1 }],
    ]);

    const handle = playSound(ctx as unknown as AudioContext, sound);
    handle.stop();

    expect(ctx.oscillators[0].stoppedAt.length).toBeGreaterThanOrEqual(1);
    expect(ctx.bufferSources[0].stoppedAt.length).toBeGreaterThanOrEqual(1);
  });

  it('does not throw if a node throws on stop() (already stopped/ended)', () => {
    const ctx = new FakeAudioContext();
    const sound = soundWithVoices([
      [{ durationTicks: 30, frequencyHz: 440, volume: 1 }],
      [],
      [],
      [],
    ]);
    const handle = playSound(ctx as unknown as AudioContext, sound);
    ctx.oscillators[0].stop = () => {
      throw new Error('already stopped');
    };

    expect(() => handle.stop()).not.toThrow();
  });
});
