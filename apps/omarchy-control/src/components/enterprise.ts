import type { MultiUserOverview, SavegameManifest, UserRecord, StorageTelemetry, DdnsStatus } from "../types";
import { Icons } from "./ui/icons";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[c] ?? c);
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "--";
  const d = new Date(timestamp * 1000);
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const INPUT = "w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500";

export function renderEnterpriseDashboard(
  overview: MultiUserOverview,
  settings: Record<string, string>,
  _vpnPeers: unknown[],
  savegames: SavegameManifest[],
  users: UserRecord[],
  ddnsStatus?: DdnsStatus | null,
): string {
  const admission = overview.admission;
  const storage = overview.storage;
  const maxStreams = settings.max_concurrent_streams || "2";
  const storageType = settings.savegames_storage_type || "nas";
  const nasPath = settings.savegames_nas_path || "";
  const autoSync = settings.savegames_auto_sync !== "false";
  const retentionDays = settings.retention_recordings_days ?? "0";
  const maxSnapshots = settings.retention_saves_max_snapshots ?? "0";
  const activeStreams = admission ? admission.active_streams : overview.active_sessions_count;
  const vramFree = overview.telemetry ? `${overview.telemetry.memory_free_mb} MB` : "—";
  const domain = ddnsStatus?.domain || "";
  const ddnsOk = ddnsStatus?.status === "ok";

  return `
    <div class="page-head"><h2>Infrastruttura</h2></div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

      <div class="card space-y-3">
        <div class="flex items-center justify-between">
          <div class="card-title !mb-0">Accesso remoto · DuckDNS</div>
          <button type="button" class="btn-ghost" id="btn-sync-ddns-now">Sincronizza</button>
        </div>
        <div>
          <div class="kv"><span>Dominio</span><span>${escapeHtml(domain || "non configurato")}</span></div>
          <div class="kv"><span>IP pubblico</span><span id="ddns-public-ip-label">${escapeHtml(ddnsStatus?.ip || "—")}</span></div>
          <div class="kv"><span>Stato</span><span class="${ddnsOk ? "!text-emerald-400" : "!text-zinc-500"}">${ddnsOk ? "attivo" : "inattivo"}</span></div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="flex">
            <input type="text" id="cfg-ddns-subdomain" class="${INPUT} rounded-r-none font-mono" value="${escapeHtml(domain.replace(".duckdns.org", ""))}" placeholder="sottodominio" aria-label="Sottodominio DuckDNS" />
            <span class="px-2 py-2 bg-zinc-900 border border-l-0 border-zinc-800 rounded-r-lg text-zinc-500 font-mono text-[11px]">.duckdns.org</span>
          </div>
          <div class="relative">
            <input type="password" id="cfg-ddns-token" class="${INPUT} pr-8 font-mono" value="" placeholder="Token (vuoto = invariato)" autocomplete="off" aria-label="Token DuckDNS" />
            <button type="button" id="btn-toggle-ddns-token" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer" aria-label="Mostra token">${Icons.eye("w-3.5 h-3.5")}</button>
          </div>
        </div>
        <div class="flex justify-end"><button type="button" id="btn-save-ddns-config" class="btn-primary">Salva</button></div>
      </div>

      <div class="card space-y-3">
        <div class="card-title !mb-0">Streaming</div>
        <div>
          <div class="kv"><span>Flussi attivi</span><span>${activeStreams} / ${escapeHtml(maxStreams)}</span></div>
          <div class="kv"><span>VRAM libera</span><span>${vramFree}</span></div>
          <div class="kv"><span>Registrazioni conservate</span><span>${retentionDays === "0" ? "senza scadenza" : `${escapeHtml(retentionDays)} giorni`}</span></div>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <label for="cfg-admission-maxstreams" class="text-zinc-400 shrink-0">Flussi max</label>
          <input type="number" id="cfg-admission-maxstreams" min="1" max="8" class="${INPUT} w-20 font-mono" value="${escapeHtml(maxStreams)}" />
          <button type="button" class="btn-ghost" id="btn-check-admission">Verifica</button>
          <button type="button" class="btn-primary ml-auto" id="btn-save-settings-admission">Salva</button>
        </div>
        <label class="flex items-center gap-2 text-xs"><span>Dimensione desktop (%)</span><input type="number" id="cfg-desktop-scale" min="100" max="150" step="5" required class="${INPUT} w-20 font-mono" value="${escapeHtml(String(Number(settings.desktop_scale ?? "1") * 100))}" /></label>
        <p class="text-[11px] text-zinc-500">100% usa la risoluzione richiesta da Moonlight. Valori maggiori ingrandiscono tutto, riducendo la risoluzione interna del desktop. Si applica alle nuove sessioni Desktop.</p>
      </div>

      <div class="card space-y-3 lg:col-span-2">
        <div class="flex items-center justify-between">
          <div class="card-title !mb-0">Backup e registrazioni</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" id="btn-open-nas-modal">NAS ${storage?.nas_mounted ? "· montato" : ""}</button>
            <button type="button" class="btn-primary" id="btn-save-settings-savegames">Salva</button>
          </div>
        </div>
        <div class="kv"><span>NAS: spazio libero / capacità</span><span>${storage?.nas_free_gb?.toFixed(2) ?? "—"} / ${storage?.nas_total_gb?.toFixed(2) ?? "—"} GB</span></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <select id="cfg-savegames-type" class="${INPUT}" aria-label="Destinazione">
            <option value="nas" ${storageType === "nas" ? "selected" : ""}>NAS</option>
            <option value="local" ${storageType === "local" ? "selected" : ""}>Disco locale</option>
          </select>
          <label class="space-y-1"><span>Copie di backup per utente</span><input type="number" id="cfg-savegames-maxsnaps" min="0" step="1" required class="${INPUT} font-mono" value="${escapeHtml(maxSnapshots)}" aria-label="Copie di backup per utente" /></label>
          <label class="space-y-1"><span>Conservazione registrazioni (giorni)</span><input type="number" id="cfg-recordings-days" min="0" step="1" required class="${INPUT} font-mono" value="${escapeHtml(retentionDays)}" aria-label="Conservazione registrazioni (giorni)" /></label>
          <label class="space-y-1"><span>Cartella backup sul NAS</span><input type="text" id="cfg-savegames-path" required class="${INPUT} font-mono" value="${escapeHtml(nasPath)}" placeholder="saves oppure smb://nas/share/saves" aria-label="Cartella backup sul NAS" /></label>
          <label class="space-y-1"><span>Cartella registrazioni sul NAS</span><input type="text" id="cfg-recordings-path" required class="${INPUT} font-mono" value="${escapeHtml(settings.recordings_nas_path ?? "")}" aria-label="Cartella registrazioni sul NAS" /></label>
          <label class="space-y-1"><span>Backup locali</span><input type="text" id="cfg-local-saves-path" required class="${INPUT} font-mono" value="${escapeHtml(settings.local_saves_path ?? "")}" aria-label="Cartella backup locali" /></label>
          <label class="space-y-1"><span>Registrazioni locali</span><input type="text" id="cfg-local-recordings-path" required class="${INPUT} font-mono" value="${escapeHtml(settings.local_recordings_path ?? "")}" aria-label="Cartella registrazioni locali" /></label>
        </div>
        <p class="text-[11px] text-zinc-500">0 = tutte le copie / nessuna scadenza. Nessun tetto in GB per gli archivi; la capacità è quella reale del disco. Pulizia automatica quotidiana; le nuove impostazioni valgono dalle prossime operazioni di backup e pulizia.</p>
        <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input type="checkbox" id="cfg-savegames-autosync" ${autoSync ? "checked" : ""} class="rounded border-zinc-700 text-emerald-500" />
          Backup automatico a fine sessione
        </label>
        <p class="text-[11px] text-zinc-500">Parte entro 30 secondi dalla disconnessione, anche con il control plane chiuso. La terminazione amministrativa lo avvia subito; non c’è un backup periodico durante la sessione.</p>
        <div class="flex items-center gap-2 pt-3 border-t border-zinc-800/80 text-xs">
          <select id="sync-user-select" class="${INPUT} max-w-xs" aria-label="Utente">
            ${users.map((u) => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.display_name || u.username)}</option>`).join("")}
          </select>
          <button type="button" class="btn-ghost" id="btn-manual-sync-push">Backup</button>
          <button type="button" class="btn-ghost" id="btn-manual-sync-pull">Ripristina</button>
        </div>
        ${savegames.length === 0 ? `<p class="text-xs text-zinc-500">Nessuno snapshot.</p>` : `
          <div>
            ${savegames.map((s) => `
              <div class="kv"><span class="truncate">${escapeHtml(s.snapshot_name)} · ${escapeHtml(s.username)}</span><span>${formatDate(s.created_at)}</span><button type="button" class="btn-user-storage btn-ghost" data-username="${escapeHtml(s.username)}">Gestisci copie</button></div>
            `).join("")}
          </div>`}
      </div>
    </div>
  `;
}

export function renderNasMountModal(storage?: StorageTelemetry): string {
  // nas_path is the share URL (smb://server/share/...), not the local mount point.
  const [, currentServer = "", currentShare = ""] = (storage?.nas_path || "").match(/^smb:\/\/([^/]+)\/([^/]+)/) || [];
  const currentMount = storage?.nas_mountpoint || "";
  const mounted = Boolean(storage?.nas_mounted);

  return `
    <div id="nas-mount-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 pt-4 pb-1">
          <div class="flex items-center gap-2.5">
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">NAS</h3>
              <p id="nas-modal-status" class="text-[11px] ${mounted ? "text-emerald-400" : "text-zinc-500"}">${mounted ? `montato · //${escapeHtml(currentServer)}/${escapeHtml(currentShare)}` : "non montato"}</p>
            </div>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="btn-close-nas-modal">&times;</button>
        </div>

        <!-- Form -->
        <form id="form-nas-mount" class="p-5 space-y-3.5 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Server</label>
              <input type="text" id="nas-input-server" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500" value="${escapeHtml(currentServer)}" placeholder="Indirizzo NAS" required />
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Share</label>
              <input type="text" id="nas-input-share" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500" value="${escapeHtml(currentShare)}" placeholder="Condivisione" required />
            </div>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1">Punto di mount</label>
            <input type="text" id="nas-input-mountpoint" required class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500 font-mono" value="${escapeHtml(currentMount)}" placeholder="/mnt/nas" />
          </div>

          <!-- Credenziali -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2.5">
            <div id="nas-modal-cred-hint" class="text-[11px] text-zinc-400">${mounted ? "Credenziali salvate: lascia vuoto per non cambiarle" : "Credenziali (vuote = accesso guest)"}</div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-zinc-400 font-medium mb-1">Utente</label>
                <input type="text" id="nas-input-user" class="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500" placeholder="utente" />
              </div>
              <div>
                <label class="block text-zinc-400 font-medium mb-1">Password</label>
                <div class="relative">
                  <input type="password" id="nas-input-pass" class="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-3 pr-8 py-2 text-zinc-100 outline-none focus:border-blue-500" placeholder="••••••••" />
                  <button type="button" id="btn-toggle-nas-pass" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs">
                    ${Icons.eye("w-3.5 h-3.5")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div id="nas-test-feedback" class="hidden p-2.5 rounded-xl border text-xs font-medium"></div>

          <!-- Footer Buttons -->
          <div class="flex items-center justify-between pt-2 border-t border-zinc-800 gap-2">
            <button type="button" id="btn-test-nas" class="h-8 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer">
              ${Icons.zap("w-3.5 h-3.5 text-amber-400")} <span>Prova</span>
            </button>
            <div class="flex items-center gap-2">
              <button type="button" id="btn-cancel-nas" class="btn-close-modal h-8 px-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Annulla</button>
              <button type="submit" id="btn-save-mount-nas" class="h-8 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer">
                ${Icons.check("w-3.5 h-3.5")} <span>Salva</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

/** The NAS modal is created once; refresh its live fields when it opens. */
export function refreshNasMountModal(storage?: StorageTelemetry): void {
  const [, server = "", share = ""] = (storage?.nas_path || "").match(/^smb:\/\/([^/]+)\/([^/]+)/) || [];
  const mounted = Boolean(storage?.nas_mounted);
  const serverInput = document.querySelector<HTMLInputElement>("#nas-input-server");
  const shareInput = document.querySelector<HTMLInputElement>("#nas-input-share");
  const mountInput = document.querySelector<HTMLInputElement>("#nas-input-mountpoint");
  if (serverInput && server) serverInput.value = server;
  if (shareInput && share) shareInput.value = share;
  if (mountInput) mountInput.value = storage?.nas_mountpoint ?? "";
  const status = document.querySelector<HTMLElement>("#nas-modal-status");
  if (status) {
    status.textContent = mounted ? `montato · //${server}/${share}` : "non montato";
    status.className = `text-[11px] ${mounted ? "text-emerald-400" : "text-zinc-500"}`;
  }
  const hint = document.querySelector<HTMLElement>("#nas-modal-cred-hint");
  if (hint) hint.textContent = mounted ? "Credenziali salvate: lascia vuoto per non cambiarle" : "Credenziali (vuote = accesso guest)";
}
