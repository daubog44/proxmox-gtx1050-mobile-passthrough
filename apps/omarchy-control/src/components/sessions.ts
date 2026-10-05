import type { ActiveSession } from "../types";
import { Icons } from "./ui/icons";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[c] ?? c);
}

function formatDuration(startedAt: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - startedAt));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function renderSessionsList(sessions: ActiveSession[]): string {
  if (sessions.length === 0) {
    return `
      <div class="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-12 text-center flex flex-col items-center justify-center shadow-sm">
        <div class="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center text-zinc-400 mb-3.5">
          ${Icons.monitor("w-6 h-6 text-zinc-400")}
        </div>
        <h3 class="text-sm font-semibold text-zinc-100">Nessuna sessione streaming attiva</h3>
        <p class="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
          I client che avviano lo streaming tramite Moonlight compariranno qui con telemetria dei frame e controlli host in tempo reale.
        </p>
      </div>
    `;
  }

  const btnBase =
    "btn-action h-8 rounded-lg border text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap disabled:opacity-60 disabled:cursor-wait";

  return `
    <div class="flex flex-col gap-2.5">
      ${sessions
        .map((s) => {
          const isShadowed = s.state === "shadowed";
          const isSpectating = s.state === "spectating";

          let statusBadge = "";
          if (isShadowed) {
            statusBadge = `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 whitespace-nowrap">
                <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span> Controllo Attivo
              </span>`;
          } else if (isSpectating) {
            statusBadge = `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 whitespace-nowrap">
                <span class="w-1.5 h-1.5 rounded-full bg-sky-400"></span> Spettatore
              </span>`;
          } else {
            statusBadge = `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> In Streaming
              </span>`;
          }
          // Sunshine = the owner's own desktop; Wolf = isolated guest sandbox.
          const kindBadge = s.session_id.startsWith("wolf-")
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/30 whitespace-nowrap">Sandbox ospite</span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700 whitespace-nowrap">Desktop admin</span>`;
          const recBadge = s.is_recording
            ? `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[11px] font-semibold whitespace-nowrap">
                <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> REC NAS
              </span>`
            : "";

          const recButton = s.is_recording
            ? `<button type="button" class="${btnBase} btn-rec-stop w-8 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40"
                data-action="stop-rec" data-id="${escapeHtml(s.session_id)}"
                title="Ferma registrazione su NAS" aria-label="Ferma registrazione su NAS">
                ${Icons.square("w-3.5 h-3.5")}
              </button>`
            : `<button type="button" class="${btnBase} btn-rec-start w-8 bg-zinc-800 hover:bg-zinc-700 text-rose-400 border-zinc-700/60"
                data-action="start-rec" data-id="${escapeHtml(s.session_id)}"
                title="Avvia registrazione su NAS" aria-label="Avvia registrazione su NAS">
                ${Icons.circleDot("w-3.5 h-3.5")}
              </button>`;

          return `
          <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-3" data-session-id="${escapeHtml(s.session_id)}">
            <!-- Utente & App -->
            <div class="flex items-center gap-3 min-w-0 flex-1 basis-48">
              <div class="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center font-bold text-zinc-200 text-xs shrink-0">
                ${escapeHtml(s.username.substring(0, 2).toUpperCase())}
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span class="font-semibold text-zinc-100 text-sm truncate max-w-full">${escapeHtml(s.username)}</span>
                  ${kindBadge}
                  ${statusBadge}
                  ${recBadge}
                </div>
                <div class="text-[11px] text-zinc-400 truncate mt-0.5">
                  <span class="text-emerald-400 font-medium">${escapeHtml(s.app_name)}</span>
                  <span class="text-zinc-600">·</span>
                  <span class="font-mono">${escapeHtml(s.client_ip)}</span>
                </div>
              </div>
            </div>

            <!-- Metriche -->
            <div class="flex items-center gap-4 text-[11px] font-mono text-zinc-400 shrink-0">
              <div title="Risoluzione e FPS"><span class="text-zinc-200">${escapeHtml(s.resolution)}</span> @${s.fps}</div>
              <div title="Bitrate stimato">${Math.round(s.bitrate_kbps / 1000)} Mbps</div>
              <div title="Durata sessione">${formatDuration(s.started_at)}</div>
            </div>

            <!-- Azioni Host -->
            <div class="flex items-center gap-1.5 shrink-0 ml-auto">
              <button
                type="button"
                class="${btnBase} btn-spectate px-2.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border-sky-500/30"
                data-action="spectate"
                data-id="${escapeHtml(s.session_id)}"
                data-user="${escapeHtml(s.username)}"
                data-app="${escapeHtml(s.app_name)}"
                data-res="${escapeHtml(s.resolution)}"
                data-fps="${s.fps}"
                data-bitrate="${Math.round(s.bitrate_kbps / 1000)}"
                data-vram="${s.vram_mb}"
                data-rec="${s.is_recording ? "1" : "0"}"
                title="Anteprima silenziosa dello schermo (nessuna notifica all'utente)"
              >
                ${Icons.eye("w-3.5 h-3.5")}
                <span>Visualizza</span>
              </button>
              <button
                type="button"
                class="${btnBase} btn-takeover px-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                data-action="takeover"
                data-id="${escapeHtml(s.session_id)}"
                title="Affianca attivamente con mouse e tastiera aprendo Moonlight"
              >
                ${Icons.gamepad("w-3.5 h-3.5")}
                <span>Moonlight</span>
              </button>
              ${recButton}
              <button
                type="button"
                class="${btnBase} btn-kick w-8 bg-zinc-800/80 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/40 border-zinc-700/60 text-zinc-400"
                data-action="kick"
                data-id="${escapeHtml(s.session_id)}"
                data-user="${escapeHtml(s.username)}"
                title="Disconnetti questa sessione"
                aria-label="Disconnetti questa sessione"
              >
                ${Icons.power("w-3.5 h-3.5")}
              </button>
            </div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

/**
 * Renders the Live Screen Monitor Modal (passive silent spectator).
 * Plays the host's low-latency 30 FPS video; JPEG snapshots fill the screen
 * while the encoder starts and take over if the video feed is unavailable.
 */
type PipelineBadge = { label: string; ok: boolean; title: string };

/** Fallback badges (transport / capture / codec); empty when all is nominal. */
export function renderPipelineBadges(badges: PipelineBadge[]): string {
  return badges
    .map(
      (b) => `<span title="${escapeHtml(b.title)}" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
        b.ok
          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
          : "bg-amber-500/15 text-amber-300 border-amber-500/40"
      }">${b.ok ? "" : "⚠ "}${escapeHtml(b.label)}</span>`,
    )
    .join("");
}

