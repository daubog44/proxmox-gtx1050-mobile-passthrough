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
  const nasPath = settings.savegames_nas_path || "smb://192.168.0.39/nvme1/omarchy-saves";
  const autoSync = settings.savegames_auto_sync === "true";
  const retentionDays = settings.retention_recordings_days || "30";
  const maxSnapshots = settings.retention_saves_max_snapshots || "5";

  const isAdmitted = admission ? admission.admitted : true;
  const activeStreams = admission ? admission.active_streams : overview.active_sessions_count;

  return `
    <div class="space-y-6">
      <!-- 4 Stat Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between text-zinc-400">
            <span class="text-xs font-semibold uppercase tracking-wider">Flussi NVENC</span>
            <div class="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              ${Icons.cpu("w-4 h-4")}
            </div>
          </div>
          <div class="flex items-baseline justify-between mt-3">
            <span class="text-2xl font-bold font-mono text-zinc-100">${activeStreams} / ${maxStreams}</span>
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold ${isAdmitted ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}">
              ${isAdmitted ? 'Disponibile' : 'Saturato'}
            </span>
          </div>
        </div>

        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between text-zinc-400">
            <span class="text-xs font-semibold uppercase tracking-wider">DuckDNS Globale</span>
            <div class="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              ${Icons.globe("w-4 h-4")}
            </div>
          </div>
          <div class="flex items-baseline justify-between mt-3">
            <span class="text-sm font-semibold font-mono text-amber-300 truncate max-w-[150px]" title="${escapeHtml(ddnsStatus?.domain || 'cloudgamingadrian.duckdns.org')}">
              ${escapeHtml((ddnsStatus?.domain || 'cloudgamingadrian').replace('.duckdns.org', ''))}
            </span>
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold ${ddnsStatus?.status === 'ok' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'}">
              ${ddnsStatus?.status === 'ok' ? 'Attivo' : 'Offline'}
            </span>
          </div>
        </div>

        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between text-zinc-400">
            <span class="text-xs font-semibold uppercase tracking-wider">Storage NAS Samba</span>
            <div class="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              ${Icons.hardDrive("w-4 h-4")}
            </div>
          </div>
          <div class="flex items-baseline justify-between mt-3">
            <span class="text-2xl font-bold font-mono text-zinc-100">${savegames.length}</span>
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold ${storage?.nas_mounted ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}">
              ${storage?.nas_mounted ? 'Montato' : 'Locale'}
            </span>
          </div>
        </div>

        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between text-zinc-400">
            <span class="text-xs font-semibold uppercase tracking-wider">Retention Video</span>
            <div class="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              ${Icons.sliders("w-4 h-4")}
            </div>
          </div>
          <div class="flex items-baseline justify-between mt-3">
            <span class="text-2xl font-bold font-mono text-zinc-100">${retentionDays} giorni</span>
            <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-300">
              Auto-Prune
            </span>
          </div>
        </div>
      </div>

      <!-- 2-Column Balanced Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- Column Left: Dynamic DNS -->
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 shadow-sm space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                ${Icons.globe("w-5 h-5")}
              </div>
              <div>
                <h3 class="text-sm font-semibold text-zinc-100">Accesso Globale DuckDNS</h3>
                <p class="text-xs text-zinc-400">Risolve l'IP pubblico per connettere Moonlight da remoto</p>
              </div>
            </div>
            <button type="button" class="h-8 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer shadow-sm" id="btn-sync-ddns-now">
              ${Icons.refresh("w-3.5 h-3.5")} Sincronizza
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div class="p-3 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
              <span class="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">Dominio</span>
              <div class="font-mono text-emerald-400 font-semibold text-xs mt-1 truncate" title="${escapeHtml(ddnsStatus?.domain || 'cloudgamingadrian.duckdns.org')}">
                ${escapeHtml(ddnsStatus?.domain || 'cloudgamingadrian.duckdns.org')}
              </div>
            </div>
            <div class="p-3 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
              <span class="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">IP Pubblico WAN</span>
              <div class="font-mono text-zinc-200 font-semibold text-xs mt-1" id="ddns-public-ip-label">
                ${escapeHtml(ddnsStatus?.ip || '101.58.7.26')}
              </div>
            </div>
            <div class="p-3 bg-zinc-950/70 border border-zinc-800/80 rounded-xl">
              <span class="text-zinc-400 text-[10px] uppercase font-bold tracking-wider">Aggiornamento</span>
              <div class="text-zinc-300 font-medium text-xs mt-1 flex items-center gap-1">
                ${Icons.zap("w-3.5 h-3.5 text-amber-400")} Automatico ogni 5m
              </div>
            </div>
          </div>

          <div class="p-4 bg-zinc-950/50 border border-zinc-800/70 rounded-xl space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label class="block text-zinc-400 font-medium mb-1">Sottodominio DuckDNS</label>
                <div class="flex items-center">
                  <input type="text" id="cfg-ddns-subdomain" class="w-full bg-zinc-900 border border-zinc-800 rounded-l-lg px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-amber-500" value="${escapeHtml((ddnsStatus?.domain || 'cloudgamingadrian').replace('.duckdns.org', ''))}" placeholder="cloudgamingadrian" />
                  <span class="bg-zinc-800 px-3 py-2 text-zinc-400 border border-l-0 border-zinc-800 rounded-r-lg font-mono text-[11px]">.duckdns.org</span>
                </div>
              </div>
              <div>
                <label class="block text-zinc-400 font-medium mb-1">Token DuckDNS</label>
                <div class="relative">
                  <input type="password" id="cfg-ddns-token" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-3 pr-8 py-2 text-zinc-100 font-mono outline-none focus:border-amber-500 text-xs" value="${escapeHtml(settings.ddns_token || '767c2b1f-452f-4b64-b6a6-5e100c940a84')}" placeholder="Token DuckDNS" />
                  <button type="button" id="btn-toggle-ddns-token" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer">
                    ${Icons.eye("w-3.5 h-3.5")}
                  </button>
                </div>
              </div>
            </div>
            <div class="flex items-center justify-between pt-1">
              <span class="text-[11px] text-zinc-400 font-mono">Salvato in /etc/omarchy/ddns.conf</span>
              <button type="button" id="btn-save-ddns-config" class="h-8 px-3.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer">
                ${Icons.check("w-3.5 h-3.5")} Salva Configurazione
              </button>
            </div>
          </div>
        </div>

        <!-- Column Right: Capacity NVENC -->
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 shadow-sm space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                ${Icons.cpu("w-5 h-5")}
              </div>
              <div>
                <h3 class="text-sm font-semibold text-zinc-100">Capacità Encoder NVENC</h3>
                <p class="text-xs text-zinc-400">Limite flussi contemporanei hardware e VRAM GPU</p>
              </div>
            </div>
            <button type="button" class="h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer" id="btn-save-settings-admission">Salva Limiti</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Max Flussi Concorrenti</label>
              <div class="flex items-center gap-2">
                <input type="number" id="cfg-admission-maxstreams" min="1" max="8" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500 font-mono" value="${escapeHtml(maxStreams)}" />
                <button type="button" class="h-8 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 font-medium shrink-0 transition cursor-pointer" id="btn-check-admission">Verifica</button>
              </div>
            </div>

            <div>
              <label class="block text-zinc-400 font-medium mb-1">Stato VRAM GPU</label>
              <div class="p-2 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between font-mono text-xs">
                <span class="text-zinc-400">Usata: <strong class="text-zinc-100 font-semibold">${overview.telemetry ? overview.telemetry.memory_used_mb : 0} MB</strong></span>
                <span class="text-zinc-400">Libera: <strong class="text-emerald-400 font-semibold">${overview.telemetry ? overview.telemetry.memory_free_mb : 4096} MB</strong></span>
              </div>
            </div>
          </div>

          <!-- Retention and Spool info -->
          <div class="p-4 bg-zinc-950/50 border border-zinc-800/70 rounded-xl text-xs space-y-2">
            <div class="flex justify-between items-center text-zinc-300">
              <span class="text-zinc-400">Retention Registrazioni Gameplay:</span>
              <span class="font-mono text-zinc-100 font-semibold">${retentionDays} giorni</span>
            </div>
            <div class="flex justify-between items-center text-zinc-300">
              <span class="text-zinc-400">Snapshot massimi per utente:</span>
              <span class="font-mono text-zinc-100 font-semibold">${maxSnapshots}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Section: Storage NAS & Savegames -->
      <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              ${Icons.hardDrive("w-5 h-5")}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">Salvataggi & Storage NAS</h3>
              <p class="text-xs text-zinc-400">Sincronizzazione salvataggi Steam tra host locale e share di rete Samba</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="h-8 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer shadow-sm" id="btn-open-nas-modal">
              ${Icons.folder("w-3.5 h-3.5 text-blue-400")} <span>Configura NAS</span>
            </button>
            <button type="button" class="h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer" id="btn-save-settings-savegames">Salva</button>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label class="block text-zinc-400 font-medium mb-1">Destinazione</label>
            <select id="cfg-savegames-type" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500">
              <option value="nas" ${storageType === 'nas' ? 'selected' : ''}>NAS Samba (Rete NVMe)</option>
              <option value="local" ${storageType === 'local' ? 'selected' : ''}>NVMe Locale Omarchy</option>
            </select>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1">Path Condivisione</label>
            <input type="text" id="cfg-savegames-path" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500 font-mono" value="${escapeHtml(nasPath)}" />
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1">Auto-Sync</label>
            <label class="flex items-center gap-2 p-2 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer">
              <input type="checkbox" id="cfg-savegames-autosync" ${autoSync ? 'checked' : ''} class="rounded border-zinc-700 text-emerald-500" />
              <span class="text-zinc-300 text-xs">Sincronizzazione automatica</span>
            </label>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1">Max Snapshot per Utente</label>
            <input type="number" id="cfg-savegames-maxsnaps" min="1" max="50" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500 font-mono" value="${escapeHtml(maxSnapshots)}" />
          </div>
        </div>

        <!-- Snapshots Table -->
        <div class="pt-3 border-t border-zinc-800/80 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Snapshot Salvataggi (${savegames.length})</span>
            <div class="flex items-center gap-2">
              <select id="sync-user-select" class="h-8 bg-zinc-950 border border-zinc-800 rounded-lg px-3 text-xs text-zinc-200 outline-none">
                ${users.map(u => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.display_name)} (${escapeHtml(u.username)})</option>`).join("")}
              </select>
              <button type="button" class="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm" id="btn-manual-sync-push">
                ${Icons.cloud("w-3.5 h-3.5")} <span>Push Backup</span>
              </button>
              <button type="button" class="h-8 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-sm" id="btn-manual-sync-pull">
                ${Icons.refresh("w-3.5 h-3.5")} <span>Ripristina Pull</span>
              </button>
            </div>
          </div>

          ${savegames.length === 0 ? `
            <div class="p-6 text-center text-xs text-zinc-400 bg-zinc-950/40 rounded-xl border border-zinc-800/60">
              Nessuno snapshot memorizzato su NAS.
            </div>
          ` : `
            <div class="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950/40">
              <table class="w-full text-left text-xs text-zinc-300 border-collapse table-fixed">
                <thead class="bg-zinc-950/80 border-b border-zinc-800 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th class="px-5 py-3 w-[45%]">Snapshot</th>
                    <th class="px-5 py-3 w-[25%]">Utente</th>
                    <th class="px-5 py-3 w-[30%]">Data Creazione</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-800/60">
                  ${savegames.slice(0, 5).map(s => `
                    <tr class="hover:bg-zinc-800/30 transition-colors">
                      <td class="px-5 py-3 font-mono text-zinc-100 truncate">${escapeHtml(s.snapshot_name)}</td>
                      <td class="px-5 py-3 font-medium truncate">${escapeHtml(s.username)}</td>
                      <td class="px-5 py-3 text-zinc-400 font-mono">${formatDate(s.created_at)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

export function renderNasMountModal(storage?: StorageTelemetry): string {
  const currentServer = "192.168.0.39";
  const currentShare = "nvme1";
  const currentMount = storage?.nas_path || "/mnt/nvme1-recordings";

  return `
    <div id="nas-mount-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              ${Icons.folder("w-4 h-4")}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">Storage NAS Samba</h3>
            </div>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="btn-close-nas-modal">&times;</button>
        </div>

        <!-- Form -->
        <form id="form-nas-mount" class="p-5 space-y-3.5 text-xs">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Server / IP NAS</label>
              <input type="text" id="nas-input-server" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500" value="${currentServer}" placeholder="192.168.0.39" required />
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Condivisione (Share)</label>
              <input type="text" id="nas-input-share" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500" value="${currentShare}" placeholder="nvme1" required />
            </div>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1">Punto di Mount Locale</label>
            <input type="text" id="nas-input-mountpoint" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-blue-500 font-mono" value="${currentMount}" placeholder="/mnt/nvme1-recordings" />
          </div>

          <!-- Credenziali -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2.5">
            <div class="text-[11px] font-semibold text-zinc-300">Credenziali Autenticazione (Opzionali per Guest)</div>
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
              ${Icons.zap("w-3.5 h-3.5 text-amber-400")} <span>Test Connessione</span>
            </button>
            <div class="flex items-center gap-2">
              <button type="button" id="btn-cancel-nas" class="btn-close-modal h-8 px-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Annulla</button>
              <button type="submit" id="btn-save-mount-nas" class="h-8 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer">
                ${Icons.check("w-3.5 h-3.5")} <span>Salva Mount</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}
