import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  decodeSound,
  NOISE_VOICE_INDEX,
  SOUND_END_MARKER,
  TONE_VOICE_COUNT,
  VOICE_COUNT,
  type SoundNote,
} from '../../src/resources/sound';
import { listSndFiles, repoPath } from '../helpers/assets';

interface RawNote {
  durationTicks: number;
  /** 10-bit PSG frequency divisor; 0 produces frequencyHz === 0. */
  divisor: number;
  /** PSG attenuation nibble: 0 = loudest, 15 = silent. */
  attenuationNibble: number;
  /** Unused padding bits, defaults exercise that they're ignored. */
  padding?: { freqLowTop?: number; freqHighTop?: number; attenuationTop?: number };
}

function encodeNote(note: RawNote): number[] {
  const freqLow =
    (note.divisor & 0x3f) | (((note.padding?.freqLowTop ?? 0) & 0x03) << 6);
  const freqHigh =
    ((note.divisor >> 6) & 0x0f) | (((note.padding?.freqHighTop ?? 0) & 0x0f) << 4);
  const attenuation =
    (note.attenuationNibble & 0x0f) | (((note.padding?.attenuationTop ?? 0) & 0x0f) << 4);
  return [
    note.durationTicks & 0xff,
    (note.durationTicks >> 8) & 0xff,
    freqLow,
    freqHigh,
    attenuation,
  ];
}

function buildSoundResource(voiceNotes: [RawNote[], RawNote[], RawNote[], RawNote[]]): Uint8Array {
  const voiceBytes = voiceNotes.map((notes) => {
    const bytes: number[] = [];
    for (const note of notes) {
      bytes.push(...encodeNote(note));
    }
    bytes.push(0xff, 0xff);
    return bytes;
  });

  const header: number[] = [];
  let offset = VOICE_COUNT * 2;
  for (const bytes of voiceBytes) {
    header.push(offset & 0xff, (offset >> 8) & 0xff);
    offset += bytes.length;
  }

  return new Uint8Array([...header, ...voiceBytes.flat()]);
}

function emptyVoices(): [RawNote[], RawNote[], RawNote[], RawNote[]] {
  return [[], [], [], []];
}

describe('decodeSound', () => {
  it('decodes duration ticks unchanged', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 42, divisor: 100, attenuationNibble: 0 }];
    const sound = decodeSound(buildSoundResource(voices));
    expect(sound.voices[0][0].durationTicks).toBe(42);
  });

  it('converts a PSG divisor into a frequency in Hz', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 1, divisor: 777, attenuationNibble: 0 }];
    const sound = decodeSound(buildSoundResource(voices));
    // PSG tone clock (3579545 / 32) divided by the divisor.
    expect(sound.voices[0][0].frequencyHz).toBeCloseTo(143.96, 1);
  });

  it('treats a zero divisor as silence (0 Hz) rather than dividing by zero', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 1, divisor: 0, attenuationNibble: 15 }];
    const sound = decodeSound(buildSoundResource(voices));
    expect(sound.voices[0][0].frequencyHz).toBe(0);
  });

  it('normalizes the attenuation nibble into a 0 (silent) - 1 (loudest) volume', () => {
    const voices = emptyVoices();
    voices[0] = [
      { durationTicks: 1, divisor: 100, attenuationNibble: 0 },
      { durationTicks: 1, divisor: 100, attenuationNibble: 15 },
      { durationTicks: 1, divisor: 100, attenuationNibble: 8 },
    ];
    const sound = decodeSound(buildSoundResource(voices));
    const [loudest, silent, mid] = sound.voices[0];
    expect(loudest.volume).toBe(1);
    expect(silent.volume).toBe(0);
    expect(mid.volume).toBeCloseTo(7 / 15);
  });

  it('ignores unused padding bits in the frequency and attenuation bytes', () => {
    const voices = emptyVoices();
    voices[0] = [
      {
        durationTicks: 1,
        divisor: 500,
        attenuationNibble: 5,
        padding: { freqLowTop: 0b10, freqHighTop: 0b1010, attenuationTop: 0b1111 },
      },
    ];
    const expectedSound = decodeSound(
      buildSoundResource([
        [{ durationTicks: 1, divisor: 500, attenuationNibble: 5 }],
        [],
        [],
        [],
      ]),
    );
    const actualSound = decodeSound(buildSoundResource(voices));
    expect(actualSound.voices[0][0]).toEqual(expectedSound.voices[0][0]);
  });

  it('stops a voice at the 0xFFFF end marker without consuming it as a note', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 1, divisor: 100, attenuationNibble: 0 }];
    const sound = decodeSound(buildSoundResource(voices));
    expect(sound.voices[0]).toHaveLength(1);
  });

  it('decodes all 4 voices (3 tone + 1 noise) independently', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 1, divisor: 10, attenuationNibble: 0 }];
    voices[1] = [
      { durationTicks: 2, divisor: 20, attenuationNibble: 0 },
      { durationTicks: 3, divisor: 30, attenuationNibble: 0 },
    ];
    voices[2] = [];
    voices[3] = [{ durationTicks: 4, divisor: 0, attenuationNibble: 0 }];

    const sound = decodeSound(buildSoundResource(voices));

    expect(sound.voices).toHaveLength(VOICE_COUNT);
    expect(sound.voices[0]).toHaveLength(1);
    expect(sound.voices[1]).toHaveLength(2);
    expect(sound.voices[1][1].durationTicks).toBe(3);
    expect(sound.voices[2]).toHaveLength(0);
    expect(sound.voices[NOISE_VOICE_INDEX]).toHaveLength(1);
    expect(TONE_VOICE_COUNT).toBe(3);
  });

  it('rejects data too short to contain the 4-voice header', () => {
    expect(() => decodeSound(new Uint8Array([0, 0, 0]))).toThrow(/header/i);
  });

  it('rejects a voice offset that has no room for the end marker', () => {
    // Header claims voice 0 starts right at the end of the buffer.
    const bytes = new Uint8Array([8, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => decodeSound(bytes)).toThrow(/truncated/i);
  });

  it('rejects a note truncated before its 5 bytes are available', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 1, divisor: 100, attenuationNibble: 0 }];
    const full = buildSoundResource(voices);
    // Drop the trailing end-marker bytes and the note's last byte so the
    // note's 5 bytes can't be fully read.
    const truncated = full.slice(0, full.length - 3);
    expect(() => decodeSound(truncated)).toThrow(/truncated/i);
  });

  it('rejects data with no 0xFFFF end marker for a voice', () => {
    const voices = emptyVoices();
    voices[0] = [{ durationTicks: 1, divisor: 100, attenuationNibble: 0 }];
    const full = buildSoundResource(voices);
    // Remove the 2-byte end marker entirely; reading past EOF should throw.
    const truncated = full.slice(0, full.length - 2);
    expect(() => decodeSound(truncated)).toThrow(/truncated/i);
  });

  it('round-trips on every real KQ3 SOUND resource without throwing', () => {
    const files = listSndFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = readFileSync(repoPath('SND', file));
      const sound = decodeSound(bytes);
      expect(sound.voices).toHaveLength(VOICE_COUNT);
      for (const voice of sound.voices) {
        for (const note of voice as SoundNote[]) {
          expect(note.durationTicks).toBeGreaterThanOrEqual(0);
          expect(note.frequencyHz).toBeGreaterThanOrEqual(0);
          expect(note.volume).toBeGreaterThanOrEqual(0);
          expect(note.volume).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('matches the end marker constant used by the format', () => {
    expect(SOUND_END_MARKER).toBe(0xffff);
  });
});
