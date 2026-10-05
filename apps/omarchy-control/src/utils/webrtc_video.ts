/**
 * WebRTC (WHEP) receiver for the live view: H.265 straight from the host's
 * GPU encoder, UDP transport with jitter buffer and loss recovery. Signalling
 * goes through the broker (see api.whepOffer); media flows directly.
 */
export interface WebRtcSession {
  close(): void;
}

type Signal = (sdp: string) => Promise<{ sdp: string; resource: string }>;

const ICE_GATHER_TIMEOUT_MS = 1500;
const CONNECT_TIMEOUT_MS = 30000;

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, ICE_GATHER_TIMEOUT_MS);
  });
}

/**
 * Resolves once video is playing; rejects if H.265 WebRTC is unavailable or
 * the connection cannot be established, so the caller can fall back.
 */
export async function startWebRtcVideo(
  video: HTMLVideoElement,
  signal: Signal,
  onClose: (resource: string) => void,
  onDisconnect: (reason: string) => void,
  abort: AbortSignal,
): Promise<WebRtcSession> {
  const h265 = (RTCRtpReceiver.getCapabilities?.("video")?.codecs ?? []).filter((c) => c.mimeType.toLowerCase() === "video/h265");
  if (h265.length === 0) throw new Error("questa webview non decodifica H.265 via WebRTC");

  const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  let resource = "";
  let closed = false;
  let stream: MediaStream | null = null;
  let rejectPlaying: ((reason: Error) => void) | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(connectTimer);
    rejectPlaying?.(new Error("Visualizzazione chiusa"));
    pc.close();
    abort.removeEventListener("abort", close);
    if (stream && video.srcObject === stream) video.srcObject = null;
    if (resource) onClose(resource);
  };

  if (abort.aborted) throw new Error("Visualizzazione chiusa");
  abort.addEventListener("abort", close, {once: true});

  try {
    const transceiver = pc.addTransceiver("video", { direction: "recvonly" });
    // The host only publishes H.265: offer it first (RTX/FEC stay available).
    const others = (RTCRtpReceiver.getCapabilities("video")?.codecs ?? []).filter(
      (c) => /rtx|red|ulpfec|flexfec/i.test(c.mimeType),
    );
    transceiver.setCodecPreferences?.([...h265, ...others]);
    const receiver = transceiver.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null };
    if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;

    pc.ontrack = (ev) => {
      if (closed) return;
      stream = ev.streams[0] ?? new MediaStream([ev.track]);
      video.srcObject = stream;
      video.play().catch(() => undefined);
    };

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    if (closed) throw new Error("Visualizzazione chiusa");
    const answer = await signal(pc.localDescription!.sdp);
    resource = answer.resource;
    if (closed) { if (resource) onClose(resource); throw new Error("Visualizzazione chiusa"); }

    // Register before the answer: a fast peer can start playing immediately.
    const playing = new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(connectTimer); rejectPlaying = undefined; resolve(); };
      rejectPlaying = reject;
      connectTimer = setTimeout(() => reject(new Error("connessione WebRTC scaduta")), CONNECT_TIMEOUT_MS);
      video.addEventListener("playing", done, {once: true, signal: abort});
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") reject(new Error("connessione WebRTC fallita"));
      }, {signal: abort});
    });
    // A rejected setRemoteDescription must not leave an unobserved promise.
    await Promise.all([pc.setRemoteDescription({ type: "answer", sdp: answer.sdp }), playing]);
  } catch (err) {
    close();
    throw err;
  }

  pc.addEventListener("connectionstatechange", () => {
    if (!closed && (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected")) {
      onDisconnect(`WebRTC ${pc.connectionState}`);
    }
  });
  return { close };
}
