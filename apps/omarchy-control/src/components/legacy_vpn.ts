import type { VpnPeer } from "../types";

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

/**
 * Archiviazione codice WireGuard VPN Peer Management (Non mostrato nella UI principale per semplicità).
 * Preservato intatto per eventuale riattivazione futura.
 */
export function renderLegacyVpnSection(vpnPeers: VpnPeer[], wgEndpoint: string, wgSubnet: string): string {
  return `
    <div class="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold text-zinc-100">🛡️ WireGuard Mesh VPN (Legacy)</h3>
          <p class="text-xs text-zinc-400">Accesso peer-to-peer WireGuard</p>
        </div>
        <button type="button" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition" id="btn-open-vpn-modal">+ Aggiungi Peer</button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label class="block text-zinc-400 font-medium mb-1">Endpoint WireGuard Host</label>
          <input type="text" id="cfg-wg-endpoint" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono" value="${escapeHtml(wgEndpoint)}" />
        </div>
        <div>
          <label class="block text-zinc-400 font-medium mb-1">Subnet Sandbox Isolata</label>
          <input type="text" id="cfg-wg-subnet" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-400 font-mono cursor-not-allowed opacity-75" value="${escapeHtml(wgSubnet)}" disabled />
        </div>
      </div>

      <div class="overflow-x-auto rounded-xl border border-zinc-800">
        <table class="w-full text-left text-xs text-zinc-300">
          <thead class="bg-zinc-950/80 border-b border-zinc-800 text-[11px] font-semibold text-zinc-400 uppercase">
            <tr>
              <th class="px-4 py-2.5">Dispositivo</th>
              <th class="px-4 py-2.5">Utente</th>
              <th class="px-4 py-2.5">IP Tunnel</th>
              <th class="px-4 py-2.5">Data</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800/60">
            ${vpnPeers.map(p => `
              <tr class="hover:bg-zinc-800/40">
                <td class="px-4 py-2.5 font-semibold text-zinc-100">${escapeHtml(p.client_name)}</td>
                <td class="px-4 py-2.5">${escapeHtml(p.username)}</td>
                <td class="px-4 py-2.5 font-mono text-[11px] text-emerald-400">${escapeHtml(p.ip_address)}</td>
                <td class="px-4 py-2.5 text-zinc-400">${formatDate(p.created_at)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderAddVpnModal(users: { username: string; display_name: string }[]): string {
  return `
    <div id="add-vpn-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in duration-200">
        <div class="flex items-center justify-between p-4 px-5 border-b border-zinc-800">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Rete Remota</div>
            <h3 class="text-sm font-semibold text-zinc-100">Nuovo Profilo WireGuard</h3>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" aria-label="Chiudi">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <form id="form-add-vpn-peer" class="p-5 space-y-3 text-xs">
          <div>
            <label class="block text-[11px] font-medium text-zinc-400 mb-1" for="vpn-peer-username">Utente Omarchy</label>
            <select id="vpn-peer-username" class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-zinc-100 outline-none transition cursor-pointer">
              ${users.map(u => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.display_name)} (${escapeHtml(u.username)})</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-medium text-zinc-400 mb-1" for="vpn-peer-clientname">Nome Dispositivo</label>
            <input type="text" id="vpn-peer-clientname" placeholder="es. iPhone-Adrian" class="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-zinc-100 outline-none transition" required />
          </div>
          <div class="pt-2 flex items-center justify-end gap-2">
            <button type="button" class="btn-close-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Annulla</button>
            <button type="submit" class="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer">Genera Profilo</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderVpnConfigQrModal(clientName: string, ipAddress: string, configText: string, qrSvg: string): string {
  return `
    <div id="vpn-qr-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200">
        <div class="flex items-center justify-between p-4 px-5 border-b border-zinc-800">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Configurazione Peer</div>
            <h3 class="text-sm font-semibold text-zinc-100 truncate max-w-[240px]">${escapeHtml(clientName)}</h3>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" aria-label="Chiudi">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <div class="p-5 space-y-3.5 text-xs">
          <div class="flex items-center justify-center p-3 bg-white rounded-xl shadow-inner">
            <div class="w-40 h-40 flex items-center justify-center">${qrSvg}</div>
          </div>
          <textarea readonly class="w-full h-24 bg-zinc-950 border border-zinc-800 rounded-lg p-2 font-mono text-[10px] text-zinc-400 outline-none select-all" id="vpn-conf-textarea">${escapeHtml(configText)}</textarea>
          <div class="flex gap-2">
            <button type="button" class="btn-close-modal flex-1 h-8 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Chiudi</button>
            <button type="button" class="flex-1 h-8 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl shadow-sm transition cursor-pointer" id="btn-copy-vpn-conf">Copia Config</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
