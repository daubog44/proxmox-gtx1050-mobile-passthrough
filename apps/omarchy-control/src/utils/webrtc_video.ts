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
): Promise<WebRtcSession> {
  const h265 = (RTCRtpReceiver.getCapabilities?.("video")?.codecs ?? []).filter((c) => c.mimeType.toLowerCase() === "video/h265");
  if (h265.length === 0) throw new Error("questa webview non decodifica H.265 via WebRTC");

  const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  let resource = "";
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    pc.close();
    video.srcObject = null;
    if (resource) onClose(resource);
  };

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
      video.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
      video.play().catch(() => undefined);
    };

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    const answer = await signal(pc.localDescription!.sdp);
    resource = answer.resource;
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connessione WebRTC scaduta (porta 8189 bloccata?)")), CONNECT_TIMEOUT_MS);
      video.addEventListener("playing", () => { clearTimeout(timer); resolve(); }, { once: true });
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed") {
          clearTimeout(timer);
          reject(new Error("connessione WebRTC fallita (porta 8189 UDP/TCP raggiungibile?)"));
        }
      });
    });
  } catch (err) {
    close();
    throw err;
  }

  pc.addEventListener("connectionstatechange", () => {
    if (!closed && (pc.connectionState === "failed" || pc.connectionState === "closed")) {
      onDisconnect(`WebRTC ${pc.connectionState}`);
    }
  });
  return { close };
}
