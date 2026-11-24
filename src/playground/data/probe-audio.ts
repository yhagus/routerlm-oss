const SAMPLE_RATE_HZ = 16_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const DURATION_SECONDS = 1;
const FMT_CHUNK_BYTES = 16;
const PCM_FORMAT = 1;
const BITS_PER_BYTE = 8;

const HEADER_OFFSET = {
  riffId: 0,
  riffSize: 4,
  waveId: 8,
  fmtId: 12,
  fmtSize: 16,
  audioFormat: 20,
  channels: 22,
  sampleRate: 24,
  byteRate: 28,
  blockAlign: 32,
  bitsPerSample: 34,
  dataId: 36,
  dataSize: 40,
} as const;
const HEADER_BYTES = 44;
const RIFF_ID_AND_SIZE_BYTES = 8;

function silentWav(): Buffer {
  const dataBytes = SAMPLE_RATE_HZ * CHANNELS * BYTES_PER_SAMPLE * DURATION_SECONDS;
  const wav = Buffer.alloc(HEADER_BYTES + dataBytes);
  wav.write("RIFF", HEADER_OFFSET.riffId, "ascii");
  wav.writeUInt32LE(HEADER_BYTES - RIFF_ID_AND_SIZE_BYTES + dataBytes, HEADER_OFFSET.riffSize);
  wav.write("WAVE", HEADER_OFFSET.waveId, "ascii");
  wav.write("fmt ", HEADER_OFFSET.fmtId, "ascii");
  wav.writeUInt32LE(FMT_CHUNK_BYTES, HEADER_OFFSET.fmtSize);
  wav.writeUInt16LE(PCM_FORMAT, HEADER_OFFSET.audioFormat);
  wav.writeUInt16LE(CHANNELS, HEADER_OFFSET.channels);
  wav.writeUInt32LE(SAMPLE_RATE_HZ, HEADER_OFFSET.sampleRate);
  wav.writeUInt32LE(SAMPLE_RATE_HZ * CHANNELS * BYTES_PER_SAMPLE, HEADER_OFFSET.byteRate);
  wav.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, HEADER_OFFSET.blockAlign);
  wav.writeUInt16LE(BYTES_PER_SAMPLE * BITS_PER_BYTE, HEADER_OFFSET.bitsPerSample);
  wav.write("data", HEADER_OFFSET.dataId, "ascii");
  wav.writeUInt32LE(dataBytes, HEADER_OFFSET.dataSize);
  return wav;
}

export const PROBE_AUDIO_CONTENT_TYPE = "audio/wav";
export const PROBE_AUDIO_FILE_NAME = "probe.wav";
export const PROBE_AUDIO_DATA_URI = `data:${PROBE_AUDIO_CONTENT_TYPE};base64,${silentWav().toString("base64")}`;
