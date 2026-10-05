import { getVersion } from "@tauri-apps/api/app";
import { api } from "../services/api";
import type { UpdateInfo } from "../types";
import { Icons } from "./ui/icons";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let latest: UpdateInfo | null = null;
let installing = false;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[c] ?? c);
}

/** Sidebar footer entry: current version, highlighted when an update exists. */
export function renderUpdateButton(): string {
  return `
    <button type="button" id="btn-open-update" class="nav-tab w-full" title="Aggiornamenti">
      ${Icons.download()}
      <span class="nav-label text-left">Aggiornamenti</span>
      <span id="update-pill-dot" class="update-dot hidden"></span>
      <span id="update-pill-label" class="nav-count">v…</span>
    </button>`;
}

export function renderUpdateModal(): string {
  return `
    <div id="update-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
      <div class="modal-card max-w-sm">
        <div class="modal-head">
          <h3 id="update-modal-title">Aggiornamento</h3>
          <button type="button" class="modal-x" data-close aria-label="Chiudi">&times;</button>
        </div>
        <div class="modal-body" id="update-body"></div>
        <div class="modal-foot" id="update-foot"></div>
      </div>
    </div>`;
}

function renderState(state: "checking" | "info" | "installing" | "done" | "error", message = "", outcome?: "restart" | "quit"): void {
  const body = document.querySelector<HTMLElement>("#update-body");
  const foot = document.querySelector<HTMLElement>("#update-foot");
  if (!body || !foot) return;
  const current = latest?.current_version ?? "";
  if (state === "checking") {
    body.innerHTML = `<p class="muted">Controllo in corso…</p>`;
    foot.innerHTML = "";
    return;
  }
  if (state === "installing") {
    body.innerHTML = `<p class="muted">Download e installazione di v${escapeHtml(latest?.latest_version ?? "")}…</p><div class="progress-indeterminate"></div>`;
    foot.innerHTML = "";
    return;
  }
  if (state === "done") {
    body.innerHTML = outcome === "quit"
      ? `<p>L'installer è pronto: l'app si chiude per completare l'aggiornamento.</p>`
      : `<p>v${escapeHtml(latest?.latest_version ?? "")} installata.</p>`;
    foot.innerHTML = `<button type="button" class="btn-primary" id="btn-finish-update">${outcome === "quit" ? "Chiudi e aggiorna" : "Riavvia"}</button>`;
    foot.querySelector("#btn-finish-update")?.addEventListener("click", () => void api.finishUpdate(outcome ?? "restart"));
    return;
  }
  if (state === "error") {
    body.innerHTML = `<p class="text-red-300">${escapeHtml(message)}</p>`;
    foot.innerHTML = `<button type="button" class="btn-ghost" data-close>Chiudi</button><button type="button" class="btn-primary" id="btn-retry-update">Riprova</button>`;
    foot.querySelector("#btn-retry-update")?.addEventListener("click", () => void checkNow(true));
    return;
  }
  if (!latest?.reachable) {
    body.innerHTML = `<p class="muted">Server degli aggiornamenti non raggiungibile.</p>`;
    foot.innerHTML = `<button type="button" class="btn-primary" id="btn-recheck-update">Riprova</button>`;
  } else if (latest.has_update) {
    const notes = latest.notes
      .split("\n")
      .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
      .filter(Boolean)
      .map((l) => `<li>${escapeHtml(l)}</li>`)
      .join("");
    body.innerHTML = `
      <p class="update-versions"><span>v${escapeHtml(current)}</span> → <strong>v${escapeHtml(latest.latest_version)}</strong></p>
      ${notes ? `<ul class="update-notes">${notes}</ul>` : ""}`;
    foot.innerHTML = `<button type="button" class="btn-ghost" data-close>Più tardi</button><button type="button" class="btn-primary" id="btn-apply-update">Installa</button>`;
    foot.querySelector("#btn-apply-update")?.addEventListener("click", () => void install());
    return;
  } else {
    body.innerHTML = `<p>Hai già l'ultima versione <span class="font-mono">v${escapeHtml(current)}</span>.</p>`;
    foot.innerHTML = `<button type="button" class="btn-ghost" id="btn-recheck-update">Controlla di nuovo</button>`;
  }
  foot.querySelector("#btn-recheck-update")?.addEventListener("click", () => void checkNow(true));
}

function paintPill(): void {
  const label = document.querySelector<HTMLElement>("#update-pill-label");
  const dot = document.querySelector<HTMLElement>("#update-pill-dot");
  const pill = document.querySelector<HTMLElement>("#btn-open-update");
  if (!label || !dot || !pill) return;
  const available = Boolean(latest?.has_update);
  label.textContent = available ? `v${latest?.latest_version}` : `v${latest?.current_version ?? ""}`;
  pill.title = available ? `Aggiornamento disponibile: v${latest?.latest_version}` : "Aggiornamenti";
  dot.classList.toggle("hidden", !available);
  pill.classList.toggle("update-pill-available", available);
}

async function checkNow(showInModal: boolean): Promise<void> {
  if (installing) return;
  if (showInModal) renderState("checking");
  try {
    latest = await api.checkForUpdates();
  } catch (err) {
    if (showInModal) renderState("error", String(err));
    return;
  }
  paintPill();
  if (showInModal) renderState("info");
}

async function install(): Promise<void> {
  if (!latest?.download_url || installing) return;
  installing = true;
  renderState("installing");
  try {
    const outcome = await api.installUpdate(latest.download_url);
    renderState("done", "", outcome);
  } catch (err) {
    renderState("error", `Aggiornamento non riuscito: ${String(err)}`);
  } finally {
    installing = false;
  }
}

export function openUpdateModal(): void {
  document.querySelector("#update-modal")?.classList.remove("hidden");
  if (latest) renderState("info");
  void checkNow(true);
}

/** Shows the installed version, checks at start and every 6 hours. */
export async function initUpdater(): Promise<void> {
  const label = document.querySelector<HTMLElement>("#update-pill-label");
  try {
    const version = await getVersion();
    if (label) label.textContent = `v${version}`;
  } catch {
    /* not running inside Tauri */
  }
  document.querySelector("#btn-open-update")?.addEventListener("click", openUpdateModal);
  document.querySelector("#update-modal")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!installing && (target.id === "update-modal" || target.closest("[data-close]"))) {
      document.querySelector("#update-modal")?.classList.add("hidden");
    }
  });
  void checkNow(false);
  window.setInterval(() => void checkNow(false), CHECK_INTERVAL_MS);
}
