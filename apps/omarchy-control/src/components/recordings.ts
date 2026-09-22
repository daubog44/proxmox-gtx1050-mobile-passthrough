import type { RecordingItem } from "../services/api";
import type { UserRecord } from "../types";
import { Icons } from "./ui/icons";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[c] ?? c);
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function formatSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** URL served by the Tauri `omarchy-rec` protocol (Range-proxied to the broker). */
export function recordingUrl(id: string): string {
  return `omarchy-rec://localhost/${encodeURIComponent(id)}`;
}

export function renderRecordingsView(
  items: RecordingItem[] | null,
  users: UserRecord[],
  filterUser: string,
  error: string | null,
): string {
  const displayName = (username: string | null) =>
    users.find((u) => u.username === username)?.display_name ?? username ?? "sconosciuto";
  const owners = Array.from(new Set((items ?? []).map((i) => i.username).filter(Boolean))) as string[];

  const toolbar = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-zinc-100">Registrazioni</h2>
        <p class="text-xs text-zinc-400">Sessioni salvate su NAS o nello spool locale del server</p>
      </div>
      <div class="flex items-center gap-2">
        <select id="recordings-filter" class="h-8 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500 cursor-pointer" aria-label="Filtra per utente">
          <option value="">Tutti gli utenti</option>
          ${owners
            .map((u) => `<option value="${escapeHtml(u)}" ${u === filterUser ? "selected" : ""}>${escapeHtml(displayName(u))}</option>`)
            .join("")}
        </select>
        <button type="button" id="recordings-refresh" class="h-8 w-8 flex items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 cursor-pointer" title="Aggiorna" aria-label="Aggiorna registrazioni">
          ${Icons.refresh("w-3.5 h-3.5")}
        </button>
      </div>
    </div>`;

  if (error) {
    return `${toolbar}<div class="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">${escapeHtml(error)}</div>`;
  }
  if (items === null) {
    return `${toolbar}<div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-xs text-zinc-400">Caricamento registrazioni…</div>`;
  }
  const shown = filterUser ? items.filter((i) => i.username === filterUser) : items;
  if (shown.length === 0) {
    return `${toolbar}
      <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center flex flex-col items-center gap-2">
        ${Icons.film("w-7 h-7 text-zinc-500")}
        <p class="text-sm font-medium text-zinc-200">Nessuna registrazione</p>
        <p class="text-xs text-zinc-500 max-w-sm">Avvia una registrazione da una sessione live, oppure abilita la registrazione automatica per un utente.</p>
      </div>`;
  }

  return `${toolbar}
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));">
      ${shown
        .map((r) => {
          const meta = [
            r.width && r.height ? `${r.width}×${r.height}` : null,
            r.codec ? r.codec.toUpperCase() : null,
            formatSize(r.size_mb),
          ].filter(Boolean).join(" · ");
          return `
          <article class="group rounded-2xl border border-zinc-800 bg-zinc-900/70 overflow-hidden flex flex-col">
            <button type="button" class="btn-play-recording relative aspect-video bg-zinc-950 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed" data-id="${escapeHtml(r.id)}" ${r.in_progress ? "disabled" : ""} aria-label="Riproduci ${escapeHtml(r.file)}">
              <span class="w-11 h-11 rounded-full bg-white/10 group-hover:bg-emerald-500/80 flex items-center justify-center text-white transition">
                ${Icons.play("w-5 h-5")}
              </span>
              <span class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[11px] font-mono text-zinc-100">${r.in_progress ? "● REC" : formatDuration(r.duration_s)}</span>
            </button>
            <div class="p-3 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm font-medium text-zinc-100 truncate">${escapeHtml(displayName(r.username))}</div>
                <div class="text-[11px] text-zinc-400 truncate">${escapeHtml(r.date ?? "")} ${escapeHtml(r.time ?? "")} · ${r.storage === "nas" ? "NAS" : "locale"}</div>
                <div class="text-[11px] text-zinc-500 truncate font-mono">${escapeHtml(meta)}</div>
              </div>
              <button type="button" class="btn-delete-recording shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-950/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" data-id="${escapeHtml(r.id)}" data-file="${escapeHtml(r.file)}" ${r.in_progress ? "disabled" : ""} title="Elimina" aria-label="Elimina ${escapeHtml(r.file)}">
                ${Icons.trash("w-3.5 h-3.5")}
              </button>
            </div>
          </article>`;
        })
        .join("")}
    </div>`;
}

export function renderRecordingPlayerModal(item: RecordingItem, ownerName: string): string {
  return `
    <div id="recording-player-modal" class="modal-backdrop fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Registrazione di ${escapeHtml(ownerName)}">
      <div class="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-full flex flex-col overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
          <div class="min-w-0 text-xs">
            <span class="font-semibold text-zinc-100">${escapeHtml(ownerName)}</span>
            <span class="text-zinc-500"> · ${escapeHtml(item.date ?? "")} ${escapeHtml(item.time ?? "")} · ${formatDuration(item.duration_s)}</span>
          </div>
          <button type="button" id="close-recording-player" class="w-8 h-8 flex items-center justify-center text-lg leading-none text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800 cursor-pointer" aria-label="Chiudi">&times;</button>
        </div>
        <div class="bg-black flex items-center justify-center">
          <video id="recording-video" controls autoplay playsinline preload="metadata" class="block w-full max-h-[75vh] bg-black" src="${escapeHtml(recordingUrl(item.id))}"></video>
        </div>
        <div id="recording-player-error" class="hidden px-4 py-2 text-xs text-red-300 bg-red-950/40 border-t border-red-900/50"></div>
        <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-900/60 text-xs">
          <span class="text-zinc-500 font-mono truncate">${escapeHtml(item.file)} · ${formatSize(item.size_mb)}</span>
          <div class="flex items-center gap-2">
            <span id="recording-download-status" class="text-zinc-400 font-mono" aria-live="polite"></span>
            <div id="recording-download-bar" class="hidden w-28 h-1.5 rounded-full bg-zinc-800 overflow-hidden" role="progressbar" aria-label="Avanzamento download">
              <div id="recording-download-fill" class="h-full bg-emerald-500 transition-[width]" style="width:0%"></div>
            </div>
            <button type="button" id="btn-reveal-download" class="hidden h-8 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium cursor-pointer">Mostra nel Finder</button>
            <button type="button" id="btn-download-recording" class="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer">
              ${Icons.download("w-3.5 h-3.5")} <span>Scarica</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}
