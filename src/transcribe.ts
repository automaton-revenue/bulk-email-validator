/**
 * Speech to text: one public audio/video URL in, the transcript out (text,
 * detected language, duration, timed segments, WebVTT). Runs Whisper large v3
 * turbo on Cloudflare Workers AI, so there is no third-party key.
 */
import { USER_AGENT } from "./net.js";

export const MODEL = "@cf/openai/whisper-large-v3-turbo";
export const MAX_AUDIO_BYTES = 20_000_000;

export interface Audio { status: number; contentType: string; bytes: Uint8Array | null; tooLarge: boolean }
export type FetchAudio = (url: string) => Promise<Audio | null>;
/** The part of the Workers AI binding this tool uses. */
export interface SpeechModel { run(model: string, input: Record<string, unknown>): Promise<unknown> }

export interface TranscribeResult {
  url: string; text: string; language: string | null; durationSeconds: number | null; words: number;
  segments: { start: number; end: number; text: string }[];
  vtt: string | null; model: string; transcribedAt: string;
}

const AUDIO_TYPE = /^(audio\/|video\/(mp4|webm|ogg|quicktime|x-matroska)|application\/(ogg|octet-stream))/i;

export const liveFetchAudio: FetchAudio = async (url) => {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": USER_AGENT, Accept: "audio/*,video/*;q=0.8,*/*;q=0.5" }, signal: AbortSignal.timeout(30_000) });
    const contentType = res.headers.get("content-type") ?? "";
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || declared > MAX_AUDIO_BYTES || !AUDIO_TYPE.test(contentType)) {
      await res.body?.cancel();
      return { status: res.status, contentType, bytes: null, tooLarge: declared > MAX_AUDIO_BYTES };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    for (;;) {
      if (!reader) break;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) { await reader.cancel(); return { status: res.status, contentType, bytes: null, tooLarge: true }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    return { status: res.status, contentType, bytes, tooLarge: false };
  } catch {
    return null;
  }
};

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  // Chunked: String.fromCharCode with one huge spread overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function transcribe(target: string, ai: SpeechModel | undefined, fetchAudio: FetchAudio = liveFetchAudio): Promise<TranscribeResult | { error: string }> {
  if (!ai) return { error: "transcription engine is not configured" };
  const audio = await fetchAudio(target);
  if (!audio) return { error: "the audio host did not answer; nothing was transcribed" };
  if (audio.tooLarge) return { error: `audio is larger than ${MAX_AUDIO_BYTES / 1_000_000} MB` };
  if (audio.status >= 400) return { error: `the audio host answered HTTP ${audio.status}` };
  if (!audio.bytes || !AUDIO_TYPE.test(audio.contentType)) return { error: `unsupported content type ${audio.contentType || "unknown"} (audio or video files only)` };
  if (audio.bytes.byteLength === 0) return { error: "the audio file is empty" };

  let out: {
    text?: string; word_count?: number; vtt?: string;
    transcription_info?: { language?: string; duration?: number };
    segments?: { start?: number; end?: number; text?: string }[];
  };
  try {
    out = await ai.run(MODEL, { audio: toBase64(audio.bytes), vad_filter: true }) as typeof out;
  } catch {
    return { error: "the speech model could not decode this file" };
  }
  if (typeof out?.text !== "string") return { error: "the speech model returned no transcript" };
  const text = out.text.trim();
  return {
    url: target, text,
    language: out.transcription_info?.language ?? null,
    durationSeconds: typeof out.transcription_info?.duration === "number" ? Math.round(out.transcription_info.duration * 10) / 10 : null,
    words: out.word_count ?? text.split(/\s+/).filter(Boolean).length,
    segments: (out.segments ?? []).map((s) => ({ start: s.start ?? 0, end: s.end ?? 0, text: (s.text ?? "").trim() })),
    vtt: out.vtt ?? null, model: MODEL, transcribedAt: new Date().toISOString(),
  };
}
