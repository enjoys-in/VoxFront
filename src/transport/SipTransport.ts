// Transport stub for the final "AI / SIP server" stage of the pipeline.
//
// Two realistic options exist for shipping the processed audio:
//   1. Real-time call: attach `AudioEngine.processedStream` directly to an
//      RTCPeerConnection (WebRTC/SIP-over-WebRTC). The browser then handles
//      Opus encoding + RTP. This is the recommended production path.
//   2. Streaming to an AI backend: encode locally (Opus via MediaRecorder) and
//      push compressed chunks over a WebSocket. That is what this stub does, to
//      demonstrate the "compress audio" box before the server.

export interface TransportStats {
  connected: boolean;
  chunks: number;
  bytes: number;
}

export interface SipTransportCallbacks {
  onStats?: (stats: TransportStats) => void;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

export class SipTransport {
  private recorder: MediaRecorder | null = null;
  private ws: WebSocket | null = null;
  private chunks = 0;
  private bytes = 0;

  constructor(private readonly cb: SipTransportCallbacks = {}) {}

  get isActive(): boolean {
    return this.recorder !== null;
  }

  /**
   * Start encoding `stream` to Opus and (optionally) streaming it to `url`.
   * `timesliceMs` controls packet cadence.
   */
  start(stream: MediaStream, url?: string, timesliceMs = 200): void {
    if (this.recorder) return;
    this.chunks = 0;
    this.bytes = 0;

    if (url) {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => this.emit();
      this.ws.onclose = () => this.emit();
      this.ws.onerror = () => this.emit();
    }

    const mimeType = pickMimeType();
    const options: MediaRecorderOptions = { audioBitsPerSecond: 24_000 };
    if (mimeType) options.mimeType = mimeType;

    this.recorder = new MediaRecorder(stream, options);
    this.recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      this.chunks += 1;
      this.bytes += e.data.size;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        e.data.arrayBuffer().then((buf) => this.ws?.send(buf)).catch(() => {});
      }
      this.emit();
    };
    this.recorder.start(timesliceMs);
    this.emit();
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.ws?.close();
    this.ws = null;
    this.emit();
  }

  private emit(): void {
    this.cb.onStats?.({
      connected: this.ws?.readyState === WebSocket.OPEN,
      chunks: this.chunks,
      bytes: this.bytes,
    });
  }
}
