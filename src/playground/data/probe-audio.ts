// The clip a transcription Probe sends: one second of silence as a WAV file,
// 16 kHz mono 16-bit PCM, the format speech recognition models take everywhere.
// Built here rather than shipped as a file, so the build has no asset to copy.

const SAMPLE_RATE_HZ = 16_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const DURATION_SECONDS = 1;
const RIFF_HEADER_BYTES = 44;
const FMT_CHUNK_BYTES = 16;
const PCM_FORMAT = 1;
const BITS_PER_BYTE = 8;

/** The WAV file's bytes. */
function silentWav(): Buffer {
  const dataBytes = SAMPLE_RATE_HZ * CHANNELS * BYTES_PER_SAMPLE * DURATION_SECONDS;
  const wav = Buffer.alloc(RIFF_HEADER_BYTES + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(RIFF_HEADER_BYTES - 8 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(FMT_CHUNK_BYTES, 16);
  wav.writeUInt16LE(PCM_FORMAT, 20);
  wav.writeUInt16LE(CHANNELS, 22);
  wav.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  wav.writeUInt32LE(SAMPLE_RATE_HZ * CHANNELS * BYTES_PER_SAMPLE, 28);
  wav.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(BYTES_PER_SAMPLE * BITS_PER_BYTE, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

export const PROBE_AUDIO_CONTENT_TYPE = "audio/wav";
export const PROBE_AUDIO_FILE_NAME = "probe.wav";
export const PROBE_AUDIO_DATA_URI = `data:${PROBE_AUDIO_CONTENT_TYPE};base64,${silentWav().toString("base64")}`;
