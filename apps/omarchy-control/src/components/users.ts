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
      <div class="card text-center text-sm text-zinc-500 py-12">Nessun utente.</div>
    `;
  }

  return `
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      ${users
        .map((u) => {
          const isOwner = u.role === "owner";
          const isBanned = u.status === "banned";
          const rawNodes = u.allowed_nodes && u.allowed_nodes.length > 0 ? u.allowed_nodes : [];
          const isBlocked = rawNodes.length === 0;


          return `
          <div class="user-card card flex flex-col gap-3 ${isBanned ? "opacity-60" : ""}" data-username="${escapeHtml(u.username)}">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center font-semibold text-zinc-300 text-xs shrink-0">
                ${escapeHtml(u.username.substring(0, 2).toUpperCase())}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-medium text-sm text-zinc-100 truncate">${escapeHtml(u.display_name || u.username)}</div>
                <div class="text-[11px] text-zinc-500 font-mono truncate">@${escapeHtml(u.username)}</div>
              </div>
              ${u.auto_record && !isBanned ? `<span class="w-2 h-2 rounded-full bg-red-500" title="Registrazione automatica"></span>` : ""}
              <span class="text-[10px] uppercase tracking-wide ${isBanned ? "text-red-400" : u.role === "guest" ? "text-zinc-500" : "text-blue-400"}">${isBanned ? "bannato" : u.role === "guest" ? "ospite" : escapeHtml(u.role)}</span>
            </div>

            <div class="flex items-center justify-between text-xs">
              <span class="text-zinc-500">PIN</span>
              <span class="flex items-center gap-1.5 font-mono text-zinc-300">
                <span id="pin-mask-${escapeHtml(u.username)}">••••</span>
                <span class="hidden text-emerald-400" id="pin-val-${escapeHtml(u.username)}">${escapeHtml(u.pin)}</span>
                <button type="button" class="pin-toggle text-zinc-500 hover:text-zinc-300 cursor-pointer" data-target="${escapeHtml(u.username)}" title="Mostra PIN" aria-label="Mostra PIN">${Icons.eye("w-3.5 h-3.5")}</button>
              </span>
            </div>
            <div class="flex flex-wrap gap-1">
              ${u.allowed_apps.map((a) => `<span class="px-2 py-0.5 rounded-md bg-zinc-800/70 text-zinc-400 text-[11px]">${escapeHtml(a)}</span>`).join("")}
              ${isBlocked ? `<span class="px-2 py-0.5 rounded-md text-amber-400 text-[11px]">nessun nodo</span>` : rawNodes.includes("*") ? "" : `<span class="px-2 py-0.5 rounded-md bg-zinc-800/70 text-zinc-400 text-[11px]">${escapeHtml(rawNodes.join(", "))}</span>`}
            </div>

            <div class="flex justify-between gap-2 text-xs text-zinc-400">
              <span>Home desktop e giochi</span>
              <span class="font-mono">${u.storage_used_gb == null ? "—" : `${u.storage_used_gb.toFixed(2)} GB`} / ${(u.storage_limit_gb ?? 0) > 0 ? `${u.storage_limit_gb} GB` : "illimitato"}</span>
            </div>
            ${isAdmin ? `<button type="button" class="btn-user-storage btn-ghost text-xs text-left" data-username="${escapeHtml(u.username)}">Sfoglia file e backup</button>` : ""}
            ${(u.storage_limit_gb ?? 0) > 0 && !u.storage_quota_active ? `<span class="text-xs text-amber-400">Quota non attiva: verifica lo storage del nodo</span>` : ""}

            <div class="flex items-center gap-1.5 pt-3 mt-auto border-t border-zinc-800/80">
              <button type="button" class="btn-share-invite btn-ghost flex items-center gap-1.5" data-username="${escapeHtml(u.username)}" data-pin="${escapeHtml(u.pin)}" data-display="${escapeHtml(u.display_name)}">
                ${Icons.share("w-3.5 h-3.5")} Invito
              </button>
              ${isAdmin ? `
                <button type="button" class="btn-edit-user icon-btn ml-auto" data-username="${escapeHtml(u.username)}" title="Modifica" aria-label="Modifica">${Icons.sliders("w-3.5 h-3.5")}</button>
                ${!isOwner ? `
                  ${isBanned
                    ? `<button type="button" class="btn-unban-user icon-btn" data-username="${escapeHtml(u.username)}" title="Riattiva" aria-label="Riattiva">${Icons.check("w-3.5 h-3.5")}</button>`
                    : `<button type="button" class="btn-ban-user icon-btn hover:!text-amber-400" data-username="${escapeHtml(u.username)}" title="Banna" aria-label="Banna">${Icons.lock("w-3.5 h-3.5")}</button>`}
                  <button type="button" class="btn-remove-user icon-btn hover:!text-red-400" data-username="${escapeHtml(u.username)}" title="Elimina" aria-label="Elimina">${Icons.trash("w-3.5 h-3.5")}</button>
                ` : ""}
              ` : ""}
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
        <div class="flex items-center justify-between px-5 pt-4 pb-1">
          <div class="flex items-center gap-2.5">
            <div>
              <h3 class="text-sm font-semibold text-zinc-100" id="modal-title">Nuovo utente</h3>
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
                <option value="guest" selected>Ospite</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label class="block text-zinc-400 font-medium mb-1">Max Bitrate</label>
              <select name="new_bitrate" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition">
                <option value="15">15 Mbps</option>
                <option value="20" selected>20 Mbps</option>
                <option value="30">30 Mbps</option>
                <option value="40">40 Mbps</option>
              </select>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-zinc-400 font-medium">PIN</label>

            </div>
            <div class="flex gap-2">
              <input type="text" name="new_pin" placeholder="Automatico" minlength="4" maxlength="16" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none focus:border-emerald-500 transition" />
              <button type="button" class="h-8 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-medium transition shrink-0 cursor-pointer" id="generate-pin-btn">Rigenera</button>
            </div>
          </div>

          <div>
            <label for="new-storage-input" class="block text-zinc-400 font-medium mb-1">Limite home desktop e giochi (GB)</label>
            <input type="number" id="new-storage-input" name="new_storage_gb" value="0" min="0" step="0.1" required class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition" />
            <p class="text-[11px] text-zinc-500 mt-1">0 = illimitato. Modificabile durante la sessione.</p>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1.5">App</label>
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
              <span class="font-medium text-zinc-300 text-[11px]">Tutti i nodi</span>
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
                <span class="font-medium text-zinc-200 text-xs">Registra sempre le sessioni</span>
              </div>
            </label>
          </div>

          <!-- Footer Buttons -->
          <div class="pt-3 border-t border-zinc-800 flex justify-end gap-2">
            <button type="button" class="btn-close-modal h-8 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer">Annulla</button>
            <button type="submit" id="submit-add-user" class="h-8 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer">Crea</button>
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
        <div class="flex items-center justify-between px-5 pt-4 pb-1">
          <div class="flex items-center gap-2.5">
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
                <option value="15">15 Mbps</option>
                <option value="20">20 Mbps (Standard 1080p)</option>
                <option value="30">30 Mbps</option>
                <option value="40">40 Mbps</option>
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
            <label for="edit-storage-input" class="block text-zinc-400 font-medium mb-1">Limite home desktop e giochi (GB)</label>
            <input type="number" id="edit-storage-input" name="edit_storage_gb" value="0" min="0" step="0.1" required class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500 transition" />
            <p id="edit-storage-usage" class="text-[11px] text-zinc-500 mt-1"></p>
            <p class="text-[11px] text-zinc-500 mt-1">0 = illimitato. Il cambio è immediato; il limite non può essere inferiore allo spazio occupato. Backup e registrazioni NAS hanno retention separata.</p>
          </div>

          <div>
            <label class="block text-zinc-400 font-medium mb-1.5">App</label>
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
              <span class="font-medium text-zinc-300 text-[11px]">Tutti i nodi</span>
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
                <span class="font-medium text-zinc-200 text-xs">Registra sempre le sessioni</span>
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

/**
 * Invite text for a user. The address always carries the port: without it
 * Moonlight falls back to 47989, i.e. Sunshine = the owner's desktop.
 */
export function buildInviteMessage(displayName: string, address: string, pin = "", isGuest = true): string {
  return `🎮 Ciao ${displayName}! Ecco il tuo accesso a Omarchy Gaming:

1️⃣ Scarica Moonlight (gratis): https://moonlight-stream.org

2️⃣ In Moonlight tocca "+" (Aggiungi PC) e scrivi esattamente, porta compresa:
${address}

3️⃣ La prima volta Moonlight ti mostra un codice di 4 cifre: mandamelo qui e ti autorizzo.${
    isGuest && pin
      ? `

4️⃣ Poi apri "Wolf UI", scegli il profilo ${displayName} e inserisci il tuo PIN: ${pin}
(tienilo per te: è la chiave del tuo profilo) 🚀`
      : " 🚀"
  }`;
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
  const whatsappMsg = buildInviteMessage(user.display_name, activeHost, user.pin, isGuest);

  return `
    <div id="moonlight-invite-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 pt-4 pb-1">
          <div class="flex items-center gap-2.5">
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">Invito</h3>
              <p class="text-[11px] text-zinc-400"><strong class="text-zinc-200">${escapeHtml(user.display_name)}</strong>
                · ${isGuest ? `<span class="text-violet-300">Wolf · ospite</span>` : `<span class="text-emerald-300">Sunshine · admin</span>`}</p>
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
              <label class="text-zinc-400 font-medium text-[11px]" for="invite-host-select">Indirizzo</label>
              <select id="invite-host-select" class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-zinc-100 outline-none font-mono text-xs cursor-pointer">
                ${availableHosts.map((h) => `<option value="${escapeHtml(h.host)}" ${h.host === activeHost ? "selected" : ""}>${escapeHtml(h.label)}</option>`).join("")}
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-zinc-400 font-medium text-[11px]" for="invite-port-input">Porta</label>
              <input type="number" id="invite-port-input" value="${currentPort}" min="1024" max="65535" class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-zinc-100 font-mono text-xs outline-none" />
            </div>
          </div>

          <!-- Quick Actions Bar -->
          <div class="grid grid-cols-2 gap-2">
            <button type="button" id="btn-test-stream-port" class="h-8 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 font-medium text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer">
              ${Icons.zap("w-3.5 h-3.5 text-amber-400")}
              <span>Verifica porta</span>
            </button>
            <button type="button" id="btn-open-moonlight" class="h-8 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer">
              ${Icons.play("w-3.5 h-3.5 text-emerald-400")}
              <span>Apri qui</span>
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
                <span>QR per il telefono</span>
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
                <span>Approva PIN</span>
              </button>
            </div>
          </div>

          <!-- WhatsApp Primary Share -->
          <button type="button" id="btn-copy-whatsapp-msg" class="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2 transition cursor-pointer" data-msg="${escapeHtml(whatsappMsg)}">
            ${Icons.send("w-3.5 h-3.5")}
            <span>Copia messaggio di invito</span>
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

export function renderPairDeviceModal(
  defaultPin = "",
  users: UserRecord[] = [],
  preselect = "",
  pending: { client_ip: string }[] = [],
  clientIp = "",
): string {
  const selected = users.find((u) => u.username === preselect);
  const device = clientIp || (pending.length === 1 ? pending[0].client_ip : "");
  const guestSelected = selected?.role === "guest";
  return `
    <div id="pair-device-modal" class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-5 pt-4 pb-1">
          <div class="flex items-center gap-2.5">
            <div>
              <h3 class="text-sm font-semibold text-zinc-100">${pending.length ? "Nuovo dispositivo" : "Accoppia dispositivo"}</h3>
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
            ${pending.length > 1 ? `
              <select id="pair-device-select" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-2 text-zinc-100 text-xs outline-none" aria-label="Dispositivo">
                ${pending.map((p) => `<option value="${escapeHtml(p.client_ip)}" ${p.client_ip === device ? "selected" : ""}>${escapeHtml(p.client_ip)}</option>`).join("")}
              </select>` : device ? `<p class="text-[11px] text-zinc-500">Richiesta da <span class="font-mono text-zinc-300">${escapeHtml(device)}</span></p>` : ""}
            <input type="hidden" id="pair-client-ip" value="${escapeHtml(device)}" />
            <label class="block text-zinc-400 text-xs font-medium" for="pair-pin-input">
              Codice mostrato da Moonlight
            </label>
            <input
              type="text"
              id="pair-pin-input"
              inputmode="numeric"
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
              Nome dispositivo (facoltativo)
            </label>
            <input
              type="text"
              id="pair-name-input"
              name="pair_name"
              placeholder="es. iPhone di Marco"
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
          <p id="pair-target-hint" class="text-[11px] text-zinc-500">Gli ospiti vanno solo su Wolf.</p>

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
