import type { NodeEntry } from "../types";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[character] ?? character);
}

export function renderSshNodeModal(
  nodes: NodeEntry[],
  activeNode: NodeEntry | null,
  isAdmin = false,
): string {
  const node = activeNode || nodes.find((n) => n.is_active) || nodes[0] || {
    id: "omarchy-local",
    name: "Omarchy Primario",
    host: "omarchy.local",
    user: "daubog44",
    is_active: true,
    connection_state: "auth_required",
    allowed_users: ["admin", "owner"],
    api_port: 47995,
    api_token: null,
  };

  const currentPort = node.api_port || 47995;
  const currentToken = node.api_token || "";

  const nodesListHtml = nodes.map((n) => {
    const isActive = n.id === node.id || n.is_active;
    const dotColor = n.is_active
      ? n.connection_state === "connected"
        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
        : n.connection_state === "auth_required"
          ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
          : "bg-emerald-500"
      : "bg-zinc-600";

    const statusBadge = isActive
      ? `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Attivo</span>`
      : `<button type="button" class="btn-select-node-card text-xs font-medium px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition" data-id="${escapeHtml(n.id)}" data-host="${escapeHtml(n.host)}" data-user="${escapeHtml(n.user)}" data-port="${n.api_port || 47995}" data-token="${escapeHtml(n.api_token || "")}">Seleziona</button>`;

    return `
      <div class="flex items-center justify-between p-3 rounded-xl border transition ${isActive ? "bg-zinc-800/80 border-emerald-500/40 shadow-sm" : "bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700"}">
        <div class="flex items-center gap-3">
          <span class="w-2.5 h-2.5 rounded-full ${dotColor}"></span>
          <div>
            <div class="text-sm font-medium text-zinc-200">${escapeHtml(n.name)}</div>
            <div class="text-xs text-zinc-400 font-mono flex items-center gap-2">
              <span>http://${escapeHtml(n.host)}:${n.api_port || 47995}</span>
              <span class="text-zinc-600">•</span>
              <span class="text-zinc-500">${escapeHtml(n.user)}@${escapeHtml(n.host)}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${statusBadge}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div id="ssh-node-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        
        <!-- Header -->
        <div class="flex items-center justify-between p-4 px-5 border-b border-zinc-800">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"></path>
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">Server</h3>
            </div>
          </div>
          <button type="button" class="btn-close-ssh-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="p-5 overflow-y-auto space-y-4 text-zinc-200 text-xs">

          <!-- Nodi Rilevati -->
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Server salvati</div>
            <div class="space-y-1.5">
              ${nodesListHtml}
            </div>
          </div>

          <!-- Modulo Credenziali -->
          <form id="ssh-credentials-form" class="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4 space-y-3.5">
            <input type="hidden" id="modal-node-id" value="${escapeHtml(node.id)}" />

            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                Connessione
              </span>
            </div>

            <!-- Tailscale / MagicDNS -->
            <div class="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-3 space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-semibold text-indigo-300 flex items-center gap-1.5" for="modal-select-tailscale">
                  <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke-width="2"></circle>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"></path>
                  </svg>
                  <span>Tailscale</span>
                </label>
                <div class="flex items-center gap-2">
                  <span id="tailscale-nodes-count" class="text-[10px] text-indigo-400 font-mono"></span>
                  <button
                    type="button"
                    id="btn-refresh-tailscale"
                    class="h-6 px-2 text-[10px] text-zinc-400 hover:text-indigo-300 flex items-center gap-1 transition rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
                    title="Aggiorna lista nodi rilevati sulla tailnet"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                    <span>Rileva</span>
                  </button>
                </div>
              </div>

              <div class="relative">
                <select
                  id="modal-select-tailscale"
                  class="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-zinc-200 text-xs outline-none transition appearance-none cursor-pointer"
                >
                  <option value="">Rilevamento nodi MagicDNS in corso…</option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-zinc-500">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
              </div>
            </div>

            <!-- Host & Porta API -->
            <div class="grid grid-cols-3 gap-2.5">
              <div class="col-span-2">
                <label class="block text-xs font-medium text-zinc-400 mb-1" for="modal-node-host">Host</label>
                <input
                  type="text"
                  id="modal-node-host"
                  value="${escapeHtml(node.host)}"
                  placeholder="omarchy.local o IP"
                  class="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-zinc-100 font-mono text-xs outline-none transition"
                  required
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-zinc-400 mb-1" for="modal-node-port">Porta API</label>
                <input
                  type="number"
                  id="modal-node-port"
                  value="${currentPort}"
                  placeholder="47995"
                  class="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-zinc-100 font-mono text-xs outline-none transition"
                  required
                />
              </div>
            </div>

            <!-- Streaming Moonlight & DDNS -->
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-[11px] font-medium text-zinc-400" for="modal-node-stream-port">Porta Moonlight</label>
                  <button
                    type="button"
                    id="btn-auto-detect-port"
                    class="h-5 px-1.5 text-[10px] text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 transition rounded bg-amber-500/10 border border-amber-500/20 cursor-pointer"
                    title="Auto-assegna porta libera"
                  >
                    <span>Auto</span>
                  </button>
                </div>
                <input
                  type="number"
                  id="modal-node-stream-port"
                  value="${node.streaming_port || 47989}"
                  placeholder="47989"
                  class="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-zinc-100 font-mono text-xs outline-none transition"
                />
                <div id="modal-node-stream-port-feedback" class="mt-1 text-[10px] text-zinc-500 truncate">Default: 47989</div>
              </div>
              <div>
                <label class="block text-[11px] font-medium text-zinc-400 mb-1" for="modal-node-ddns">DuckDNS (Opzionale)</label>
                <input
                  type="text"
                  id="modal-node-ddns"
                  value="${escapeHtml(node.ddns_domain || '')}"
                  placeholder="es. node2.duckdns.org"
                  class="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-zinc-100 font-mono text-xs outline-none transition"
                />
                <div class="mt-1 text-[10px] text-zinc-500 truncate">Per host remoto fuori rete</div>
              </div>
            </div>

            <!-- Bearer Token -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-xs font-medium text-zinc-400" for="modal-node-token">Bearer Token Amministrativo</label>
                <span class="text-[10px] text-zinc-500 font-mono">omarchy-session-broker token</span>
              </div>
              <div class="relative">
                <input
                  type="password"
                  id="modal-node-token"
                  value="${escapeHtml(currentToken)}"
                  placeholder="omarchy_sec_..."
                  class="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-lg pl-3 pr-8 py-1.5 text-zinc-100 font-mono text-xs outline-none transition"
                  autocomplete="off"
                />
                <button
                  type="button"
                  id="btn-toggle-token-visibility"
                  class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  title="Mostra/Nascondi"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                  </svg>
                </button>
              </div>
            </div>

            <!-- Test REST API -->
            <div>
              <button
                type="button"
                id="btn-modal-test-api"
                class="w-full h-8 px-3 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border border-emerald-500/20 text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                </svg>
                <span>Test Connessione API</span>
              </button>
            </div>

            <!-- Feedback diagnostico -->
            <div id="ssh-test-feedback" class="hidden rounded-lg p-2.5 text-xs border"></div>

            <!-- Fallback SSH -->
            <details class="group bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden text-xs">
              <summary class="p-2.5 font-medium text-zinc-400 cursor-pointer select-none hover:text-zinc-200 flex items-center justify-between">
                <span class="flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                  </svg>
                  <span>Opzioni Avanzate: Fallback SSH</span>
                </span>
                <span class="text-zinc-500 group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div class="p-3 pt-2 border-t border-zinc-800/80 space-y-2.5">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[11px] text-zinc-400 mb-1" for="modal-node-user">Utente SSH</label>
                    <input
                      type="text"
                      id="modal-node-user"
                      value="${escapeHtml(node.user)}"
                      placeholder="daubog44"
                      class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 font-mono text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-[11px] text-zinc-400 mb-1" for="modal-node-pwd">Password SSH</label>
                    <div class="relative">
                      <input
                        type="password"
                        id="modal-node-pwd"
                        placeholder="Password"
                        class="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-2.5 pr-7 py-1.5 text-zinc-100 text-xs outline-none"
                      />
                      <button
                        type="button"
                        id="btn-toggle-pwd-visibility"
                        class="absolute inset-y-0 right-0 pr-2 flex items-center text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  id="btn-modal-test-ssh"
                  class="w-full h-7 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer"
                >
                  Test Fallback SSH
                </button>
              </div>
            </details>

            <button
              type="submit"
              id="btn-modal-save-ssh"
              class="w-full h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              <span>Salva Configurazione e Connetti</span>
            </button>
          </form>

          ${isAdmin ? `
          <!-- Aggiungi Nuovo Nodo -->
          <details class="group bg-zinc-950/40 border border-zinc-800/60 rounded-xl overflow-hidden text-xs">
            <summary class="p-3 font-medium text-zinc-300 cursor-pointer select-none hover:text-white flex items-center justify-between">
              <span>+ Aggiungi un altro server cluster</span>
              <span class="text-zinc-500 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <form id="form-add-cluster-node" class="p-3 pt-0 border-t border-zinc-800/40 space-y-2.5">
              <div class="grid grid-cols-2 gap-2 mt-2">
                <input type="text" id="new-node-name" placeholder="Nome (es. Rig 2)" class="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs outline-none" required />
                <input type="text" id="new-node-host" placeholder="Host o IP" class="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs outline-none" required />
              </div>
              <div class="grid grid-cols-2 gap-2">
                <input type="text" id="new-node-user" value="daubog44" placeholder="Utente SSH" class="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs outline-none" />
                <input type="password" id="new-node-pwd" placeholder="Password SSH" class="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 text-xs outline-none" />
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <input type="number" id="new-node-stream-port" placeholder="Porta Moonlight (auto)" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 font-mono text-xs outline-none" />
                </div>
                <div>
                  <input type="text" id="new-node-ddns" placeholder="DuckDNS (opzionale)" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-100 font-mono text-xs outline-none" />
                </div>
              </div>
              <div id="new-node-port-feedback" class="text-[10px] py-1 px-2 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-400 font-mono flex items-center gap-1.5">
                <span id="new-node-port-feedback-icon">⚡</span>
                <span id="new-node-port-feedback-text">Auto-calcolo porta libera su stessa LAN.</span>
              </div>
              <button type="submit" class="w-full h-8 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium transition cursor-pointer">Aggiungi al Pool</button>
            </form>
          </details>
          ` : ""}

        </div>

        <!-- Footer -->
        <div class="p-3.5 px-5 border-t border-zinc-800 flex justify-end bg-zinc-950/40">
          <button type="button" class="btn-close-ssh-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">
            Chiudi
          </button>
        </div>

      </div>
    </div>
  `;
}
