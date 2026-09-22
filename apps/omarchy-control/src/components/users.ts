import type { UserRecord, NodeEntry } from "../types";
import { Icons } from "./ui/icons";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[c] ?? c);
}

export function renderUsersList(users: UserRecord[], isAdmin = true): string {
  if (users.length === 0) {
    return `
      <div class="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-400">
        Nessun profilo utente configurato.
      </div>
    `;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      ${users
        .map((u) => {
          const isOwner = u.role === "owner";
          const isBanned = u.status === "banned";
          const rawNodes = u.allowed_nodes && u.allowed_nodes.length > 0 ? u.allowed_nodes : [];
          const isBlocked = rawNodes.length === 0;

          const nodesLabel = isBlocked
            ? `<span class="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px] font-medium">Nessun host</span>`
            : rawNodes.includes("*")
              ? `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-medium">Tutti i nodi</span>`
              : `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-medium">${escapeHtml(rawNodes.join(", "))}</span>`;

          const roleColor = isOwner
            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
            : u.role === "admin"
              ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
              : "bg-zinc-800 text-zinc-300 border-zinc-700";

          return `
          <div class="user-card bg-zinc-900/80 border ${isOwner ? "border-amber-500/30" : "border-zinc-800/80"} rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition" data-username="${escapeHtml(u.username)}">
            
            <div>
              <div class="flex items-center justify-between gap-3 pb-3.5 border-b border-zinc-800/80">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700/60 flex items-center justify-center font-bold text-zinc-200 text-sm">
                    ${escapeHtml(u.username.substring(0, 2).toUpperCase())}
                  </div>
                  <div>
                    <div class="font-semibold text-sm text-zinc-100">${escapeHtml(u.display_name)}</div>
                    <div class="text-xs text-zinc-400 font-mono">@${escapeHtml(u.username)}</div>
                  </div>
                </div>
                ${
                  isBanned
                    ? `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">BANNATO</span>`
                    : `<div class="flex items-center gap-1.5">
                        ${u.auto_record ? `<span class="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full" title="Registrazione automatica 30 FPS H.265 attiva"><span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>REC 30 FPS</span>` : ""}
                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${roleColor}">${u.role.toUpperCase()}</span>
                      </div>`
                }
              </div>

              <div class="py-3.5 space-y-2.5 text-xs">
                <div class="flex items-center justify-between text-zinc-400">
                  <span>PIN Streaming</span>
                  <span class="flex items-center gap-1.5 font-mono text-zinc-200">
                    <span id="pin-mask-${escapeHtml(u.username)}">••••</span>
                    <span class="hidden font-bold text-emerald-400" id="pin-val-${escapeHtml(u.username)}">${escapeHtml(u.pin)}</span>
                    <button type="button" class="pin-toggle text-zinc-500 hover:text-zinc-300 p-0.5 text-xs transition cursor-pointer" data-target="${escapeHtml(u.username)}" title="Mostra/Nascondi PIN">
                      ${Icons.eye("w-3.5 h-3.5")}
                    </button>
                  </span>
                </div>

                <div class="flex items-center justify-between text-zinc-400">
                  <span>Limite Bitrate</span>
                  <span class="font-semibold text-zinc-200 font-mono">${u.max_bitrate_mbps} Mbps</span>
                </div>

                <div class="flex items-center justify-between text-zinc-400">
                  <span>Nodi Abilitati</span>
                  ${nodesLabel}
                </div>

                <div class="pt-1">
                  <div class="text-[11px] text-zinc-400 mb-1.5 uppercase font-medium">App Autorizzate</div>
                  <div class="flex flex-wrap gap-1">
                    ${u.allowed_apps.map((a) => `<span class="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 text-[11px] font-medium">${escapeHtml(a)}</span>`).join("")}
                  </div>
                </div>
              </div>
            </div>

            <div class="pt-3.5 border-t border-zinc-800/80 flex items-center justify-between gap-2">
              <button type="button" class="btn-share-invite h-8 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm" data-username="${escapeHtml(u.username)}" data-pin="${escapeHtml(u.pin)}" data-display="${escapeHtml(u.display_name)}">
                ${Icons.share("w-3.5 h-3.5 text-emerald-400")} <span>Invito Moonlight</span>
              </button>
              
              <div class="flex items-center gap-1.5">
                ${
                  !isAdmin
                    ? `<span class="text-xs text-zinc-500 font-medium">Sandbox</span>`
                    : `
                    <button type="button" class="btn-edit-user h-8 px-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 text-xs font-medium transition flex items-center gap-1.5 cursor-pointer shadow-sm" data-username="${escapeHtml(u.username)}" title="Modifica utente">
                      ${Icons.sliders("w-3.5 h-3.5 text-zinc-400")}
                      <span>Modifica</span>
                    </button>
                    ${
                      !isOwner
                        ? `
                        ${
                          isBanned
                            ? `<button type="button" class="btn-unban-user h-8 px-2.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/40 text-xs font-medium transition cursor-pointer shadow-sm" data-username="${escapeHtml(u.username)}">Sbanna</button>`
                            : `<button type="button" class="btn-ban-user h-8 px-2.5 rounded-lg bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-700/40 text-xs font-medium transition cursor-pointer shadow-sm" data-username="${escapeHtml(u.username)}">Banna</button>`
                        }
                        <button type="button" class="btn-remove-user h-8 w-8 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 flex items-center justify-center transition cursor-pointer shadow-sm" data-username="${escapeHtml(u.username)}" title="Elimina utente">
                          ${Icons.trash("w-3.5 h-3.5")}
                        </button>
                      `
                        : ""
                    }
                  `
                }
              </div>
            </div>

          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

export function renderAddUserModal(availableNodes: NodeEntry[] = []): string {
  const nodeOptions = availableNodes.length > 0
    ? availableNodes.map((n) => `
        <label class="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition">
          <input type="checkbox" name="new_node" value="${escapeHtml(n.id)}" class="new-node-check rounded border-zinc-700 text-emerald-500 focus:ring-0" />
          <span class="text-xs text-zinc-200">🎮 <strong>${escapeHtml(n.name)}</strong> <span class="text-zinc-500">(${escapeHtml(n.host)})</span></span>
        </label>
      `).join("")
    : `<p class="text-xs text-zinc-500">Nessuna sandbox registrata</p>`;

  return `
    <div id="add-user-modal" class="modal-backdrop fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              ${Icons.user("w-4 h-4")}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100" id="modal-title">Nuovo Profilo Giocatore</h3>
            </div>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="close-user-modal">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Form -->
        <form id="add-user-form" class="p-5 overflow-y-auto space-y-3.5 text-xs">
          
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Username</label>
              <input type="text" name="new_username" required placeholder="es. marco" autocomplete="off" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition" />
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Nome</label>
              <input type="text" name="new_display" required placeholder="es. Marco R." class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Ruolo</label>
              <select name="new_role" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition">
                <option value="guest" selected>Guest (Ospite)</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Max Bitrate</label>
              <select name="new_bitrate" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition">
                <option value="15">15 Mbps (Risparmio)</option>
                <option value="20" selected>20 Mbps (Standard 1080p)</option>
                <option value="30">30 Mbps (Qualità Alta)</option>
                <option value="40">40 Mbps (4K / Massima)</option>
              </select>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-zinc-400 font-medium">PIN Profilo</label>
              <span class="text-[10px] text-zinc-500 font-mono">Opzionale • Auto-generato</span>
            </div>
            <div class="flex gap-2">
              <input type="text" name="new_pin" placeholder="Generato automaticamente" minlength="4" maxlength="16" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-emerald-500 transition" />
              <button type="button" class="h-8 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-medium transition shrink-0 cursor-pointer" id="generate-pin-btn">Rigenera</button>
            </div>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1.5">Applicazioni Abilitate</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition">
                <input type="checkbox" name="app_steam" value="steam" checked class="rounded border-zinc-700 text-emerald-500" />
                <span class="text-[11px] font-medium text-zinc-200">Steam</span>
              </label>
              <label class="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition">
                <input type="checkbox" name="app_desktop" value="desktop" class="rounded border-zinc-700 text-emerald-500" />
                <span class="text-[11px] font-medium text-zinc-200">Desktop</span>
              </label>
              <label class="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition">
                <input type="checkbox" name="app_retro" value="retro" class="rounded border-zinc-700 text-emerald-500" />
                <span class="text-[11px] font-medium text-zinc-200">Emulatori</span>
              </label>
            </div>
          </div>

          <!-- Nodi Cluster -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="new_node_all" id="new-node-all" value="*" class="rounded border-zinc-700 text-emerald-500" />
              <span class="font-medium text-zinc-300 text-[11px]">Consenti tutti i nodi cluster (*)</span>
            </label>
            <div id="new-specific-nodes" class="grid grid-cols-1 gap-1 pt-1">
              ${nodeOptions}
            </div>
          </div>

          <!-- Auto Record -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
            <label class="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" name="new_user_auto_record" id="new-user-auto-record" class="rounded border-zinc-700 text-rose-500 focus:ring-0" />
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-rose-500"></span>
                <span class="font-medium text-zinc-200 text-xs">Registra sempre le sessioni (30 FPS H.265 su NAS)</span>
              </div>
            </label>
          </div>

          <!-- Footer Buttons -->
          <div class="pt-3 border-t border-zinc-800 flex justify-end gap-2">
            <button type="button" class="btn-close-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Annulla</button>
            <button type="submit" id="submit-add-user" class="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer">Crea Utente</button>
          </div>

        </form>
      </div>
    </div>
  `;
}

export function renderEditUserModal(availableNodes: NodeEntry[] = []): string {
  const nodeOptions = availableNodes.length > 0
    ? availableNodes.map((n) => `
        <label class="flex items-center gap-2 p-1.5 rounded-lg bg-zinc-900 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition">
          <input type="checkbox" name="edit_node" value="${escapeHtml(n.id)}" class="edit-node-check rounded border-zinc-700 text-emerald-500 focus:ring-0" />
          <span class="text-xs text-zinc-200"><strong>${escapeHtml(n.name)}</strong> <span class="text-zinc-500">(${escapeHtml(n.host)})</span></span>
        </label>
      `).join("")
    : `<p class="text-xs text-zinc-500">Nessuna sandbox registrata</p>`;

  return `
    <div id="edit-user-modal" class="modal-backdrop fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              ${Icons.user("w-4 h-4")}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100" id="edit-modal-title">Modifica Profilo</h3>
            </div>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="close-edit-user-modal">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Form -->
        <form id="edit-user-form" class="p-5 overflow-y-auto space-y-3.5 text-xs">
          <input type="hidden" name="target_username" id="edit-target-username" value="" />

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Username</label>
              <input type="text" name="edit_username" id="edit-username-input" required autocomplete="off" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition" />
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Nome</label>
              <input type="text" name="edit_display" id="edit-display-input" required class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Ruolo</label>
              <select name="edit_role" id="edit-role-select" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition">
                <option value="guest">Guest (Ospite)</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Max Bitrate</label>
              <select name="edit_bitrate" id="edit-bitrate-select" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition">
                <option value="15">15 Mbps (Risparmio)</option>
                <option value="20">20 Mbps (Standard 1080p)</option>
                <option value="30">30 Mbps (Qualità Alta)</option>
                <option value="40">40 Mbps (4K / Massima)</option>
              </select>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-zinc-400 font-medium">Nuovo PIN</label>
              <span class="text-[10px] text-zinc-500 font-mono">Lascia vuoto se invariato</span>
            </div>
            <div class="flex gap-2">
              <input type="text" name="edit_pin" id="edit-pin-input" placeholder="Invariato" minlength="4" maxlength="16" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-emerald-500 transition" />
              <button type="button" class="h-8 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-medium transition shrink-0 cursor-pointer" id="generate-edit-pin-btn">Genera</button>
            </div>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1.5">Applicazioni Abilitate</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition">
                <input type="checkbox" name="edit_app_steam" id="edit-app-steam" value="steam" class="rounded border-zinc-700 text-emerald-500" />
                <span class="text-[11px] font-medium text-zinc-200">Steam</span>
              </label>
              <label class="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition">
                <input type="checkbox" name="edit_app_desktop" id="edit-app-desktop" value="desktop" class="rounded border-zinc-700 text-emerald-500" />
                <span class="text-[11px] font-medium text-zinc-200">Desktop</span>
              </label>
              <label class="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition">
                <input type="checkbox" name="edit_app_retro" id="edit-app-retro" value="retro" class="rounded border-zinc-700 text-emerald-500" />
                <span class="text-[11px] font-medium text-zinc-200">Emulatori</span>
              </label>
            </div>
          </div>

          <!-- Nodi Cluster -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="edit_node_all" id="edit-node-all" value="*" class="rounded border-zinc-700 text-emerald-500" />
              <span class="font-medium text-zinc-300 text-[11px]">Consenti tutti i nodi cluster (*)</span>
            </label>
            <div id="edit-specific-nodes" class="grid grid-cols-1 gap-1 pt-1">
              ${nodeOptions}
            </div>
          </div>

          <!-- Auto Record -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
            <label class="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" name="edit_user_auto_record" id="edit-user-auto-record" class="rounded border-zinc-700 text-rose-500 focus:ring-0" />
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-rose-500"></span>
                <span class="font-medium text-zinc-200 text-xs">Registra sempre le sessioni (30 FPS H.265 su NAS)</span>
              </div>
            </label>
          </div>

          <!-- Footer Buttons -->
          <div class="pt-3 border-t border-zinc-800 flex justify-end gap-2">
            <button type="button" class="btn-close-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Annulla</button>
            <button type="submit" id="submit-edit-user" class="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer">Salva Modifiche</button>
          </div>

        </form>
      </div>
    </div>
  `;
}

export function renderMoonlightInviteModal(
  user: UserRecord,
  activeHost: string,
  availableHosts: { label: string; host: string }[],
  qrSvg: string,
  currentPort: number = 47989,
): string {
  const deepLink = `moonlight://${activeHost}`;
  const isGuest = user.role === "guest";
  // The port is part of the address on purpose: without it Moonlight falls
  // back to 47989 (Sunshine = the owner's desktop), which is how a guest
  // ended up on the admin's own Steam.
  const whatsappMsg = `🎮 Ciao ${user.display_name}, ecco l'accesso a Omarchy Cloud Gaming:

1. Scarica Moonlight: https://moonlight-stream.org
2. In Moonlight aggiungi il PC con questo indirizzo, porta inclusa: ${activeHost} (oppure apri: ${deepLink})
3. Al primo avvio Moonlight ti mostrerà un codice a 4 cifre: mandamelo per autorizzarti all'istante!`;

  return `
    <div id="moonlight-invite-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              ${Icons.share("w-4 h-4")}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">Invito Moonlight</h3>
              <p class="text-[11px] text-zinc-400">Giocatore: <strong class="text-emerald-400">${escapeHtml(user.display_name)}</strong>
                · ${isGuest
                  ? `<span class="text-violet-300">Wolf, sandbox ospite isolata (porta ${currentPort})</span>`
                  : `<span class="text-emerald-300">Sunshine, desktop amministratore (porta ${currentPort})</span>`}</p>
            </div>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="btn-close-invite-modal">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div class="p-5 space-y-3.5 text-xs">
          
          <!-- Host & Port Row -->
          <div class="grid grid-cols-3 gap-2 items-end">
            <div class="col-span-2 space-y-1">
              <label class="text-zinc-400 font-medium text-[11px]" for="invite-host-select">Indirizzo Server</label>
              <select id="invite-host-select" class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-zinc-100 outline-none font-mono text-xs cursor-pointer">
                ${availableHosts.map((h) => `<option value="${escapeHtml(h.host)}" ${h.host === activeHost ? "selected" : ""}>${escapeHtml(h.label)}</option>`).join("")}
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-zinc-400 font-medium text-[11px]" for="invite-port-input">Porta WAN</label>
              <input type="number" id="invite-port-input" value="${currentPort}" min="1024" max="65535" class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none" />
            </div>
          </div>

          <!-- Quick Actions Bar -->
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="btn-test-stream-port" class="h-8 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 font-medium text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer">
              ${Icons.zap("w-3.5 h-3.5 text-amber-400")}
              <span>Verifica Porta WAN</span>
            </button>
            <button type="button" id="btn-open-moonlight" class="h-8 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer">
              ${Icons.play("w-3.5 h-3.5 text-emerald-400")}
              <span>Test Moonlight Locale</span>
            </button>
          </div>

          <div id="stream-test-feedback" class="hidden rounded-xl p-2.5 border text-xs"></div>

          <!-- QR Code and Link Box -->
          <div class="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center gap-3.5">
            <div class="p-1.5 bg-white rounded-lg shrink-0 shadow-sm">
              <div id="invite-qr-container" class="w-20 h-20 flex items-center justify-center">
                ${qrSvg}
              </div>
            </div>
            <div class="flex-1 space-y-2 min-w-0">
              <div class="font-medium text-zinc-200 text-xs flex items-center gap-1.5">
                ${Icons.qrCode("w-3.5 h-3.5 text-emerald-400 shrink-0")}
                <span>Scansiona con Smartphone</span>
              </div>
              <div class="flex items-center gap-1.5">
                <input type="text" readonly id="invite-link-input" value="${escapeHtml(deepLink)}" class="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-emerald-400 font-mono text-[11px] outline-none" />
                <button type="button" id="btn-copy-invite-link" class="h-7 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition flex items-center gap-1 cursor-pointer shrink-0">
                  ${Icons.copy("w-3 h-3")}
                  <span>Copia</span>
                </button>
              </div>
              <button type="button" id="btn-trigger-pair-from-invite" class="w-full h-7 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer">
                ${Icons.zap("w-3 h-3 text-amber-400")}
                <span>Approva PIN 4 Cifre Client</span>
              </button>
            </div>
          </div>

          <!-- WhatsApp Primary Share -->
          <button type="button" id="btn-copy-whatsapp-msg" class="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2 transition cursor-pointer" data-msg="${escapeHtml(whatsappMsg)}">
            ${Icons.send("w-3.5 h-3.5")}
            <span>Copia Messaggio per WhatsApp / Telegram</span>
          </button>
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-zinc-800 flex justify-end bg-zinc-950/40">
          <button type="button" class="btn-close-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer" id="btn-close-invite-footer">
            Chiudi
          </button>
        </div>

      </div>
    </div>
  `;
}

export function renderPairDeviceModal(defaultPin = "", users: UserRecord[] = [], preselect = ""): string {
  const selected = users.find((u) => u.username === preselect);
  const guestSelected = selected?.role === "guest";
  return `
    <div id="pair-device-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              ${Icons.zap("w-4 h-4")}
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">Accoppiamento Moonlight</h3>
            </div>
          </div>
          <button type="button" class="btn-close-modal text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition cursor-pointer" id="btn-close-pair-modal">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Form -->
        <form id="pair-device-form" class="p-5 space-y-4 text-xs">
          <div class="space-y-1.5 text-center">
            <label class="block text-zinc-400 text-xs font-medium" for="pair-pin-input">
              Codice a 4 cifre mostrato da Moonlight:
            </label>
            <input
              type="text"
              id="pair-pin-input"
              name="pair_pin"
              required
              minlength="4"
              maxlength="4"
              pattern="[0-9]{4}"
              placeholder="••••"
              value="${escapeHtml(defaultPin)}"
              class="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2.5 text-center text-2xl font-mono tracking-[0.35em] text-amber-400 outline-none focus:border-amber-500 transition"
              autocomplete="off"
              autofocus
            />
          </div>

          <div class="space-y-1">
            <label class="block text-zinc-400 text-[11px]" for="pair-name-input">
              Nome Dispositivo (Opzionale)
            </label>
            <input
              type="text"
              id="pair-name-input"
              name="pair_name"
              placeholder="es. iPhone di Marco / Laptop"
              class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-amber-500 transition"
            />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <label class="block text-zinc-400 text-[11px]" for="pair-user-select">Utente</label>
              <select id="pair-user-select" name="pair_user" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-zinc-100 text-xs outline-none focus:border-amber-500 cursor-pointer">
                <option value="">Nessuno</option>
                ${users
                  .map(
                    (u) => `<option value="${escapeHtml(u.username)}" data-role="${escapeHtml(u.role)}" ${u.username === preselect ? "selected" : ""}>${escapeHtml(u.display_name)} (${u.role === "guest" ? "ospite" : "admin"})</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="space-y-1">
              <label class="block text-zinc-400 text-[11px]" for="pair-target-select">Server</label>
              <select id="pair-target-select" name="pair_target" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-zinc-100 text-xs outline-none focus:border-amber-500 cursor-pointer">
                <option value="auto" ${guestSelected ? "" : "selected"}>Automatico</option>
                <option value="wolf" ${guestSelected ? "selected" : ""}>Wolf (ospiti, 49989)</option>
                <option value="sunshine" ${guestSelected ? "disabled" : ""}>Sunshine (admin, 47989)</option>
              </select>
            </div>
          </div>
          <p id="pair-target-hint" class="text-[11px] text-zinc-500 leading-relaxed">
            Gli ospiti si accoppiano solo a Wolf: Sunshine mostra il desktop e lo Steam dell'amministratore.
          </p>

          <div id="pair-feedback" class="hidden rounded-xl p-2.5 border text-xs"></div>

          <!-- Buttons -->
          <div class="pt-2 flex justify-end gap-2 border-t border-zinc-800/80">
            <button type="button" class="btn-close-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer" id="btn-cancel-pair">
              Annulla
            </button>
            <button type="submit" id="btn-submit-pair" class="h-8 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs shadow-sm transition flex items-center gap-1.5 cursor-pointer">
              ${Icons.check("w-3.5 h-3.5")} <span>Approva e Accoppia</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  `;
}

