import { api, type UserStorageListing } from "../services/api";
import { confirmDialog } from "./confirm";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const size = (n: number | null) => n == null ? "Cartella" : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function openUserStorage(username: string, token: string, notify: (message: string, failed?: boolean) => void, changed: () => void) {
  const portal = document.querySelector<HTMLElement>("#modal-portal")!;
  portal.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Storage di ${esc(username)}">
    <div class="modal-card !max-w-4xl w-full"><div class="modal-head"><h3>Storage e backup · ${esc(username)}</h3><button class="btn-ghost" data-close>Chiudi</button></div>
    <div class="modal-body !overflow-auto" data-storage-content>Caricamento…</div></div></div>`;
  const content = portal.querySelector<HTMLElement>("[data-storage-content]")!;
  let path = "";
  let tab = "files";
  let closed = false;
  let busy = false;
  portal.querySelector("[data-close]")?.addEventListener("click", () => { closed = true; portal.innerHTML = ""; });
  const run = async (body: Record<string, unknown>) => {
    if (busy) return;
    busy = true;
    content.querySelectorAll<HTMLButtonElement>("button").forEach(b => b.disabled = true);
    try {
      const result = await api.userStorage(username, body, token);
      notify(result.message ?? "Operazione completata"); changed();
    } catch (err) { notify(String(err), true); }
    finally { busy = false; if (!closed) await load(); }
  };
  const load = async () => {
    try {
      const listing: UserStorageListing = await api.userStorage(username, {action:"list", path}, token);
      if (closed) return;
      content.innerHTML = `<div class="flex gap-2 mb-3"><button class="btn-ghost" data-tab="files">File della home</button><button class="btn-ghost" data-tab="backups">Backup (${listing.backups.length})</button></div>` + (tab === "files"
        ? `<div class="flex items-center gap-2 mb-3"><button class="btn-ghost" data-parent ${!path || path === "." ? "disabled" : ""}>↑ Cartella superiore</button><span class="font-mono text-xs break-all">/${esc(path === "." ? "" : path)}</span></div>
          ${listing.items.length ? listing.items.map(i => `<div class="flex gap-2 items-center py-2 border-b border-zinc-800">
            <button class="btn-ghost text-left flex-1 min-w-0 break-all" ${i.directory ? `data-folder="${esc(i.path)}"` : `data-download="${esc(i.path)}"`}>${i.directory ? "📁" : "↓"} ${esc(i.name)}</button>
            <span class="text-xs text-zinc-500">${size(i.size_bytes)}</span><button class="btn-ghost text-red-400" data-delete="${esc(i.path)}">Elimina</button></div>`).join("") : "<p>Cartella vuota</p>"}`
        : `<p class="text-xs text-zinc-400 mb-3">Il ripristino conserva prima lo stato attuale in un backup. Il ripristino forzato interrompe le sessioni dell'utente e sovrascrive i file presenti nella copia.</p>
          ${listing.backups.length ? listing.backups.map(b => `<div class="py-3 border-b border-zinc-800"><p class="font-mono text-xs break-all">${esc(b.snapshot_name)}</p>
            <p class="text-xs text-zinc-500">${new Date(b.created_at * 1000).toLocaleString()} · ${size(b.size_bytes)}</p>
            <div class="flex gap-2 mt-2"><button class="btn-ghost" data-restore="${b.id}">Ripristina</button><button class="btn-ghost" data-force="${b.id}">Ripristino forzato</button><button class="btn-ghost text-red-400" data-delete-backup="${b.id}">Elimina copia</button></div></div>`).join("") : "<p>Nessun backup</p>"}`);
      content.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab!; void load(); });
      content.querySelector<HTMLButtonElement>("[data-parent]")?.addEventListener("click", () => { path = path.split("/").slice(0, -1).join("/"); void load(); });
      content.querySelectorAll<HTMLButtonElement>("[data-folder]").forEach(b => b.onclick = () => { path = b.dataset.folder!; void load(); });
      content.querySelectorAll<HTMLButtonElement>("[data-download]").forEach(b => b.onclick = async () => {
        b.disabled = true;
        try {
          const saved = await api.downloadUserFile(username, b.dataset.download!, token, (received, total) => {
            b.textContent = total ? `Download ${Math.round(received / total * 100)}%` : `Download ${size(received)}`;
          });
          notify("File salvato in Download"); await api.revealInFileManager(saved);
        } catch (err) { notify(String(err), true); }
        finally { if (!closed) void load(); }
      });
      content.querySelectorAll<HTMLButtonElement>("[data-delete], [data-delete-backup], [data-restore], [data-force]").forEach(b => b.onclick = async () => {
        const deletion = b.dataset.delete !== undefined || b.dataset.deleteBackup !== undefined;
        const force = b.dataset.force !== undefined;
        const question = deletion ? "Eliminare definitivamente questi file o questa copia di backup?" : force
          ? "Interrompere le sessioni dell'utente e ripristinare questa copia? Lo stato attuale sarà salvato prima del ripristino."
          : "Ripristinare questa copia, salvando prima lo stato attuale?";
        if (!(await confirmDialog(question, deletion ? "Elimina" : "Ripristina"))) return;
        await run({action: b.dataset.delete !== undefined ? "delete" : deletion ? "delete-backup" : "restore", path:b.dataset.delete ?? "",
                   snapshot_id: Number(b.dataset.deleteBackup ?? b.dataset.restore ?? b.dataset.force), force});
      });
    } catch (err) { if (!closed) content.textContent = String(err); }
  };
  void load();
}
