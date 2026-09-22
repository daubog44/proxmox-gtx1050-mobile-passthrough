export function renderUpdateModal(): string {
  return `
    <div id="update-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in duration-200">
        
        <div class="flex items-center justify-between p-4 px-5 border-b border-zinc-800">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Aggiornamento Software</div>
            <h3 class="text-sm font-semibold text-zinc-100" id="update-modal-title">Verifica Versioni</h3>
          </div>
          <button type="button" class="btn-close-update-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" aria-label="Chiudi">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div class="p-5 space-y-3.5 text-xs">
          <div class="flex items-center justify-between">
            <span id="update-status-badge" class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Verifica in corso…</span>
            <span class="text-zinc-500 text-[11px]" id="update-date"></span>
          </div>

          <div class="grid grid-cols-2 gap-2.5 p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl text-center">
            <div>
              <div class="text-[10px] text-zinc-500 uppercase font-medium">Installata</div>
              <div class="text-xs font-bold text-zinc-300 font-mono mt-0.5" id="update-current-ver">-</div>
            </div>
            <div>
              <div class="text-[10px] text-emerald-400 uppercase font-semibold">Disponibile</div>
              <div class="text-xs font-bold text-emerald-400 font-mono mt-0.5" id="update-latest-ver">-</div>
            </div>
          </div>

          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Note di Rilascio</div>
            <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl max-h-36 overflow-y-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed" id="update-notes-text">Caricamento note…</div>
          </div>

          <div id="update-progress-container" class="hidden space-y-2">
            <p id="update-progress-status" class="text-zinc-400 text-xs text-center">Download e installazione in corso…</p>
            <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500 animate-pulse-slow"></div>
            </div>
          </div>
        </div>

        <div class="p-3.5 px-5 border-t border-zinc-800 flex justify-end gap-2 bg-zinc-950/40">
          <button type="button" class="btn-close-update-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Chiudi</button>
          <button type="button" class="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer" id="btn-apply-update" disabled>
            Scarica e Installa
          </button>
        </div>

      </div>
    </div>
  `;
}
