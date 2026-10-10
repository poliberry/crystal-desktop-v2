import type { Channel, Sound } from "./structures";
import type { Client } from "./client";
import { CrystalError } from "./errors";

/** The sounds Crystal ships with, which every client can play from the name alone. */
export const BuiltinSounds = ["ping", "boop", "pop", "chime", "buzz", "zap", "horn", "drumroll"] as const;
/** The name of a sound every Crystal client has. */
export type BuiltinSoundName = (typeof BuiltinSounds)[number];

/** The audio Crystal clients hear is 48 kHz mono 16-bit PCM; anything else is converted for you. */
const SAMPLE_RATE = 48000;

/** Raw 16-bit PCM audio. `readWav` makes one from a WAV file. */
export interface PcmAudio {
  /** The audio, one 16-bit sample after another (channels interleaved). */
  samples: Int16Array;
  /** Samples per second, per channel. */
  sampleRate: number;
  /** 1 for mono, 2 for stereo. */
  channels: number;
}

/** Read a 16-bit PCM WAV file (the plain, uncompressed kind). Other formats need converting first, e.g. with ffmpeg. */
export function readWav(bytes: Uint8Array): PcmAudio {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new CrystalError("That isn't a WAV file.");
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (o + 8 <= bytes.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new CrystalError("Only 16-bit PCM WAV files can be played. Convert it first (for example: ffmpeg -i in.mp3 out.wav).");
      const end = Math.min(o + 8 + size, bytes.byteLength);
      const n = Math.floor((end - (o + 8)) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(o + 8 + i * 2, true);
      return { samples, sampleRate: fmt.rate, channels: fmt.channels };
    }
    o += 8 + size + (size % 2);
  }
  throw new CrystalError("That WAV file has no audio in it.");
}

/** To 48 kHz mono, by averaging channels and linear interpolation: plenty for speech and effects. */
export function toMono48k(a: PcmAudio): Int16Array {
  const frames = Math.floor(a.samples.length / a.channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < a.channels; c++) sum += a.samples[i * a.channels + c];
    mono[i] = sum / a.channels;
  }
  if (a.sampleRate === SAMPLE_RATE) return Int16Array.from(mono, Math.round);
  const outLen = Math.floor((frames * SAMPLE_RATE) / a.sampleRate);
  const out = new Int16Array(outLen);
  const ratio = a.sampleRate / SAMPLE_RATE;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const f = pos - i0;
    out[i] = Math.round(mono[i0] * (1 - f) + (mono[Math.min(i0 + 1, frames - 1)] ?? 0) * f);
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Lk = any;

/**
 * A bot in a voice channel. It can speak (play audio) and press soundboard clips. It cannot share
 * video or a screen: the token Crystal gives it only allows a microphone, so the server refuses
 * anything else regardless of what code tries.
 *
 * The connection uses LiveKit's Node client, an optional dependency; the voice guide says how to install it.
 * Everything else in this SDK works without it.
 */
export class VoiceConnection {
  private disconnected = false;
  private audio: { source: any; track: any } | null = null;
  private playing: { stop: boolean } | null = null;

  private constructor(
    /** The client it belongs to. */
    readonly client: Client,
    /** The voice channel it is in. */
    readonly channel: Channel,
    private readonly lk: Lk,
    private readonly room: any,
  ) {}

  /** Join a voice channel and return the connection. Usually you call `channel.join()` instead. */
  static async connect(client: Client, channel: Channel): Promise<VoiceConnection> {
    let lk: Lk;
    try {
      lk = await import(/* @vite-ignore */ "@livekit/rtc-node" as string);
    } catch {
      throw new CrystalError("Voice needs LiveKit's Node client. Install it with: npm install @livekit/rtc-node");
    }
    const joined = await client.rest.post<{ url: string; token: string; identity: string }>(`/channels/${channel.id}/voice/join`);
    const room = new lk.Room();
    try {
      await room.connect(joined.url, joined.token, { autoSubscribe: false, dynacast: false });
    } catch (e) {
      // Not connected: don't leave the bot shown in the channel.
      await client.rest.post(`/channels/${channel.id}/voice/leave`).catch(() => undefined);
      throw new CrystalError(`Couldn't connect to the voice server: ${(e as Error).message}`);
    }
    const conn = new VoiceConnection(client, channel, lk, room);
    room.on(lk.RoomEvent.Disconnected, () => {
      conn.disconnected = true;
      client.voice.delete(channel.id);
    });
    client.voice.set(channel.id, conn);
    return conn;
  }