export function renderLiveMonitorModal(session: {
  sessionId: string;
  username: string;
  appName: string;
  resolution: string;
  fps: number;
  bitrateMbps: number;
  vramMb: number;
  isRecording: boolean;
}): string {
  return `
    <div id="live-monitor-modal" class="modal-backdrop fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Anteprima sessione ${escapeHtml(session.username)}">
      <div data-fullscreen-panel class="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] max-h-full flex flex-col overflow-hidden">

        <!-- Header -->
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60 shrink-0">
          <div class="flex items-center gap-2.5 min-w-0 text-xs">
            <span id="live-monitor-dot" class="w-2 h-2 rounded-full bg-zinc-500 shrink-0"></span>
            <span class="font-semibold text-zinc-100 truncate">${escapeHtml(session.username)}</span>
            <span class="text-zinc-500 truncate">${escapeHtml(session.appName)} · ${escapeHtml(session.resolution)}</span>
            <span id="monitor-rec-badge" class="${session.isRecording ? "inline-flex" : "hidden"} items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[11px] font-semibold shrink-0">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> REC NAS
            </span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <select id="live-quality" class="bg-zinc-900 border border-zinc-700 rounded-lg text-xs p-1.5" aria-label="Qualità della visualizzazione" title="La modalità leggera usa NVENC per ridurre il traffico del video live">
              <option value="original">Originale</option><option value="low">Leggera · 4 Mbps / 30 FPS</option>
            </select>
            <button type="button" data-media-fullscreen aria-pressed="false" class="btn-ghost text-xs" title="Schermo intero (Esc per uscire)">Schermo intero</button>
            <button type="button" class="w-8 h-8 flex items-center justify-center text-lg leading-none text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="close-live-monitor" title="Chiudi" aria-label="Chiudi">&times;</button>
          </div>
        </div>

        <!-- Screen -->
        <div data-fullscreen-viewport class="relative bg-black flex items-center justify-center min-h-[240px] flex-1 overflow-hidden">
          <video
            id="live-monitor-video"
            muted
            autoplay
            playsinline
            disablepictureinpicture
            class="absolute inset-0 block w-full h-full object-contain select-none hidden"
          ></video>
          <img
            id="live-monitor-screen"
            alt="Anteprima dello schermo della sessione"
            class="absolute inset-0 block w-full h-full object-contain select-none hidden"
            draggable="false"
          />
          <div id="live-monitor-spinner" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div class="w-7 h-7 border-2 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-xs text-zinc-400">Cattura schermo in corso…</span>
          </div>
          <div id="live-monitor-error" class="absolute inset-0 hidden flex-col items-center justify-center gap-2 text-center px-6">
            <span class="text-sm font-semibold text-zinc-200">Anteprima non disponibile</span>
            <span id="live-monitor-error-text" class="text-xs text-zinc-400 max-w-md break-words"></span>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="px-4 py-3 bg-zinc-900/60 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div class="flex items-center gap-2 text-zinc-400 min-w-0">
            ${Icons.eye("w-3.5 h-3.5 text-sky-400 shrink-0")}
            <span class="truncate"><span id="live-monitor-mode">Visione silenziosa</span> · <span id="live-monitor-age">avvio video…</span></span>
          </div>
          <div id="live-monitor-pipeline" class="flex flex-wrap items-center gap-1.5" aria-live="polite"></div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              id="btn-monitor-toggle-rec"
              class="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60 ${
                session.isRecording
                  ? "bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-700/50"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60"
              }"
              data-id="${escapeHtml(session.sessionId)}"
            >
              ${Icons.circleDot("w-3.5 h-3.5 text-rose-400")}
              <span id="btn-monitor-rec-text">${session.isRecording ? "Ferma Rec" : "Registra"}</span>
            </button>
            <button
              type="button"
              id="btn-monitor-takeover"
              class="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
              data-id="${escapeHtml(session.sessionId)}"
              title="Mouse e tastiera direttamente in questa visualizzazione"
            >
              ${Icons.gamepad("w-3.5 h-3.5")}
              <span>Prendi controllo</span>
            </button>
            <button type="button" class="btn-ghost" id="btn-monitor-moonlight">Controllo con Moonlight</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
