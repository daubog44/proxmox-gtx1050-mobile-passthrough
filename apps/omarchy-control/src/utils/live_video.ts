/**
 * Minimal low-latency player for the broker's fragmented MP4 feed.
 * Chunks are appended to a Media Source Extensions buffer; playback is kept
 * pinned to the live edge so the viewer never drifts behind the player.
 */
export interface LiveVideoPlayer {
  push(chunk: ArrayBuffer): void;
  destroy(): void;
}

const MAX_LATENCY_S = 0.6;
const KEEP_BACK_S = 4;

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function findBox(bytes: Uint8Array, type: string): number {
  const [a, b, c, d] = Array.from(type, (ch) => ch.charCodeAt(0));
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return i + 4;
  }
  return -1;
}

/**
 * Builds the RFC 6381 codec string from the init segment: `hvc1.*` from the
 * hvcC box (ISO/IEC 14496-15 Annex E), `avc1.*` from avcC as a fallback.
 */
function findCodec(bytes: Uint8Array): string | null {
  const hvcc = findBox(bytes, "hvcC");
  if (hvcc >= 0 && hvcc + 13 <= bytes.length) {
    const b1 = bytes[hvcc + 1];
    const space = ["", "A", "B", "C"][b1 >> 6];
    const tier = b1 & 0x20 ? "H" : "L";
    const profile = b1 & 0x1f;
    let compat = 0;
    for (let i = 0; i < 4; i++) compat = (compat << 8) | bytes[hvcc + 2 + i];
    let reversed = 0;
    for (let bit = 0; bit < 32; bit++) if (compat & (1 << bit)) reversed |= 1 << (31 - bit);
    const constraints = Array.from(bytes.slice(hvcc + 6, hvcc + 12));
    while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
    const level = bytes[hvcc + 12];
    return [`hvc1.${space}${profile}`, (reversed >>> 0).toString(16), `${tier}${level}`, ...constraints.map((c) => c.toString(16))].join(".");
  }
  const avcc = findBox(bytes, "avcC");
  if (avcc >= 0 && avcc + 4 <= bytes.length) {
    return `avc1.${hex2(bytes[avcc + 1])}${hex2(bytes[avcc + 2])}${hex2(bytes[avcc + 3])}`;
  }
  return null;
}

export function createLiveVideoPlayer(video: HTMLVideoElement, onError: (message: string) => void): LiveVideoPlayer {
  const MediaSourceImpl: typeof MediaSource | undefined =
    window.MediaSource ?? (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
  let destroyed = false;
  const pending: Uint8Array[] = [];
  let header = new Uint8Array(0);
  let sourceBuffer: SourceBuffer | null = null;
  let initializing = false;
  let objectUrl = "";

  if (!MediaSourceImpl) {
    onError("Questa webview non supporta Media Source Extensions");
    return { push() {}, destroy() {} };
  }

  const mediaSource = new MediaSourceImpl();
  video.disableRemotePlayback = true;
  objectUrl = URL.createObjectURL(mediaSource);
  video.src = objectUrl;
  const opened = new Promise<void>((resolve) => mediaSource.addEventListener("sourceopen", () => resolve(), { once: true }));

  const trimAndChase = () => {
    if (!sourceBuffer || sourceBuffer.updating || video.buffered.length === 0) return;
    const end = video.buffered.end(video.buffered.length - 1);
    if (end - video.currentTime > MAX_LATENCY_S) {
      video.currentTime = Math.max(0, end - 0.1);
    }
    const start = video.buffered.start(0);
    if (video.currentTime - start > KEEP_BACK_S * 2) {
      sourceBuffer.remove(start, video.currentTime - KEEP_BACK_S);
    }
  };

  const pump = () => {
    if (destroyed || !sourceBuffer || sourceBuffer.updating) return;
    const next = pending.shift();
    if (!next) {
      trimAndChase();
      return;
    }
    try {
      sourceBuffer.appendBuffer(next as BufferSource);
    } catch (err) {
      if (err instanceof DOMException && err.name === "QuotaExceededError" && video.buffered.length) {
        pending.unshift(next);
        sourceBuffer.remove(0, Math.max(0, video.currentTime - 1));
      } else {
        onError(`Errore decodifica video: ${String(err)}`);
      }
    }
  };

  const setup = async (codec: string) => {
    await opened;
    if (destroyed) return;
    const mime = `video/mp4; codecs="${codec}"`;
    if (!MediaSourceImpl.isTypeSupported(mime)) {
      onError(`La webview non decodifica ${codec} (serve decodifica HEVC hardware sul Mac)`);
      return;
    }
    sourceBuffer = mediaSource.addSourceBuffer(mime);
    sourceBuffer.addEventListener("updateend", pump);
    sourceBuffer.addEventListener("error", () => onError("Errore del buffer video"));
    video.play().catch(() => undefined);
    pump();
  };

  return {
    push(chunk: ArrayBuffer) {
      if (destroyed) return;
    const bytes = new Uint8Array(chunk);
      if (pending.reduce((size, chunk) => size + chunk.length, 0) + bytes.length > 16 * 1024 * 1024) {
        onError("Decodifica video in ritardo: riconnessione necessaria");
        return;
      }
      pending.push(bytes);
      if (sourceBuffer) {
        pump();
        return;
      }
      // Wait for the init segment (moov/hvcC) to learn the exact codec string.
      if (!initializing && header.length < 256 * 1024) {
        const merged = new Uint8Array(header.length + bytes.length);
        merged.set(header);
        merged.set(bytes, header.length);
        header = merged;
        const codec = findCodec(header);
        if (codec) {
          initializing = true;
          header = new Uint8Array(0);
          void setup(codec).catch((err) => { if (!destroyed) onError(String(err)); });
        }
      }
    },
    destroy() {
      destroyed = true;
      pending.length = 0;
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          // already closed
        }
      }
    },
  };
}