  /** Whether the bot is still in the channel. */
  get connected() {
    return !this.disconnected;
  }

  private async ensureAudio() {
    if (this.audio) return this.audio;
    const source = new this.lk.AudioSource(SAMPLE_RATE, 1);
    const track = this.lk.LocalAudioTrack.createAudioTrack("bot-audio", source);
    await this.room.localParticipant.publishTrack(track, new this.lk.TrackPublishOptions({ source: this.lk.TrackSource.SOURCE_MICROPHONE }));
    this.audio = { source, track };
    return this.audio;
  }

  /**
   * Speak: play PCM audio into the channel, in 10 ms pieces so it can be stopped. Resolves when it
   * has finished (or been stopped). WAV files: `await conn.play(readWav(bytes))`.
   */
  async play(audio: PcmAudio | Int16Array): Promise<void> {
    if (this.disconnected) throw new CrystalError("This voice connection has ended.");
    const samples = audio instanceof Int16Array ? audio : toMono48k(audio);
    const { source } = await this.ensureAudio();
    this.stop();
    const run = { stop: false };
    this.playing = run;
    const frame = SAMPLE_RATE / 100;
    for (let i = 0; i < samples.length && !run.stop && !this.disconnected; i += frame) {
      const chunk = samples.subarray(i, i + frame);
      const padded = chunk.length === frame ? chunk : Int16Array.from({ length: frame }, (_, k) => chunk[k] ?? 0);
      await source.captureFrame(new this.lk.AudioFrame(padded, SAMPLE_RATE, 1, frame));
    }
    if (!run.stop) await source.waitForPlayout().catch(() => undefined);
    if (this.playing === run) this.playing = null;
  }

  /** Stop whatever `play` is playing. */
  stop(): void {
    if (this.playing) this.playing.stop = true;
    this.audio?.source.clearQueue?.();
  }

  /**
   * Press a soundboard clip, exactly as a person does: it is announced to everyone in the channel,
   * whose apps play it. Pass an uploaded `Sound`, or a built-in by name (`"horn"`).
   */
  async playSound(sound: Sound | BuiltinSoundName | `builtin:${BuiltinSoundName}`): Promise<void> {
    if (this.disconnected) throw new CrystalError("This voice connection has ended.");
    let packet: Record<string, unknown>;
    if (typeof sound === "string") {
      const name = sound.replace(/^builtin:/, "");
      if (!(BuiltinSounds as readonly string[]).includes(name)) throw new CrystalError(`“${sound}” isn't a built-in sound. The built-ins are: ${BuiltinSounds.join(", ")}.`);
      packet = { kind: "soundboard", soundId: `builtin:${name}`, name };
    } else {
      packet = { kind: "soundboard", soundId: sound.id, name: sound.name, url: sound.url, ...(sound.emoji ? { emoji: sound.emoji } : {}) };
    }
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(packet)), { reliable: true, topic: "soundboard" });
  }

  /** Show the bot as muted or deafened in the channel's list. */
  async setState(state: { muted?: boolean; deafened?: boolean }): Promise<void> {
    await this.client.rest.put(`/channels/${this.channel.id}/voice/state`, state);
  }

  /** Leave the channel. */
  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;
    this.stop();
    await this.client.rest.post(`/channels/${this.channel.id}/voice/leave`).catch(() => undefined);
    await this.room.disconnect().catch(() => undefined);
    this.client.voice.delete(this.channel.id);
  }
}
