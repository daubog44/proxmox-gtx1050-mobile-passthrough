/**
 * LEGACY GUEST SHELL (Archived)
 * 
 * Questo modulo conteneva l'interfaccia client desktop semplificata ("Console Sandbox")
 * per utenti guest all'interno dell'app Omarchy Control.
 * 
 * NOTA: Con l'adozione dell'architettura 1-Click Moonlight (Deep Link), i giocatori / utenti
 * esterni non hanno più bisogno di scaricare né accedere all'app desktop Omarchy Control:
 * giocano direttamente da Moonlight (iOS, Android, Windows, Mac, Steam Deck) tramite
 * il link moonlight:// inviato dall'amministratore.
 * 
 * Questo file è conservato per referenza storica e per riuso futuro se necessario.
 */

import type { AuthSession } from "../types";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[c] ?? c);
}

export function renderLegacyGuestShell(session: AuthSession): string {
  return `
    <div class="min-h-screen w-full bg-zinc-950 flex flex-col justify-between p-6">
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
            O
          </div>
          <div>
            <div class="font-bold text-sm text-zinc-100">Omarchy Gaming</div>
            <div class="text-[10px] text-zinc-400">Console Sandbox (Legacy)</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-1 rounded-lg bg-zinc-800 text-xs text-zinc-300">${escapeHtml(session.username)}</span>
          <button type="button" id="btn-lock-screen" class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition">🔒</button>
        </div>
      </header>

      <div class="max-w-md w-full mx-auto bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-2xl">
        <div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Sessione Gaming Wolf</div>
          <h2 class="text-xl font-bold text-zinc-100">Pronto per giocare?</h2>
          <p class="text-xs text-zinc-400 mt-1">Avvia Moonlight per connetterti allo stream HEVC a bassissima latenza</p>
        </div>

        <button type="button" id="btn-guest-play" class="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer">
          <span>🎮</span>
          <span>GIOCA ORA CON MOONLIGHT</span>
        </button>

        <div class="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
          <div class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/60">⚡ Sub-5ms Latenza</div>
          <div class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/60">🎮 1080p 60 FPS</div>
          <div class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/60">✨ H.265 HEVC</div>
          <div class="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/60">🚀 Pascal GP107</div>
        </div>
      </div>

      <footer class="text-center text-[11px] text-zinc-600">
        Omarchy Workstation Control Plane
      </footer>
    </div>
  `;
}
