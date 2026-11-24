// Turns a live audio stream into caption segments while recording.
// Audio is cut at natural pauses (or every ~8s) and sent to the local Whisper worker.
import { capDurations } from '@shared/captions';
import type { CaptionSegment } from '@shared/types';
import { transcriber } from './transcriber';

const RATE = 16000;
const MAX_CHUNK = 5;
const MIN_CHUNK = 2;
const SILENCE_RMS = 0.012;
const PAUSE = 0.35;

export class LiveCaptioner {
  segments: CaptionSegment[] = [];
  private ctx: AudioContext;
  private node: ScriptProcessorNode;
  private parts: Float32Array[] = [];
  private length = 0;
  private chunkStart = 0;
  private silent = 0;
  private voiced = 0;
  private pendingWork: Promise<void> = Promise.resolve();
  /** Chunks waiting to be transcribed. */
  backlog = 0;

  constructor(
    stream: MediaStream,
    private elapsed: () => number,
    private recording: () => boolean,
    private language: string,
    private onText: (text: string) => void,
  ) {
    this.ctx = new AudioContext({ sampleRate: RATE });
    const src = this.ctx.createMediaStreamSource(stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.node);
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
    this.node.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
  }

  private onAudio(data: Float32Array) {
    if (!this.recording()) {
      if (this.length) this.flush();
      return;
    }
    if (!this.length) this.chunkStart = Math.max(0, this.elapsed() - data.length / RATE);
    this.parts.push(new Float32Array(data));
    this.length += data.length;
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    const dur = data.length / RATE;
    if (rms < SILENCE_RMS) this.silent += dur;
    else {
      this.silent = 0;
      this.voiced += dur;
    }
    const total = this.length / RATE;
    // When transcription falls behind (slow CPU), send bigger chunks: fewer, longer runs catch up faster.
    const max = this.backlog >= 2 ? MAX_CHUNK * 3 : MAX_CHUNK;
    const min = this.backlog >= 2 ? MAX_CHUNK * 2 : MIN_CHUNK;
    if (total >= max || (total >= min && this.silent >= PAUSE)) this.flush();
  }

  private flush() {
    const audio = new Float32Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      audio.set(p, o);
      o += p.length;
    }
    const start = this.chunkStart;
    const hadVoice = this.voiced > 0.3;
    this.parts = [];
    this.length = 0;
    this.silent = 0;
    this.voiced = 0;
    if (!hadVoice) return; // skip silence: Whisper invents text for it
    this.backlog++;
    this.pendingWork = this.pendingWork.then(() =>
      transcriber
        .transcribe(audio, start, this.language)
        .then((segs) => {
          if (!segs.length) return;
          this.segments.push(...segs);
          this.onText(segs.map((s) => s.text).join(' '));
        })
        .catch((err) => console.warn('Live caption chunk failed:', err))
        .finally(() => {
          this.backlog--;
        }),
    );
  }

  /** Stop listening and wait for the last chunks to be transcribed. */
  async stop(): Promise<CaptionSegment[]> {
    if (this.length) this.flush();
    this.node.onaudioprocess = null;
    this.node.disconnect();
    await this.ctx.close().catch(() => undefined);
    await this.pendingWork;
    return capDurations([...this.segments].sort((a, b) => a.start - b.start));
  }
}
