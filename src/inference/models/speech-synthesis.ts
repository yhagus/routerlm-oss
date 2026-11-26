import type { FetchedMedia, MediaRequest } from './media-kind';

export const AUDIO_FORMATS = ['mp3', 'wav', 'pcm', 'opus'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export interface SpeechSynthesisRequest extends MediaRequest {
  text: string;
  voice: string;
  format: AudioFormat;
  speed: number | null;
}

export interface SynthesizedSpeech {
  audio: FetchedMedia;
  format: AudioFormat;
}
