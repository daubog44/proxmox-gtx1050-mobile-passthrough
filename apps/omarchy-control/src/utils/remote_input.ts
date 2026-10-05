import { api } from "../services/api";

const controlOwner = crypto.randomUUID();

/** Coordinates in the displayed image, excluding object-contain letterboxing. */
export function remotePosition(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, width: number, height: number, clientX: number, clientY: number, clamp = false): {x: number; y: number} | null {
  if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return null;
  const displayedWidth = Math.min(rect.width, rect.height * width / height);
  const displayedHeight = displayedWidth * height / width;
  const x = (clientX - rect.left - (rect.width - displayedWidth) / 2) / displayedWidth;
  const y = (clientY - rect.top - (rect.height - displayedHeight) / 2) / displayedHeight;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return {x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y))};
}

export function wireRemoteInput(modal: HTMLElement, sessionId: string, token: string, error: (message: string) => void): () => void {
  const viewport = modal.querySelector<HTMLElement>("[data-fullscreen-viewport]")!;
  const button = modal.querySelector<HTMLButtonElement>("#btn-monitor-takeover")!;
  const label = modal.querySelector<HTMLElement>("#live-monitor-mode")!;
  let lease = "";
  let closed = false;
  let sending = false;
  let queue: Record<string, unknown>[] = [];
  let lastHeartbeat = 0;
  let changing = false;
  const heldButtons = new Set<number>();
  const ready = () => { button.disabled = changing || modal.dataset.videoReady !== "true"; };
  button.disabled = true;
  const reset = () => {
    lease = "";
    queue = [];
    heldButtons.clear();
    modal.dataset.controlling = "false";
    button.textContent = "Prendi controllo";
    button.setAttribute("aria-pressed", "false");
    label.textContent = "Visione silenziosa";
  };
  const stop = () => {
    const old = lease;
    reset();
    if (old) void api.sessionControl(sessionId, { action: "stop", lease: old }, token).catch(() => undefined);
  };
  button.onclick = async () => {
    if (changing || closed || modal.dataset.videoReady !== "true") return;
    if (lease) { stop(); return; }
    changing = true;
    ready();
    try {
      const result = await api.sessionControl(sessionId, {action: "start", owner: controlOwner}, token);
      lease = result.lease ?? "";
      if (closed || modal.dataset.videoReady !== "true") { stop(); return; }
      if (!lease) throw new Error("Controllo non acquisito");
      modal.dataset.controlling = "true";
      button.textContent = "Rilascia controllo";
      button.setAttribute("aria-pressed", "true");
      label.textContent = "Mouse e tastiera · Ctrl+Alt+Shift+Esc per rilasciare";
      viewport.focus();
    } catch (err) { error(String(err)); }
    finally { changing = false; ready(); }
  };
  const enqueue = (event: Record<string, unknown>) => {
    if (!lease || closed) return;
    if (queue.length > 1024) { stop(); error("Input troppo lento: controllo rilasciato"); return; }
    if (event.kind === "move" && queue.at(-1)?.kind === "move") queue[queue.length - 1] = event;
    else queue.push(event);
  };
  const position = (e: MouseEvent, clamp = false) => {
    const media = viewport.querySelector<HTMLVideoElement>("video:not(.hidden)") ?? viewport.querySelector<HTMLImageElement>("img:not(.hidden)");
    if (!media) return false;
    const point = remotePosition(media.getBoundingClientRect(),
      media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth,
      media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight, e.clientX, e.clientY, clamp);
    if (point) enqueue({kind: "move", ...point});
    return !!point;
  };
  const pointer = (e: PointerEvent) => {
    if (!lease || modal.dataset.videoReady !== "true") return;
    e.preventDefault();
    const inside = position(e, heldButtons.size > 0);
    const code = e.button + 1;
    if (e.type === "pointerdown" && inside) {
      viewport.focus(); viewport.setPointerCapture(e.pointerId);
      heldButtons.add(code);
      enqueue({kind: "button", code, down: true});
    } else if (e.type === "pointerup" && heldButtons.delete(code)) {
      enqueue({kind: "button", code, down: false});
    }
  };
  const cancelPointer = () => {
    for (const code of heldButtons) enqueue({kind: "button", code, down: false});
    heldButtons.clear();
  };
  const wheel = (e: WheelEvent) => {
    if (!lease || !e.deltaY || !position(e)) return;
    e.preventDefault();
    enqueue({kind: "scroll", amount: -Math.sign(e.deltaY) * 120});
  };
  const keys: Record<string, number> = {ShiftLeft:160, ShiftRight:161, ControlLeft:162, ControlRight:163, AltLeft:164, AltRight:165, MetaLeft:91, MetaRight:92};
  const keyboard = (e: KeyboardEvent) => {
    if (!lease || closed || modal.dataset.videoReady !== "true" || (e.type === "keydown" && document.activeElement !== viewport)) return;
    if (e.code === "KeyV" && (e.ctrlKey || e.metaKey)) return; // native paste event supplies the local clipboard
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code === "Escape" && e.ctrlKey && e.altKey && e.shiftKey) { stop(); return; }
    if (!e.repeat) enqueue({kind:"key", code: keys[e.code] ?? e.keyCode, down:e.type === "keydown",
      modifiers:(e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)});
  };
  const paste = (e: ClipboardEvent) => {
    if (!lease || document.activeElement !== viewport) return;
    e.preventDefault();
    let text = "";
    const encoder = new TextEncoder();
    for (const char of e.clipboardData?.getData("text") ?? "") {
      if (encoder.encode(text + char).length > 32) { enqueue({kind:"text", text}); text = ""; }
      text += char;
    }
    if (text) enqueue({kind:"text", text});
  };
  const context = (e: MouseEvent) => { if (lease) e.preventDefault(); };
  const timer = window.setInterval(async () => {
    if (!lease || sending || (!queue.length && Date.now() - lastHeartbeat < 3000)) return;
    sending = true;
    const current = lease;
    const events = queue.splice(0, 64);
    try { await api.sessionControl(sessionId, {action:"input", lease:current, events}, token); lastHeartbeat = Date.now(); }
    catch (err) { if (lease === current) { stop(); error(String(err)); } }
    finally { sending = false; }
  }, 33);
  const mediaState = () => { if (modal.dataset.videoReady !== "true") stop(); ready(); };
  viewport.addEventListener("remote-media-state", mediaState);
  viewport.addEventListener("pointercancel", cancelPointer);
  viewport.addEventListener("lostpointercapture", cancelPointer);
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Schermo remoto: mouse e tastiera");
  viewport.addEventListener("pointermove", pointer);
  viewport.addEventListener("pointerdown", pointer);
  viewport.addEventListener("pointerup", pointer);
  viewport.addEventListener("wheel", wheel, {passive:false});
  viewport.addEventListener("contextmenu", context);
  viewport.addEventListener("paste", paste);
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("keyup", keyboard, true);
  window.addEventListener("blur", stop);
  return () => {
    closed = true; stop(); clearInterval(timer);
    button.onclick = null;
    viewport.removeEventListener("remote-media-state", mediaState);
    viewport.removeEventListener("pointercancel", cancelPointer);
    viewport.removeEventListener("lostpointercapture", cancelPointer);
    viewport.removeEventListener("pointermove", pointer);
    viewport.removeEventListener("pointerdown", pointer);
    viewport.removeEventListener("pointerup", pointer);
    viewport.removeEventListener("wheel", wheel);
    viewport.removeEventListener("contextmenu", context);
    viewport.removeEventListener("paste", paste);
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("keyup", keyboard, true);
    window.removeEventListener("blur", stop);
  };
}
