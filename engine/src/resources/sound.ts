// AGI v2 SOUND resource decoder + Web Audio playback.
//
// A SOUND resource has a 4-word (little-endian) header giving the byte
// offset, relative to the start of the resource, of each of the 4 voices'
// note data: voices 0-2 are square-wave tone voices, voice 3 is the noise
// voice. Each voice is a sequence of 5-byte notes terminated by the 2-byte
// marker 0xFFFF:
//
//   byte 0-1: duration, in 1/60s ticks (little-endian)
//   byte 2:   frequency low byte - bits 0-5 are the low 6 bits of a 10-bit
//             PSG frequency divisor; bits 6-7 are unused padding
//   byte 3:   frequency high byte - bits 0-3 are the high 4 bits of the
//             divisor; bits 4-7 are unused padding
//   byte 4:   attenuation - bits 0-3 hold the PSG volume nibble (0 = loudest,
//             15 = silent); bits 4-7 are unused padding
//
// The unused padding bits in bytes 2-4 vary per voice in real resources but
// don't affect playback, so they're masked off rather than asserted on.

export const TICKS_PER_SECOND = 60;
export const TONE_VOICE_COUNT = 3;
export const NOISE_VOICE_INDEX = 3;
export const VOICE_COUNT = 4;
export const SOUND_END_MARKER = 0xffff;

// PCjr/Tandy PSG clock (NTSC colorburst) divided by the chip's internal /32
// prescaler; the resulting frequency is this value divided by the note's
// 10-bit divisor.
const PSG_TONE_CLOCK_HZ = 3579545 / 32;

export interface SoundNote {
  durationTicks: number;
  frequencyHz: number;
  /** Normalized volume: 0 = silent, 1 = full volume. */
  volume: number;
}

export type SoundVoice = SoundNote[];

export interface DecodedSound {
  /** 4 voices: 3 square-wave tone voices followed by 1 noise voice. */
  voices: [SoundVoice, SoundVoice, SoundVoice, SoundVoice];
}

export function decodeSound(bytes: Uint8Array): DecodedSound {
  if (bytes.length < VOICE_COUNT * 2) {
    throw new Error('SOUND resource too short: missing channel header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const voices: SoundVoice[] = [];
  for (let voiceIndex = 0; voiceIndex < VOICE_COUNT; voiceIndex++) {
    const offset = view.getUint16(voiceIndex * 2, true);
    voices.push(decodeVoice(view, voiceIndex, offset));
  }

  return { voices: voices as DecodedSound['voices'] };
}

function decodeVoice(view: DataView, voiceIndex: number, offset: number): SoundVoice {
  const notes: SoundNote[] = [];
  let position = offset;

  for (;;) {
    if (position + 2 > view.byteLength) {
      throw new Error(
        `SOUND voice ${voiceIndex}: truncated before end marker (offset ${position})`,
      );
    }

    const durationTicks = view.getUint16(position, true);
    if (durationTicks === SOUND_END_MARKER) {
      return notes;
    }

    if (position + 5 > view.byteLength) {
      throw new Error(`SOUND voice ${voiceIndex}: truncated note at offset ${position}`);
    }

    const freqLow = view.getUint8(position + 2);
    const freqHigh = view.getUint8(position + 3);
    const attenuation = view.getUint8(position + 4);

    const divisor = (freqLow & 0x3f) | ((freqHigh & 0x0f) << 6);
    const frequencyHz = divisor > 0 ? PSG_TONE_CLOCK_HZ / divisor : 0;
    const volume = (15 - (attenuation & 0x0f)) / 15;

    notes.push({ durationTicks, frequencyHz, volume });
    position += 5;
  }
}

export interface SoundPlaybackHandle {
  stop(): void;
}

export interface PlaySoundOptions {
  startTime?: number;
}

/**
 * Schedules a decoded sound on a Web Audio graph. The AudioContext is
 * injected rather than created here so this is testable with a fake context
 * and never touches real audio hardware in unit tests.
 */
export function playSound(
  audioContext: AudioContext,
  sound: DecodedSound,
  options: PlaySoundOptions = {},
): SoundPlaybackHandle {
  const startTime = options.startTime ?? audioContext.currentTime;
  const stoppers: Array<() => void> = [];
  let noiseBuffer: AudioBuffer | null = null;

  sound.voices.forEach((voice, voiceIndex) => {
    let time = startTime;
    for (const note of voice) {
      const durationSeconds = note.durationTicks / TICKS_PER_SECOND;

      if (note.volume > 0 && durationSeconds > 0) {
        const gainNode = audioContext.createGain();
        gainNode.gain.value = note.volume;
        gainNode.connect(audioContext.destination);

        if (voiceIndex === NOISE_VOICE_INDEX) {
          noiseBuffer ??= createNoiseBuffer(audioContext);
          const source = audioContext.createBufferSource();
          source.buffer = noiseBuffer;
          source.loop = true;
          source.connect(gainNode);
          source.start(time);
          source.stop(time + durationSeconds);
          stoppers.push(() => source.stop());
        } else {
          const oscillator = audioContext.createOscillator();
          oscillator.type = 'square';
          oscillator.frequency.value = note.frequencyHz;
          oscillator.connect(gainNode);
          oscillator.start(time);
          oscillator.stop(time + durationSeconds);
          stoppers.push(() => oscillator.stop());
        }
      }

      time += durationSeconds;
    }
  });

  return {
    stop() {
      for (const stop of stoppers) {
        try {
          stop();
        } catch {
          // Already stopped/ended; nothing to do.
        }
      }
    },
  };
}

function createNoiseBuffer(audioContext: AudioContext): AudioBuffer {
  const length = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}
