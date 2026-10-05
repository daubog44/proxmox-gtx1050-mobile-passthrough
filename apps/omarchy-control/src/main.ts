import { api, type RecordingItem } from "./services/api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { renderTelemetryWidget } from "./components/telemetry";
import { renderSessionsList, renderLiveMonitorModal, renderPipelineBadges } from "./components/sessions";
import { renderRecordingsView, renderRecordingPlayerModal } from "./components/recordings";
import { createLiveVideoPlayer, type LiveVideoPlayer } from "./utils/live_video";
import { startWebRtcVideo, type WebRtcSession } from "./utils/webrtc_video";
import { renderUsersList, renderAddUserModal, renderEditUserModal, renderMoonlightInviteModal, renderPairDeviceModal, buildInviteMessage } from "./components/users";
import { renderUpdateModal, renderUpdateButton, initUpdater } from "./components/updater";
import { renderLoginScreen, renderSetupScreen } from "./components/login";
import { renderSshNodeModal } from "./components/ssh_node_modal";
import { renderEnterpriseDashboard, renderNasMountModal, refreshNasMountModal } from "./components/enterprise";
import { Icons } from "./components/ui/icons";
import { confirmDialog } from "./components/confirm";
import { openUserStorage } from "./components/storage";
import { wireRemoteInput } from "./utils/remote_input";
import QRCode from "qrcode";
import type {
  Check,
  Dashboard,
  DisplayInfo,
  MultiUserOverview,
  SetupConfig,
  State,
  UpdateInfo,
  AuthSession,
  NodeEntry,
  UserRecord,
  VpnPeer,
  SavegameManifest,
  DesktopVpnStatus,
  DdnsStatus,
  PortSuggestion,
} from "./types";
import { computeSuggestedStreamingPort, normalizeDdnsDomain } from "./utils/network";
import "./style.css";

const defaults: SetupConfig = {
  vm_host: "omarchy.local",
  vm_address: "192.168.0.28",
  user: "daubog44",
  client_address: "",
  rtp_port: "40100",
  microphone: "",
  fedora_source: "@DEFAULT_SOURCE@",
};

let dirty = false;
let hydrated = false;
let refreshing = false;
let dashboard: Dashboard | null = null;
let multiUser: MultiUserOverview | null = null;
let displays: DisplayInfo[] = [];
let autoRefreshTimer: number | null = null;
let autoRefreshActive = true;
let latestUpdateInfo: UpdateInfo | null = null;
let currentSession: AuthSession | null = null;
let availableNodes: NodeEntry[] = [];
let activeNode: NodeEntry | null = null;
let enterpriseSettings: Record<string, string> = {};
let vpnPeersList: VpnPeer[] = [];
let savegamesList: SavegameManifest[] = [];
let ddnsStatusInfo: DdnsStatus | null = null;

const $ = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento UI mancante: ${selector}`);
  return element;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  })[character] ?? character);
}

function labelFor(state: State) {
  return ({ ready: "Pronto", missing: "Manca", blocked: "Bloccato", unknown: "Da verificare" })[state];
}

function formatToastMessage(raw: unknown): string {
  if (raw === null || raw === undefined) return "Operazione completata con successo";

  if (typeof raw === "object") {
    const obj = raw as Record<string, any>;
    if (obj.message && typeof obj.message === "string") return formatToastMessage(obj.message);
    if (obj.error && typeof obj.error === "string") return formatToastMessage(obj.error);
    if (obj.reason && typeof obj.reason === "string") return formatToastMessage(obj.reason);
    if (obj.status && typeof obj.status === "string" && Object.keys(obj).length === 1) {
      return `Stato: ${obj.status}`;
    }
    if (raw instanceof Error) return raw.message;
    if (obj.desc && typeof obj.desc === "string") return obj.desc;
    if (obj.info && typeof obj.info === "string") return obj.info;

    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }

  let str = String(raw).trim();
  if ((str.startsWith("{") && str.endsWith("}")) || (str.startsWith("[") && str.endsWith("]"))) {
    try {
      const parsed = JSON.parse(str);
      return formatToastMessage(parsed);
    } catch {
      // not JSON
    }
  }

  if (str.startsWith("Error: ")) str = str.substring(7);
  if (str.startsWith("error: ")) str = str.substring(7);

  return str;
}

/**
 * Re-render a section that contains a form without wiping what the user is
 * typing: the 4 s live refresh skips it while a field is focused or edited.
 * `force` (after a save, or on first load) always renders.
 */
const lastRendered = new WeakMap<HTMLElement, string>();

function renderEditableSection(container: HTMLElement, html: string, wire: () => void, force = false) {
  if (!container.dataset.editTracking) {
    container.dataset.editTracking = "1";
    const markDirty = () => { container.dataset.dirty = "1"; };
    container.addEventListener("input", markDirty);
    container.addEventListener("change", markDirty);
  }
  const active = document.activeElement;
  const editing = active instanceof HTMLElement && container.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
  if (!force && (editing || container.dataset.dirty === "1")) return;
  // Unchanged data: keep the DOM (open menus, revealed PINs, scroll) as it is.
  if (!force && lastRendered.get(container) === html) return;
  lastRendered.set(container, html);
  container.innerHTML = html;
  delete container.dataset.dirty;
  wire();
}

// Live monitor and recording player release resources on close: they handle Escape themselves.
const SELF_CLOSING_DIALOGS = new Set(["live-monitor-modal", "recording-player-modal"]);
let escapeWired = false;
// Pairing requests: which one the dialog shows, and which the admin closed.
let pairModalOpenFor: string | null = null;
const dismissedPairings = new Set<string>();

/**
 * A Moonlight waiting for a PIN opens the pairing dialog by itself (once per
 * device): the admin only types the 4 digits Moonlight shows.
 */
function promptPendingPairings() {
  const pending = multiUser?.pair_pending ?? [];
  const waiting = new Set(pending.map((p) => p.client_ip));
  for (const ip of [...dismissedPairings]) if (!waiting.has(ip)) dismissedPairings.delete(ip);
  const fresh = pending.find((p) => !dismissedPairings.has(p.client_ip));
  if (!fresh || pairModalOpenFor) return;
  const otherDialogOpen = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
    (el) => !el.classList.contains("hidden") && el.getClientRects().length > 0,
  );
  if (otherDialogOpen) return;
  dismissedPairings.add(fresh.client_ip);
  openPairDeviceModal("", fresh.username ?? "", fresh.client_ip);
  showToast(`Moonlight chiede il PIN (${fresh.client_ip})`, "info");
}
let nasModalWired = false;

/** Escape closes the topmost open dialog through its own close button. */
function wireEscapeToClose() {
  if (escapeWired) return;
  escapeWired = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
      (el) => !el.classList.contains("hidden") && el.getClientRects().length > 0,
    );
    const top = open[open.length - 1];
    if (!top || SELF_CLOSING_DIALOGS.has(top.id)) return;
    const close = top.querySelector<HTMLElement>("[data-close], .btn-close-modal, .btn-close-ssh-modal");
    if (close) close.click();
    else top.classList.add("hidden");
  });
}

function showToast(rawMessage: unknown, level: "ok" | "error" | "info" = "info", duration = 4200) {
  const container = document.querySelector<HTMLElement>("#toast-container");
  if (!container) return;
  const message = formatToastMessage(rawMessage);
  const toast = document.createElement("div");
  toast.className = `toast toast-${level}`;
  toast.innerHTML = `
    <span class="text-base shrink-0">${level === "ok" ? "✅" : level === "error" ? "⚠️" : "ℹ️"}</span>
    <span class="text-xs font-medium text-zinc-200">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setBusy(button: HTMLButtonElement, busy: boolean, busyLabel = "Attendi…") {
  // Keep the original markup (icons included) and width so the busy state
  // never overflows compact icon buttons or loses its icon afterwards.
  if (busy) {
    if (button.dataset.busyHtml === undefined) button.dataset.busyHtml = button.innerHTML;
    button.style.minWidth = `${button.offsetWidth}px`;
    const spinner = `<span class="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"></span>`;
    const iconOnly = !(button.textContent ?? "").trim();
    button.innerHTML = iconOnly ? spinner : `${spinner}<span class="truncate">${busyLabel}</span>`;
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
  } else {
    if (button.dataset.busyHtml !== undefined) {
      button.innerHTML = button.dataset.busyHtml;
      delete button.dataset.busyHtml;
    }
    button.style.minWidth = "";
    button.removeAttribute("aria-busy");
    button.disabled = false;
  }
}

function isAdminSession(): boolean {
  return currentSession?.role === "admin" || currentSession?.role === "owner";
}

// Modal management
function openSshModal() {
  const container = document.querySelector<HTMLElement>("#modal-portal");
  if (!container) return;

  container.innerHTML = renderSshNodeModal(availableNodes, activeNode, isAdminSession());

  const modal = document.querySelector<HTMLElement>("#ssh-node-modal");
  const closeBtns = document.querySelectorAll(".btn-close-ssh-modal");
  const testSshBtn = document.querySelector<HTMLButtonElement>("#btn-modal-test-ssh");
  const testApiBtn = document.querySelector<HTMLButtonElement>("#btn-modal-test-api");
  const saveBtn = document.querySelector<HTMLButtonElement>("#btn-modal-save-ssh");
  const form = document.querySelector<HTMLFormElement>("#ssh-credentials-form");
  const togglePwdBtn = document.querySelector<HTMLButtonElement>("#btn-toggle-pwd-visibility");
  const toggleTokBtn = document.querySelector<HTMLButtonElement>("#btn-toggle-token-visibility");
  const pwdInput = document.querySelector<HTMLInputElement>("#modal-node-pwd");
  const tokInput = document.querySelector<HTMLInputElement>("#modal-node-token");
  const feedbackBox = document.querySelector<HTMLElement>("#ssh-test-feedback");

  const closeModal = () => {
    container.innerHTML = "";
  };

  closeBtns.forEach((btn) => btn.addEventListener("click", closeModal));

  if (togglePwdBtn && pwdInput) {
    togglePwdBtn.addEventListener("click", () => {
      pwdInput.type = pwdInput.type === "password" ? "text" : "password";
    });
  }

  if (toggleTokBtn && tokInput) {
    toggleTokBtn.addEventListener("click", () => {
      tokInput.type = tokInput.type === "password" ? "text" : "password";
    });
  }

  // Node selection inside modal
  document.querySelectorAll<HTMLButtonElement>(".btn-select-node-card").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const host = btn.dataset.host;
      const user = btn.dataset.user;
      if (!host) return;
      try {
        await api.switchNode(host, user, undefined, currentSession?.token);
        await loadNodes();
        openSshModal();
        await refreshAll();
      } catch (err) {
        showToast(String(err), "error");
      }
    });
  });

  // Tailscale MagicDNS Dropdown population
  const selectTailscale = document.querySelector<HTMLSelectElement>("#modal-select-tailscale");
  const refreshTailscaleBtn = document.querySelector<HTMLButtonElement>("#btn-refresh-tailscale");
  const tailscaleCountEl = document.querySelector<HTMLElement>("#tailscale-nodes-count");

  const populateTailscaleDropdown = async () => {
    if (!selectTailscale) return;
    selectTailscale.innerHTML = `<option value="">Scansione nodi Tailnet in corso…</option>`;
    try {
      const nodes = await api.getTailscaleNodes();
      if (!nodes || nodes.length === 0) {
        selectTailscale.innerHTML = `<option value="">Nessun nodo rilevato (Tailscale non attivo o nessun peer)</option>`;
        if (tailscaleCountEl) tailscaleCountEl.textContent = "0 nodi";
        return;
      }

      let html = `<option value="">-- Seleziona nodo Tailscale MagicDNS (${nodes.length} disponibili) --</option>`;
      nodes.forEach((n) => {
        const targetHost = n.dns_name || n.ip;
        const statusIcon = n.online ? "🟢" : "⚪";
        html += `<option value="${escapeHtml(targetHost)}" data-host="${escapeHtml(targetHost)}" data-name="${escapeHtml(n.hostname)}" data-ip="${escapeHtml(n.ip)}" data-os="${escapeHtml(n.os)}">
          ${statusIcon} ${escapeHtml(n.hostname)} • ${escapeHtml(targetHost)} (${escapeHtml(n.os)})
        </option>`;
      });
      selectTailscale.innerHTML = html;
      if (tailscaleCountEl) {
        const onlineCount = nodes.filter((n) => n.online).length;
        tailscaleCountEl.textContent = `${onlineCount}/${nodes.length} online`;
      }
    } catch (err) {
      selectTailscale.innerHTML = `<option value="">Tailscale non attivo: ${escapeHtml(String(err))}</option>`;
      if (tailscaleCountEl) tailscaleCountEl.textContent = "offline";
    }
  };

  if (selectTailscale) {
    selectTailscale.addEventListener("change", () => {
      const val = selectTailscale.value;
      if (val) {
        const hostInput = document.querySelector<HTMLInputElement>("#modal-node-host");
        if (hostInput) {
          hostInput.value = val;
          hostInput.dispatchEvent(new Event("input"));
        }
        const newNodeHostInput = document.querySelector<HTMLInputElement>("#new-node-host");
        if (newNodeHostInput && !newNodeHostInput.value) {
          newNodeHostInput.value = val;
        }
        showToast(`Nodo MagicDNS selezionato: ${val}`, "ok");
      }
    });
  }

  if (refreshTailscaleBtn) {
    refreshTailscaleBtn.addEventListener("click", async () => {
      setBusy(refreshTailscaleBtn, true, "Rileva…");
      await populateTailscaleDropdown();
      setBusy(refreshTailscaleBtn, false);
      showToast("Lista nodi Tailscale aggiornata", "ok");
    });
  }

  // Populate Tailscale dropdown immediately
  populateTailscaleDropdown();

  // Test REST API Connection (Zero-SSH)
  if (testApiBtn) {
    testApiBtn.addEventListener("click", async () => {
      const host = (document.querySelector<HTMLInputElement>("#modal-node-host")?.value || "").trim();
      const portRaw = document.querySelector<HTMLInputElement>("#modal-node-port")?.value || "47995";
      const port = parseInt(portRaw, 10) || 47995;
      const apiToken = (document.querySelector<HTMLInputElement>("#modal-node-token")?.value || "").trim();

      if (!host) {
        showToast("Host o IP mancante", "error");
        return;
      }

      setBusy(testApiBtn, true, "Verifica REST API…");
      if (feedbackBox) {
        feedbackBox.className = "rounded-lg p-3 text-xs border bg-zinc-950/80 border-zinc-700 text-zinc-300";
        feedbackBox.innerHTML = `<span>⏳ Connessione a <code>http://${escapeHtml(host)}:${port}</code> in corso…</span>`;
        feedbackBox.classList.remove("hidden");
      }

      try {
        const res = await api.testNodeApi(host, port, apiToken || undefined);
        if (res.ok) {
          if (feedbackBox) {
            feedbackBox.className = "rounded-lg p-3 text-xs border bg-emerald-950/40 border-emerald-500/40 text-emerald-300";
            feedbackBox.innerHTML = `<strong>⚡ ${escapeHtml(res.message)}</strong><div class="text-[11px] text-emerald-400/80 mt-1">Latenza: ${res.latency_ms}ms • Daemon v${escapeHtml(res.version)}</div>`;
          }
          showToast(`REST API Online: ${res.latency_ms}ms`, "ok");
        } else {
          if (feedbackBox) {
            feedbackBox.className = "rounded-lg p-3 text-xs border bg-amber-950/40 border-amber-500/40 text-amber-300";
            feedbackBox.innerHTML = `<strong>⚠️ ${escapeHtml(res.message)}</strong>`;
          }
          showToast(res.message, "error");
        }
      } catch (err) {
        if (feedbackBox) {
          feedbackBox.className = "rounded-lg p-3 text-xs border bg-red-950/40 border-red-500/40 text-red-300";
          feedbackBox.innerHTML = `<strong>❌ Errore connessione daemon:</strong> ${escapeHtml(String(err))}`;
        }
        showToast(String(err), "error");
      } finally {
        setBusy(testApiBtn, false);
      }
    });
  }

  // Test SSH Connection (Fallback)
  if (testSshBtn) {
    testSshBtn.addEventListener("click", async () => {
      const host = (document.querySelector<HTMLInputElement>("#modal-node-host")?.value || "").trim();
      const user = (document.querySelector<HTMLInputElement>("#modal-node-user")?.value || "daubog44").trim();
      const pwd = document.querySelector<HTMLInputElement>("#modal-node-pwd")?.value;

      if (!host) {
        showToast("Host o IP mancante", "error");
        return;
      }

      setBusy(testSshBtn, true, "Verifica SSH…");
      if (feedbackBox) {
        feedbackBox.className = "rounded-lg p-3 text-xs border bg-zinc-950/80 border-zinc-700 text-zinc-300";
        feedbackBox.innerHTML = `<span>⏳ Connessione SSH a <code>${escapeHtml(user)}@${escapeHtml(host)}:22</code> in corso…</span>`;
        feedbackBox.classList.remove("hidden");
      }

      try {
        const res = await api.testSshConnection(host, user, pwd || undefined);
        if (feedbackBox) {
          feedbackBox.className = "rounded-lg p-3 text-xs border bg-emerald-950/40 border-emerald-500/40 text-emerald-300";
          feedbackBox.innerHTML = `<strong>✅ ${escapeHtml(res)}</strong>`;
        }
        showToast(res, "ok");
      } catch (err) {
        if (feedbackBox) {
          feedbackBox.className = "rounded-lg p-3 text-xs border bg-red-950/40 border-red-500/40 text-red-300";
          feedbackBox.innerHTML = `<strong>⚠️ ${escapeHtml(String(err))}</strong>`;
        }
        showToast(String(err), "error");
      } finally {
        setBusy(testSshBtn, false);
      }
    });
  }

  // Gestione interattiva porta streaming Moonlight e rilevamento conflitti LAN per il nodo attivo
  const autoDetectPortBtn = document.querySelector<HTMLButtonElement>("#btn-auto-detect-port");
  const modalNodeHost = document.querySelector<HTMLInputElement>("#modal-node-host");
  const modalNodeStreamPort = document.querySelector<HTMLInputElement>("#modal-node-stream-port");
  const modalNodeDdns = document.querySelector<HTMLInputElement>("#modal-node-ddns");
  const modalPortFeedback = document.querySelector<HTMLElement>("#modal-node-stream-port-feedback");

  const checkActiveNodePortConflict = () => {
    const host = (modalNodeHost?.value || "").trim();
    const port = parseInt(modalNodeStreamPort?.value || "47989", 10) || 47989;
    const ddns = (modalNodeDdns?.value || "").trim();
    if (!modalPortFeedback) return;

    if (!host) {
      modalPortFeedback.innerHTML = `<span class="text-zinc-500">Default: 47989. Se ci sono più nodi sulla stessa LAN, la porta viene calcolata automaticamente senza conflitti.</span>`;
      return;
    }

    const suggestion = computeSuggestedStreamingPort(availableNodes, host, ddns, activeNode?.id);
    if (suggestion.is_conflict && port === 47989) {
      modalPortFeedback.innerHTML = `
        <div class="text-amber-400 font-semibold flex items-center justify-between">
          <span>⚠️ Conflitto LAN: Porta 47989 già occupata da ${escapeHtml(suggestion.conflicting_node || 'un altro nodo')}.</span>
          <button type="button" id="btn-fix-conflict" class="underline text-amber-300 hover:text-white ml-2 text-[10px] cursor-pointer">
            Assegna ${suggestion.port}
          </button>
        </div>
      `;
      document.querySelector("#btn-fix-conflict")?.addEventListener("click", () => {
        if (modalNodeStreamPort) {
          modalNodeStreamPort.value = String(suggestion.port);
          checkActiveNodePortConflict();
        }
      });
    } else if (port !== 47989) {
      modalPortFeedback.innerHTML = `<span class="text-emerald-400 font-medium">⚡ Port Offset :${port} attivo — nessun conflitto di streaming sulla LAN.</span>`;
    } else {
      modalPortFeedback.innerHTML = `<span class="text-zinc-400">✓ Porta standard 47989 disponibile (Nessun conflitto LAN).</span>`;
    }
  };

  if (autoDetectPortBtn) {
    autoDetectPortBtn.addEventListener("click", () => {
      const host = (modalNodeHost?.value || "").trim();
      const ddns = (modalNodeDdns?.value || "").trim();
      const suggestion = computeSuggestedStreamingPort(availableNodes, host, ddns, activeNode?.id);
      if (modalNodeStreamPort) {
        modalNodeStreamPort.value = String(suggestion.port);
        checkActiveNodePortConflict();
      }
      showToast(`Porta assegnata automaticamente: ${suggestion.port}`, suggestion.is_conflict ? "info" : "ok");
    });
  }

  modalNodeHost?.addEventListener("input", checkActiveNodePortConflict);
  modalNodeStreamPort?.addEventListener("input", checkActiveNodePortConflict);
  modalNodeDdns?.addEventListener("input", checkActiveNodePortConflict);
  checkActiveNodePortConflict();

  // Save Credentials & Connect
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nodeId = (document.querySelector<HTMLInputElement>("#modal-node-id")?.value || "omarchy-local").trim();
      const host = (document.querySelector<HTMLInputElement>("#modal-node-host")?.value || "").trim();
      const portRaw = document.querySelector<HTMLInputElement>("#modal-node-port")?.value || "47995";
      const apiPort = parseInt(portRaw, 10) || 47995;
      const apiToken = (document.querySelector<HTMLInputElement>("#modal-node-token")?.value || "").trim();
      const user = (document.querySelector<HTMLInputElement>("#modal-node-user")?.value || "daubog44").trim();
      const pwd = document.querySelector<HTMLInputElement>("#modal-node-pwd")?.value;
      const streamPortRaw = document.querySelector<HTMLInputElement>("#modal-node-stream-port")?.value || "47989";
      const streamPort = parseInt(streamPortRaw, 10) || 47989;
      const rawDdns = (document.querySelector<HTMLInputElement>("#modal-node-ddns")?.value || "").trim();
      const ddnsDomain = rawDdns ? normalizeDdnsDomain(rawDdns) : "";

      if (!host) {
        showToast("Host non valido", "error");
        return;
      }

      if (saveBtn) setBusy(saveBtn, true, "Salvataggio…");

      try {
        await api.saveNodeCredentials(
          nodeId,
          host,
          user,
          pwd || undefined,
          apiPort,
          apiToken || undefined,
          currentSession?.token,
          streamPort,
          ddnsDomain || undefined,
        );
        showToast("Configurazione del nodo salvata e connessione attivata!", "ok");
        closeModal();
        await loadNodes();
        await refreshAll();
      } catch (err) {
        showToast(`Errore salvataggio: ${String(err)}`, "error");
      } finally {
        if (saveBtn) setBusy(saveBtn, false);
      }
    });
  }

  // Add cluster node form con calcolo automatico della porta
  const addClusterForm = document.querySelector<HTMLFormElement>("#form-add-cluster-node");
  if (addClusterForm) {
    const newNodeHost = document.querySelector<HTMLInputElement>("#new-node-host");
    const newNodeStreamPort = document.querySelector<HTMLInputElement>("#new-node-stream-port");
    const newNodeDdns = document.querySelector<HTMLInputElement>("#new-node-ddns");
    const newNodeFeedback = document.querySelector<HTMLElement>("#new-node-port-feedback");
    const newNodeFeedbackText = document.querySelector<HTMLElement>("#new-node-port-feedback-text");
    const newNodeFeedbackIcon = document.querySelector<HTMLElement>("#new-node-port-feedback-icon");

    let isNewPortManual = false;
    if (newNodeStreamPort) {
      newNodeStreamPort.addEventListener("input", () => {
        isNewPortManual = (newNodeStreamPort.value.trim().length > 0);
      });
    }

    const updateNewNodePortSuggestion = () => {
      const host = (newNodeHost?.value || "").trim();
      const ddns = (newNodeDdns?.value || "").trim();
      if (!host) {
        if (newNodeStreamPort && !isNewPortManual) newNodeStreamPort.value = "";
        if (newNodeFeedbackText) newNodeFeedbackText.textContent = "La porta viene calcolata automaticamente verificando i nodi sulla stessa LAN.";
        if (newNodeFeedbackIcon) newNodeFeedbackIcon.textContent = "⚡";
        if (newNodeFeedback) newNodeFeedback.className = "text-[10px] py-1 px-2 rounded bg-zinc-900/80 border border-zinc-800 text-zinc-400 font-mono flex items-center gap-1.5";
        return;
      }

      const suggestion = computeSuggestedStreamingPort(availableNodes, host, ddns, null);
      if (newNodeStreamPort && !isNewPortManual) {
        newNodeStreamPort.value = String(suggestion.port);
      }

      if (newNodeFeedback && newNodeFeedbackText && newNodeFeedbackIcon) {
        if (suggestion.is_conflict) {
          newNodeFeedbackIcon.textContent = "⚡";
          newNodeFeedbackText.innerHTML = `<strong class="text-amber-400">Auto-assegnata porta ${suggestion.port}</strong>: rilevato nodo sulla stessa LAN (${escapeHtml(suggestion.conflicting_node || '')} con porta 47989).`;
          newNodeFeedback.className = "text-[10px] py-1 px-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 font-mono flex items-center gap-1.5";
        } else {
          newNodeFeedbackIcon.textContent = "✓";
          newNodeFeedbackText.innerHTML = `<strong class="text-emerald-400">Porta standard ${suggestion.port} disponibile</strong>: nessun conflitto rilevato sulla LAN.`;
          newNodeFeedback.className = "text-[10px] py-1 px-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 font-mono flex items-center gap-1.5";
        }
      }
    };

    newNodeHost?.addEventListener("input", updateNewNodePortSuggestion);
    newNodeDdns?.addEventListener("input", updateNewNodePortSuggestion);

    addClusterForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = (document.querySelector<HTMLInputElement>("#new-node-name")?.value || "").trim();
      const host = (document.querySelector<HTMLInputElement>("#new-node-host")?.value || "").trim();
      const user = (document.querySelector<HTMLInputElement>("#new-node-user")?.value || "daubog44").trim();
      const pwd = document.querySelector<HTMLInputElement>("#new-node-pwd")?.value;
      const streamPortRaw = document.querySelector<HTMLInputElement>("#new-node-stream-port")?.value || "";
      const streamPort = streamPortRaw ? parseInt(streamPortRaw, 10) : undefined;
      const rawNewDdns = (document.querySelector<HTMLInputElement>("#new-node-ddns")?.value || "").trim();
      const ddnsDomain = rawNewDdns ? normalizeDdnsDomain(rawNewDdns) : "";

      if (!host) return;

      try {
        await api.addNodeEntry(
          name || host,
          host,
          user,
          pwd || undefined,
          ["*"],
          currentSession?.token,
          streamPort,
          ddnsDomain || undefined,
        );
        showToast("Nuovo server aggiunto con successo!", "ok");
        await loadNodes();
        openSshModal();
      } catch (err) {
        showToast(`Errore: ${String(err)}`, "error");
      }
    });
  }
}

async function loadNodes() {
  try {
    availableNodes = await api.listNodes(currentSession?.token);
    activeNode = availableNodes.find((n) => n.is_active) || availableNodes[0] || null;
    updateTopNodeUI();
  } catch {
    // ignore
  }
}

function updateTopNodeUI() {
  const nodeLabel = document.querySelector<HTMLElement>("#current-node-label");
  const nodeDot = document.querySelector<HTMLElement>("#topbar-node-dot");
  const sshPromptBtn = document.querySelector<HTMLElement>("#btn-topbar-ssh-prompt");

  const host = activeNode?.host || dashboard?.config.vm_host || "omarchy.local";
  if (nodeLabel) {
    nodeLabel.textContent = host;
  }

  const isConnected = multiUser?.telemetry?.available ?? false;
  if (nodeDot) {
    if (isConnected) {
      nodeDot.className = "w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]";
    } else {
      nodeDot.className = "w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]";
    }
  }

  if (sshPromptBtn) {
    if (isConnected) {
      sshPromptBtn.classList.add("hidden");
    } else {
      sshPromptBtn.classList.remove("hidden");
    }
  }
}

async function launchMoonlight() {
  const btn = document.querySelector<HTMLButtonElement>("#moonlight");
  if (btn) setBusy(btn, true, "Avvio…");
  try {
    const res = await api.launchMoonlight();
    showToast(res, "ok");
  } catch (err) {
    showToast(`Errore avvio Moonlight: ${String(err)}`, "error");
  } finally {
    if (btn) setBusy(btn, false);
  }
}

async function loadDisplays() {
  try {
    displays = await api.listDisplays();
    const select = document.querySelector<HTMLSelectElement>("#gaming-display");
    if (!select) return;
    select.innerHTML = displays
      .map((d) => `<option value="${d.index}">${escapeHtml(d.name)} (${d.width}x${d.height})</option>`)
      .join("");
    updateGamingSummary();
  } catch {
    // ignore
  }
}

function updateGamingSummary() {
  const select = document.querySelector<HTMLSelectElement>("#gaming-display");
  const summary = document.querySelector<HTMLElement>("#gaming-summary");
  if (!select || !summary || displays.length === 0) return;
  const display = displays[Number(select.value)] || displays[0];
  const mode = (document.querySelector<HTMLInputElement>('input[name="gaming-quality"]:checked')?.value) || "performance";

  let targetRes = "1920x1080";
  let targetFps = "60 FPS";
  let targetBitrate = "25 Mbps";

  if (mode === "native") {
    targetRes = `${display.width}x${display.height}`;
    targetFps = "60 FPS";
    targetBitrate = display.width > 2000 ? "40 Mbps" : "30 Mbps";
  }

  summary.innerHTML = `
    <div class="kv"><span>Risoluzione</span><span>${targetRes}</span></div>
    <div class="kv"><span>Frame rate</span><span>${targetFps}</span></div>
    <div class="kv"><span>Bitrate</span><span>${targetBitrate}</span></div>
    <div class="kv"><span>Codec</span><span>H.265</span></div>
    <div class="kv"><span>Schermo</span><span>${escapeHtml(display.name)}</span></div>
  `;
}

async function configureGaming() {
  const select = document.querySelector<HTMLSelectElement>("#gaming-display");
  const btn = document.querySelector<HTMLButtonElement>("#configure-gaming");
  if (!select) return;
  const displayIndex = Number(select.value);
  const mode = (document.querySelector<HTMLInputElement>('input[name="gaming-quality"]:checked')?.value) || "performance";

  if (btn) setBusy(btn, true, "Applicazione…");
  try {
    const res = await api.configureMoonlightGaming(displayIndex, mode);
    showToast(res, "ok");
  } catch (err) {
    showToast(String(err), "error");
  } finally {
    if (btn) setBusy(btn, false);
  }
}

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;

  const refreshBtn = document.querySelector<HTMLButtonElement>("#refresh");
  if (refreshBtn) refreshBtn.classList.add("animate-spin");

  try {
    const [dash, mu] = await Promise.all([
      api.inspectSetup().catch(() => null),
      api.getMultiUserDashboard(true).catch(() => null),
    ]);

    if (dash) dashboard = dash;
    if (mu) multiUser = mu;

    renderDashboardData();
  } catch (err) {
    showToast(`Errore aggiornamento dati: ${String(err)}`, "error");
  } finally {
    refreshing = false;
    if (refreshBtn) refreshBtn.classList.remove("animate-spin");
  }
}

async function refreshMultiUserOnly() {
  try {
    multiUser = await api.getMultiUserDashboard(true);
    renderDashboardData();
  } catch {
    // ignore
  }
}

function renderDashboardData() {
  if (!multiUser) return;
  promptPendingPairings();

  updateTopNodeUI();

  // Sessions count badge
  const sessCount = document.querySelector<HTMLElement>("#active-sessions-count");
  if (sessCount) sessCount.textContent = String(multiUser.active_sessions_count);

  // Users count badge
  const usersCount = document.querySelector<HTMLElement>("#registered-users-count");
  if (usersCount) usersCount.textContent = String(multiUser.registered_users_count);

  // Telemetry
  const telContainer = document.querySelector<HTMLElement>("#telemetry-container");
  if (telContainer) {
    telContainer.innerHTML = renderTelemetryWidget(
      multiUser.telemetry,
      multiUser.wolf_online,
      multiUser.storage,
    );
    const openSshPromptBtn = document.querySelector<HTMLButtonElement>("#btn-open-ssh-prompt");
    if (openSshPromptBtn) {
      openSshPromptBtn.addEventListener("click", openSshModal);
    }
  }

  // Sessions list
  const sessContainer = document.querySelector<HTMLElement>("#sessions-container");
  if (sessContainer && pendingSessionActions === 0) {
    sessContainer.innerHTML = renderSessionsList(multiUser.sessions || []);
    wireSessionActions();
  }

  // Users list
  const usersContainer = document.querySelector<HTMLElement>("#users-container");
  if (usersContainer) {
    renderEditableSection(usersContainer, renderUsersList(multiUser.users, isAdminSession()), wireUserActions);
  }

  // Enterprise tab
  const enterpriseContainer = document.querySelector<HTMLElement>("#enterprise-container");
  if (enterpriseContainer) {
    enterpriseSettings = multiUser.settings ?? enterpriseSettings;
    savegamesList = multiUser.savegames ?? savegamesList;
    vpnPeersList = multiUser.vpn_peers ?? vpnPeersList;
    renderEditableSection(
      enterpriseContainer,
      renderEnterpriseDashboard(multiUser, enterpriseSettings, vpnPeersList, savegamesList, multiUser.users, ddnsStatusInfo),
      wireEnterpriseActions,
    );
  }

  // Diagnostics & Requirements tab
  const depContainer = document.querySelector<HTMLElement>("#dependencies");
  if (depContainer && dashboard) {
    let depHtml = "";
    if (dashboard.dependencies && dashboard.dependencies.length > 0) {
      depHtml = dashboard.dependencies.map((d) => {
        const isOk = d.state === "ready";
        const badgeColor = isOk ? "!text-emerald-400" : "!text-amber-400";
        return `
          <div class="kv" title="${escapeHtml(d.detail || "")}"><span>${escapeHtml(d.name)}</span><span class="${badgeColor}">${escapeHtml(labelFor(d.state))}</span></div>
        `;
      }).join("");
    } else {
      const checkItems = [
        { name: "Moonlight", check: dashboard.checks?.moonlight },
        { name: "SSH", check: dashboard.checks?.ssh },
        { name: "Ricevitore Sunshine", check: dashboard.checks?.guest_receiver },
        { name: "Configurazione host", check: dashboard.checks?.setup },
      ];
      depHtml = checkItems.map((item) => {
        const isOk = item.check?.state === "ready";
        const badgeColor = isOk ? "!text-emerald-400" : "!text-amber-400";
        return `
          <div class="kv" title="${escapeHtml(item.check?.detail || "")}"><span>${escapeHtml(item.name)}</span><span class="${badgeColor}">${escapeHtml(labelFor(item.check?.state || "unknown"))}</span></div>
        `;
      }).join("");
    }
    depContainer.innerHTML = depHtml;
  }
}

let closeActiveMonitor: (() => void) | null = null;
// While a session action is in flight the 4s auto-refresh must not re-render
// the list, otherwise the busy button is replaced and can be clicked again.
let pendingSessionActions = 0;

function brokerMessage(raw: string, fallback: string): { ok: boolean; message: string } {
  try {
    const data = JSON.parse(raw) as { status?: string; message?: string };
    return { ok: data.status !== "error" && data.status !== "not_found", message: data.message || fallback };
  } catch {
    return { ok: true, message: raw.trim() || fallback };
  }
}

/** Native window fullscreen also works in WKWebView, with the toolbar still available. */
function wireMediaFullscreen(modal: HTMLElement): () => void {
  const button = modal.querySelector<HTMLButtonElement>("[data-media-fullscreen]");
  const appWindow = getCurrentWindow();
  let previousFullscreen = false;
  let closed = false;
  let changing = false;
  const toggle = async () => {
    if (closed || changing || !button) return;
    changing = true;
    button.disabled = true;
    const enter = !modal.classList.contains("media-fullscreen");
    try {
      if (enter) previousFullscreen = await appWindow.isFullscreen();
      if (closed) return;
      await appWindow.setFullscreen(enter || previousFullscreen);
      if (closed) {
        await appWindow.setFullscreen(previousFullscreen);
        return;
      }
      modal.classList.toggle("media-fullscreen", enter);
      button.textContent = enter ? "Riduci" : "Schermo intero";
      button.setAttribute("aria-pressed", String(enter));
    } catch (err) {
      showToast(`Schermo intero non disponibile: ${err}`, "error");
    } finally {
      changing = false;
      button.disabled = false;
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (modal.dataset.controlling === "true") return;
    if (event.key !== "Escape" || !modal.classList.contains("media-fullscreen")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle();
  };
  button?.addEventListener("click", toggle);
  document.addEventListener("keydown", onKey, true);
  return () => {
    closed = true;
    button?.removeEventListener("click", toggle);
    document.removeEventListener("keydown", onKey, true);
    if (modal.classList.contains("media-fullscreen")) {
      void appWindow.setFullscreen(previousFullscreen).catch((err) => console.debug("Restore fullscreen:", err));
    }
  };
}

function openLiveMonitorModal(session: {
  sessionId: string;
  username: string;
  appName: string;
  resolution: string;
  fps: number;
  bitrateMbps: number;
  vramMb: number;
  isRecording: boolean;
}, quality = "original") {
  const portal = document.querySelector<HTMLElement>("#modal-portal");
  if (!portal) return;

  closeActiveMonitor?.();
  portal.innerHTML = renderLiveMonitorModal(session);

  const modal = portal.querySelector<HTMLElement>("#live-monitor-modal");
  const closeBtn = portal.querySelector<HTMLButtonElement>("#close-live-monitor");
  const screenImg = portal.querySelector<HTMLImageElement>("#live-monitor-screen");
  const videoEl = portal.querySelector<HTMLVideoElement>("#live-monitor-video");
  const spinner = portal.querySelector<HTMLElement>("#live-monitor-spinner");
  const errorBox = portal.querySelector<HTMLElement>("#live-monitor-error");
  const errorText = portal.querySelector<HTMLElement>("#live-monitor-error-text");
  const dot = portal.querySelector<HTMLElement>("#live-monitor-dot");
  const ageLabel = portal.querySelector<HTMLElement>("#live-monitor-age");
  const toggleRecBtn = portal.querySelector<HTMLButtonElement>("#btn-monitor-toggle-rec");
  const recBadge = portal.querySelector<HTMLElement>("#monitor-rec-badge");
  const takeoverBtn = portal.querySelector<HTMLButtonElement>("#btn-monitor-moonlight");
  const releaseInput = modal && currentSession ? wireRemoteInput(modal, session.sessionId, currentSession.token, m => showToast(m, "error")) : () => undefined;
  const qualitySelect = portal.querySelector<HTMLSelectElement>("#live-quality");
  if (qualitySelect) {
    qualitySelect.value = quality;
    qualitySelect.onchange = () => { const selected = qualitySelect.value; cleanup(); openLiveMonitorModal(session, selected); };
  }
  const restoreFullscreen = modal ? wireMediaFullscreen(modal) : () => undefined;

  let closed = false;
  let failures = 0;
  let lastFrameAt = 0;
  let videoLive = false;
  let player: LiveVideoPlayer | null = null;
  let activeMonitorTimer: number | null = null;
  let retryTimer: number | null = null;
  let watchdog: number | null = null;
  let rtc: WebRtcSession | null = null;
  let attemptAbort: AbortController | null = null;
  let viewerId = "";
  let generation = 0;
  let retryCount = 0;
  let useFmp4 = false;
  const mediaReady = (ready: boolean) => {
    if (modal) modal.dataset.videoReady = String(ready);
    const viewport = modal?.querySelector<HTMLElement>("[data-fullscreen-viewport]");
    if (viewport) {
      viewport.dataset.remoteCursor = String(ready && !videoEl?.classList.contains("hidden"));
      viewport.dispatchEvent(new Event("remote-media-state"));
    }
  };
  const stopAttempt = () => {
    generation += 1;
    mediaReady(false);
    attemptAbort?.abort();
    attemptAbort = null;
    rtc?.close(); rtc = null;
    player?.destroy(); player = null;
    if (viewerId) void api.stopLiveVideo(viewerId).catch(() => undefined);
    viewerId = "";
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && modal?.dataset.controlling !== "true") cleanup();
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    releaseInput();
    restoreFullscreen();
    closeActiveMonitor = null;
    if (activeMonitorTimer) {
      clearTimeout(activeMonitorTimer);
      activeMonitorTimer = null;
    }
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("beforeunload", cleanup);
    if (infoTimer) clearInterval(infoTimer);
    if (retryTimer) clearTimeout(retryTimer);
    stopAttempt();
    api.stopSessionStream(session.sessionId).catch((err) => {
      console.debug("stopSessionStream error:", err);
    });
    portal.innerHTML = "";
    void refreshMultiUserOnly();
  };
  closeActiveMonitor = cleanup;

  closeBtn?.addEventListener("click", cleanup);
  document.addEventListener("keydown", onKey);
  // Closing/reloading the app with the monitor open releases the stream too.
  window.addEventListener("beforeunload", cleanup);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) cleanup();
  });

  // Marks the session as watched on the host (silent: no Hyprland notification).
  api.spectateUserSession(session.sessionId).catch((err) => {
    console.warn("Spectate error:", err);
  });

  const showError = (message: string) => {
    spinner?.classList.add("hidden");
    if (!snapshotsAvailable || !lastFrameAt) {
      errorBox?.classList.remove("hidden");
      errorBox?.classList.add("flex");
      if (errorText) errorText.textContent = message;
    }
    dot?.classList.replace("bg-emerald-400", "bg-amber-400");
    dot?.classList.replace("bg-zinc-500", "bg-amber-400");
  };

  // Snapshot polling: the next request starts only after the previous one
  // finished, so a slow host never piles up concurrent grim captures. It
  // pauses while the live video is playing.
  // grim snapshots show the host desktop: never valid for a Wolf container.
  const snapshotsAvailable = !session.sessionId.startsWith("wolf-");
  const pollFrame = async () => {
    if (closed || !snapshotsAvailable) return;
    if (videoLive) {
      activeMonitorTimer = window.setTimeout(pollFrame, 1000);
      return;
    }
    const started = performance.now();
    try {
      const dataUri = await api.captureSessionFrame(session.sessionId);
      if (closed || !screenImg || videoLive) return;
      screenImg.src = dataUri;
      screenImg.classList.remove("hidden");
      mediaReady(true);
      spinner?.classList.add("hidden");
      errorBox?.classList.add("hidden");
      errorBox?.classList.remove("flex");
      dot?.classList.replace("bg-zinc-500", "bg-emerald-400");
      dot?.classList.replace("bg-amber-400", "bg-emerald-400");
      failures = 0;
      lastFrameAt = Date.now();
      if (ageLabel) ageLabel.textContent = `aggiornata ${new Date(lastFrameAt).toLocaleTimeString()}`;
    } catch (err) {
      if (closed || videoLive) return;
      failures += 1;
      mediaReady(false);
      console.debug("Live monitor frame capture error:", err);
      showError(String(err));
      if (ageLabel && lastFrameAt) ageLabel.textContent = "connessione instabile, riprovo…";
    } finally {
      if (!closed) {
        const elapsed = performance.now() - started;
        const interval = failures > 0 ? Math.min(5000, 1000 * failures) : 700;
        activeMonitorTimer = window.setTimeout(pollFrame, Math.max(0, interval - elapsed));
      }
    }
  };
  void pollFrame();

  let transport = "";
  const pipelineBox = portal.querySelector<HTMLElement>("#live-monitor-pipeline");
  let fallbackWarned = false;
  let infoTimer: number | null = null;

  // Checks what really runs end to end and surfaces fallbacks only.
  const refreshPipelineInfo = async () => {
    if (closed || !pipelineBox) return;
    try {
      const info = await api.liveInfo(session.sessionId, quality);
      if (closed) return;
      const codec = (info.codec || "").toUpperCase();
      const transcoded = (info.encode || "").startsWith("transcode");
      const badges = [
        transport === "WebRTC"
          ? { label: "WebRTC", ok: true, title: "Trasporto principale a bassa latenza" }
          : { label: "fMP4 (fallback)", ok: false, title: "WebRTC non raggiungibile: porta 8189 UDP/TCP bloccata?" },
        info.capture === "gpu-screen-recorder"
          ? { label: "Cattura GPU", ok: true, title: "gpu-screen-recorder: dmabuf → shader → NVENC" }
          : info.capture === "wolf-tap"
            ? { label: "Stream Wolf", ok: true, title: "Copia dello stream NVENC di Wolf, nessuna ricodifica" }
            : info.capture === "wf-recorder"
              ? { label: "wf-recorder (fallback)", ok: false, title: "gpu-screen-recorder non disponibile: frame copiati via CPU, conversione colore e codifica in NVENC" }
              : { label: "Cattura ?", ok: false, title: "Stato del publisher non disponibile" },
        codec === "H265" && !transcoded
          ? { label: "H.265", ok: true, title: "Codifica NVENC H.265, copiata senza ricodifica" }
          : codec === "H265" && quality === "low"
            ? { label: "Leggera · NVENC", ok: true, title: "Video ridotto e ricodificato per la visione remota" }
          : codec === "H265"
            ? { label: `H.265 (convertito da ${(info.encode || "").split(" ")[1]?.split("->")[0]?.toUpperCase() || "?"})`, ok: false, title: "Il Moonlight dell'ospite usa H.264: convertito in H.265 con NVENC" }
            : { label: codec || "Codec ?", ok: false, title: "Lo stream non è H.265" },
      ];
      // Nothing is shown when the full-quality path runs: only fallbacks.
      const fallbacks = badges.filter((b) => !b.ok);
      pipelineBox.innerHTML = renderPipelineBadges(fallbacks);
      const bad = fallbacks.map((b) => b.label);
      if (bad.length && !fallbackWarned && quality === "original") {
        fallbackWarned = true;
        showToast(`Video live in fallback: ${bad.join(", ")}`, "info");
      }
    } catch (err) {
      console.debug("liveInfo:", err);
    }
  };

  const videoFailed = (message: string) => {
    if (closed || retryTimer) return;
    console.warn("Live video:", message);
    stopAttempt();
    videoLive = false;
    videoEl?.classList.add("hidden");
    if (snapshotsAvailable && lastFrameAt) screenImg?.classList.remove("hidden");
    showError(`Riconnessione automatica… ${message}`);
    if (ageLabel) ageLabel.textContent = "connessione interrotta, riprovo…";
    retryTimer = window.setTimeout(() => { retryTimer = null; startVideo(); }, Math.min(5000, 1000 * 2 ** Math.min(retryCount++, 3)));
  };

  const startVideo = () => {
    if (closed || !videoEl) return;
    stopAttempt();
    const attempt = generation;
    const abort = new AbortController();
    attemptAbort = abort;
    const current = () => !closed && attempt === generation;
    let lastTime = videoEl.currentTime;
    let progressed = Date.now();
    watchdog = window.setInterval(() => {
      if (!current() || document.hidden) { progressed = Date.now(); return; }
      if (videoEl.currentTime !== lastTime) { lastTime = videoEl.currentTime; progressed = Date.now(); }
      if (Date.now() - progressed > (videoLive ? 8000 : 35000)) videoFailed("il video non riceve nuovi fotogrammi");
    }, 1000);

    const startFmp4 = (reason: string) => {
      if (!current() || viewerId) return;
      console.debug("Uso fMP4:", reason);
      useFmp4 = true;
      transport = "fMP4";
      videoEl.srcObject = null;
      const id = crypto.randomUUID();
      viewerId = id;
      const attemptPlayer = createLiveVideoPlayer(videoEl, message => queueMicrotask(() => { if (current()) videoFailed(message); }));
      player = attemptPlayer;
      api.startLiveVideo(session.sessionId, id, (msg) => {
        if (!current()) return;
        if (msg instanceof ArrayBuffer) attemptPlayer.push(msg);
        else if (msg.event === "end") videoFailed(msg.error || "flusso terminato dall'host");
      }, quality).then(() => {
        // Closing while start is in flight must cancel this reader, never its replacement.
        if (!current()) void api.stopLiveVideo(id).catch(() => undefined);
      }).catch((err) => { if (current()) videoFailed(String(err)); });
    };
    if (useFmp4) { startFmp4("riconnessione"); return; }
    transport = "WebRTC";
    startWebRtcVideo(videoEl,
      sdp => api.whepOffer(session.sessionId, sdp, quality),
      resource => void api.whepClose(session.sessionId, resource).catch(() => undefined),
      reason => { if (current()) { useFmp4 = true; videoFailed(reason); } }, abort.signal,
    ).then(s => { if (current()) rtc = s; else s.close(); })
      .catch(err => { if (current()) startFmp4(String(err)); });
  };

  if (videoEl) {
    videoEl.addEventListener("playing", () => {
      if (closed) return;
      videoLive = true;
      retryCount = 0;
      videoEl.classList.remove("hidden");
      mediaReady(true);
      screenImg?.classList.add("hidden");
      spinner?.classList.add("hidden");
      errorBox?.classList.add("hidden");
      errorBox?.classList.remove("flex");
      dot?.classList.replace("bg-zinc-500", "bg-emerald-400");
      dot?.classList.replace("bg-amber-400", "bg-emerald-400");
      if (ageLabel) ageLabel.textContent = "video live";
      void refreshPipelineInfo();
      if (!infoTimer) infoTimer = window.setInterval(() => void refreshPipelineInfo(), 5000);
    });
    videoEl.addEventListener("error", () => videoFailed(videoEl.error?.message || "errore di riproduzione"));
    startVideo();
  }

  let currentRecording = session.isRecording;
  toggleRecBtn?.addEventListener("click", async () => {
    if (!toggleRecBtn) return;
    try {
      setBusy(toggleRecBtn, true, currentRecording ? "Fermo…" : "Avvio…");
      const raw = currentRecording
        ? await api.stopSessionRecording(session.sessionId)
        : await api.startSessionRecording(session.sessionId);
      const res = brokerMessage(raw, currentRecording ? "Registrazione fermata" : "Registrazione avviata");
      if (!res.ok) throw new Error(res.message);
      currentRecording = !currentRecording;
      session.isRecording = currentRecording;
      void refreshMultiUserOnly();
      setBusy(toggleRecBtn, false);
      recBadge?.classList.toggle("hidden", !currentRecording);
      recBadge?.classList.toggle("inline-flex", currentRecording);
      const label = toggleRecBtn.querySelector("#btn-monitor-rec-text");
      if (label) label.textContent = currentRecording ? "Ferma Rec" : "Registra";
      showToast(res.message, "ok");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setBusy(toggleRecBtn, false);
    }
  });

  takeoverBtn?.addEventListener("click", async () => {
    cleanup();
    try {
      const res = brokerMessage(await api.takeoverUserSession(session.sessionId, currentSession!.token), "Controllo affiancato");
      if (!res.ok) throw new Error(res.message);
      showToast(res.message, "ok");
      await refreshMultiUserOnly();
    } catch (err) {
      showToast(String(err), "error");
    }
  });
}

let recordingsList: RecordingItem[] | null = null;
let recordingsError: string | null = null;
let recordingsFilter = "";

function renderRecordingsTab() {
  const container = document.querySelector<HTMLElement>("#recordings-container");
  if (!container) return;
  container.innerHTML = renderRecordingsView(recordingsList, multiUser?.users ?? [], recordingsFilter, recordingsError);

  container.querySelector<HTMLSelectElement>("#recordings-filter")?.addEventListener("change", (e) => {
    recordingsFilter = (e.target as HTMLSelectElement).value;
    renderRecordingsTab();
  });
  container.querySelector("#recordings-refresh")?.addEventListener("click", () => void loadRecordings());
  container.querySelectorAll<HTMLButtonElement>(".btn-play-recording").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = recordingsList?.find((r) => r.id === btn.dataset.id);
      if (item) openRecordingPlayer(item);
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".btn-delete-recording").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id || !(await confirmDialog(`Eliminare ${btn.dataset.file ?? "la registrazione"}?`))) return;
      try {
        setBusy(btn, true);
        const res = brokerMessage(await api.deleteRecording(id, currentSession?.token), "Registrazione eliminata");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
        recordingsList = (recordingsList ?? []).filter((r) => r.id !== id);
        renderRecordingsTab();
      } catch (err) {
        showToast(String(err), "error");
        setBusy(btn, false);
      }
    });
  });
}

async function loadRecordings() {
  recordingsError = null;
  if (recordingsList === null) renderRecordingsTab();
  try {
    recordingsList = await api.listRecordings();
  } catch (err) {
    recordingsError = `Impossibile leggere le registrazioni: ${String(err)}`;
  }
  renderRecordingsTab();
}

function openRecordingPlayer(item: RecordingItem) {
  const portal = document.querySelector<HTMLElement>("#modal-portal");
  if (!portal) return;
  const owner = multiUser?.users.find((u) => u.username === item.username)?.display_name ?? item.username ?? "sconosciuto";
  portal.innerHTML = renderRecordingPlayerModal(item, owner);
  const video = portal.querySelector<HTMLVideoElement>("#recording-video");
  const errorBox = portal.querySelector<HTMLElement>("#recording-player-error");
  const modal = portal.querySelector<HTMLElement>("#recording-player-modal");
  const restoreFullscreen = modal ? wireMediaFullscreen(modal) : () => undefined;
  const close = () => {
    restoreFullscreen();
    void api.cancelRecordingDownload(item.id).catch(() => undefined);
    // Stop the Range requests to the server before dropping the element.
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    document.removeEventListener("keydown", onKey);
    portal.innerHTML = "";
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  portal.querySelector("#close-recording-player")?.addEventListener("click", close);
  portal.querySelector("#recording-player-modal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) close();
  });
  video?.addEventListener("error", () => {
    if (errorBox) {
      errorBox.textContent = "Impossibile riprodurre la registrazione (file danneggiato o broker non raggiungibile).";
      errorBox.classList.remove("hidden");
    }
  });

  // Download to ~/Downloads through the backend (token in the header, progress, cancel).
  const dlBtn = portal.querySelector<HTMLButtonElement>("#btn-download-recording");
  const dlStatus = portal.querySelector<HTMLElement>("#recording-download-status");
  const dlBar = portal.querySelector<HTMLElement>("#recording-download-bar");
  const dlFill = portal.querySelector<HTMLElement>("#recording-download-fill");
  const revealBtn = portal.querySelector<HTMLButtonElement>("#btn-reveal-download");
  let downloading = false;
  let savedPath = "";
  const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  dlBtn?.addEventListener("click", async () => {
    if (downloading) {
      void api.cancelRecordingDownload(item.id);
      return;
    }
    downloading = true;
    dlBtn.innerHTML = "<span>Annulla</span>";
    revealBtn?.classList.add("hidden");
    dlBar?.classList.remove("hidden");
    if (dlStatus) dlStatus.textContent = "avvio…";
    try {
      savedPath = await api.downloadRecording(item.id, item.file, item.username, (received, total) => {
        const pct = total ? Math.min(100, (received / total) * 100) : 0;
        if (dlFill) dlFill.style.width = `${pct}%`;
        if (dlStatus) dlStatus.textContent = total ? `${pct.toFixed(0)}% · ${mb(received)}/${mb(total)}` : mb(received);
      });
      if (dlStatus) dlStatus.textContent = "salvato in Download";
      if (dlFill) dlFill.style.width = "100%";
      revealBtn?.classList.remove("hidden");
      showToast(`Registrazione salvata: ${savedPath.split(/[\\/]/).pop()}`, "ok");
    } catch (err) {
      const message = String(err).replace(/^Error:\s*/i, "");
      if (dlStatus) dlStatus.textContent = message === "Download annullato" ? "annullato" : "errore";
      dlBar?.classList.add("hidden");
      if (message !== "Download annullato") showToast(message, "error");
    } finally {
      downloading = false;
      dlBtn.innerHTML = `${Icons.download("w-3.5 h-3.5")} <span>Scarica</span>`;
    }
  });
  revealBtn?.addEventListener("click", () => {
    if (savedPath) void api.revealInFileManager(savedPath).catch((err) => showToast(String(err), "error"));
  });
}

function wireSessionActions() {
  document.querySelectorAll<HTMLButtonElement>(".btn-spectate").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (!id) return;
      openLiveMonitorModal({
        sessionId: id,
        username: btn.dataset.user || "Utente",
        appName: btn.dataset.app || "Desktop",
        resolution: btn.dataset.res || "1920x1080",
        fps: parseInt(btn.dataset.fps || "60", 10),
        bitrateMbps: parseInt(btn.dataset.bitrate || "20", 10),
        vramMb: parseInt(btn.dataset.vram || "0", 10),
        isRecording: btn.dataset.rec === "1",
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-takeover").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      pendingSessionActions += 1;
      try {
        setBusy(btn, true, "Affianco…");
        // Wolf sessions join the guest's shared lobby: the broker explains why
        // when that is not possible (no lobby, PIN, no Moonlight session).
        const res = brokerMessage(await api.takeoverUserSession(id, currentSession!.token), "Controllo affiancato");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        pendingSessionActions -= 1;
        setBusy(btn, false);
        await refreshMultiUserOnly();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-kick").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      pendingSessionActions += 1;
      try {
        setBusy(btn, true);
        showToast(`Disconnessione di ${btn.dataset.user || "sessione"} in corso…`, "info");
        const res = brokerMessage(await api.killUserSession(id), "Sessione terminata");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        pendingSessionActions -= 1;
        setBusy(btn, false);
        await refreshMultiUserOnly();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-rec-start").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      pendingSessionActions += 1;
      try {
        setBusy(btn, true);
        const res = brokerMessage(await api.startSessionRecording(id), "Registrazione avviata");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        pendingSessionActions -= 1;
        setBusy(btn, false);
        await refreshMultiUserOnly();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-rec-stop").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      pendingSessionActions += 1;
      try {
        setBusy(btn, true);
        const res = brokerMessage(await api.stopSessionRecording(id), "Registrazione fermata");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        pendingSessionActions -= 1;
        setBusy(btn, false);
        await refreshMultiUserOnly();
      }
    });
  });
}

// Pair Device modal logic
// Wolf serves guests on its own ports (scripts/omarchy-wolf-install); Sunshine keeps 47989.
const WOLF_HTTP_PORT = 49989;

function openPairDeviceModal(defaultPin = "", username = "", clientIp = "") {
  const portal = document.querySelector<HTMLElement>("#modal-portal");
  if (!portal) return;
  const pending = multiUser?.pair_pending ?? [];
  const device = clientIp || (pending.length === 1 ? pending[0].client_ip : "");
  const knownUser = username || pending.find((p) => p.client_ip === device)?.username || "";
  portal.innerHTML = renderPairDeviceModal(defaultPin, multiUser?.users ?? [], knownUser, pending, device);
  pairModalOpenFor = device || "manual";
  const pinInput = portal.querySelector<HTMLInputElement>("#pair-pin-input");
  pinInput?.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
  });
  window.setTimeout(() => pinInput?.focus(), 50);
  portal.querySelector<HTMLSelectElement>("#pair-device-select")?.addEventListener("change", (e) => {
    const ip = (e.target as HTMLSelectElement).value;
    const hidden = portal.querySelector<HTMLInputElement>("#pair-client-ip");
    if (hidden) hidden.value = ip;
  });

  const userSelect = portal.querySelector<HTMLSelectElement>("#pair-user-select");
  const targetSelect = portal.querySelector<HTMLSelectElement>("#pair-target-select");
  // Mirror the broker rule: a guest can never be paired to Sunshine.
  userSelect?.addEventListener("change", () => {
    if (!targetSelect) return;
    const isGuest = userSelect.selectedOptions[0]?.dataset.role === "guest";
    const sunshine = targetSelect.querySelector<HTMLOptionElement>('option[value="sunshine"]');
    if (sunshine) sunshine.disabled = isGuest;
    if (isGuest) targetSelect.value = "wolf";
    else if (targetSelect.value === "wolf") targetSelect.value = "auto";
  });

  const form = portal.querySelector<HTMLFormElement>("#pair-device-form");
  const feedback = portal.querySelector<HTMLElement>("#pair-feedback");
  const submitBtn = portal.querySelector<HTMLButtonElement>("#btn-submit-pair");

  const close = () => {
    if (portal) portal.innerHTML = "";
    pairModalOpenFor = null;
  };

  portal.querySelectorAll(".btn-close-modal").forEach((b) => b.addEventListener("click", close));

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = (form.elements.namedItem("pair_pin") as HTMLInputElement)?.value.trim();
    const name = (form.elements.namedItem("pair_name") as HTMLInputElement)?.value.trim();

    if (!pin || pin.length !== 4) {
      showToast("Il PIN deve essere esattamente di 4 cifre numeriche", "error");
      return;
    }

    if (submitBtn) setBusy(submitBtn, true, "Accoppiamento in corso…");
    if (feedback) {
      feedback.className = "rounded-lg p-2.5 border bg-zinc-950/80 border-zinc-700 text-zinc-300 text-xs";
      feedback.innerHTML = `<span>⏳ Invio del codice PIN <b>${escapeHtml(pin)}</b> in corso…</span>`;
      feedback.classList.remove("hidden");
    }

    try {
      const target = (targetSelect?.value || "auto") as "auto" | "sunshine" | "wolf";
      const clientIp = portal.querySelector<HTMLInputElement>("#pair-client-ip")?.value || undefined;
      const res = brokerMessage(
        await api.pairMoonlightDevice(pin, name || undefined, currentSession?.token, target, userSelect?.value || undefined, clientIp),
        "Dispositivo accoppiato",
      );
      if (!res.ok) throw new Error(res.message);
      if (feedback) {
        feedback.className = "rounded-lg p-2.5 border bg-emerald-950/50 border-emerald-500/50 text-emerald-300 text-xs";
        feedback.textContent = res.message;
      }
      if (clientIp) dismissedPairings.add(clientIp);
      showToast("Dispositivo accoppiato", "ok");
      setTimeout(close, 1200);
    } catch (err) {
      if (feedback) {
        feedback.className = "rounded-lg p-2.5 border bg-red-950/50 border-red-500/50 text-red-300 text-xs";
        feedback.textContent = `Errore di accoppiamento: ${String(err)}`;
      }
      showToast(String(err), "error");
    } finally {
      if (submitBtn) setBusy(submitBtn, false);
    }
  });
}

function wireStorageActions() {
  document.querySelectorAll<HTMLButtonElement>(".btn-user-storage").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.username && currentSession) openUserStorage(btn.dataset.username, currentSession.token,
        (message, failed) => showToast(message, failed ? "error" : "ok"), () => void refreshMultiUserOnly());
    };
  });
}

function wireUserActions() {
  wireStorageActions();
  // PIN reveal toggle
  document.querySelectorAll<HTMLButtonElement>(".pin-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      if (!target) return;
      const mask = document.querySelector<HTMLElement>(`#pin-mask-${target}`);
      const val = document.querySelector<HTMLElement>(`#pin-val-${target}`);
      if (mask && val) {
        const isHidden = val.classList.contains("hidden");
        if (isHidden) {
          mask.classList.add("hidden");
          val.classList.remove("hidden");
        } else {
          mask.classList.remove("hidden");
          val.classList.add("hidden");
        }
      }
    });
  });

  // 1-Click Moonlight Invite Modal
  document.querySelectorAll<HTMLButtonElement>(".btn-share-invite").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.username;
      if (!username || !multiUser) return;
      const user = multiUser.users.find((u) => u.username === username);
      if (!user) return;

      const portal = document.querySelector<HTMLElement>("#modal-portal");
      if (!portal) return;

      // Determine available hosts & streaming port (Sempre esplicita nel link!)
      const availableHosts: { label: string; host: string }[] = [];
      const currentHost = activeNode?.host || "192.168.0.28";
      // Guests go to Wolf (isolated sandboxes), admins to Sunshine (owner desktop).
      const streamPort = user.role === "guest" ? WOLF_HTTP_PORT : activeNode?.streaming_port || 47989;
      const portSuffix = `:${streamPort}`;

      // 1. Local LAN (Prima opzione consigliata per uso locale su questo Mac)
      const lanHostWithPort = `${currentHost}${portSuffix}`;
      availableHosts.push({
        label: `LAN · ${currentHost}`,
        host: lanHostWithPort,
      });

      // 2. DuckDNS Globale (Zero VPN) - Uses node-specific DDNS if configured or global active DDNS
      const nodeDdns = normalizeDdnsDomain(activeNode?.ddns_domain || ddnsStatusInfo?.domain);
      if (nodeDdns) {
        availableHosts.push({
          label: `Internet · ${nodeDdns}`,
          host: `${nodeDdns}${portSuffix}`,
        });
      }

      // 3. Public WAN IP (with explicit port)
      try {
        const publicIp = await api.getPublicIp();
        if (publicIp && publicIp.trim()) {
          const wanWithPort = `${publicIp.trim()}${portSuffix}`;
          if (!availableHosts.some((h) => h.host === wanWithPort)) {
            availableHosts.push({
              label: `IP pubblico · ${publicIp.trim()}`,
              host: wanWithPort,
            });
          }
        }
      } catch {
        // public IP lookup failed or offline
      }

      // 4. Tailscale MagicDNS (with explicit port)
      try {
        const tsNodes = await api.getTailscaleNodes();
        tsNodes.forEach((tn) => {
          const target = tn.dns_name || tn.ip;
          if (target) {
            const targetWithPort = `${target}${portSuffix}`;
            if (!availableHosts.some((h) => h.host === targetWithPort)) {
              availableHosts.push({
                label: `Tailscale · ${tn.hostname}${tn.online ? "" : " (offline)"}`,
                host: targetWithPort,
              });
            }
          }
        });
      } catch {
        // tailscale not running or offline
      }

      // Fallback PVE magicdns if not already in list
      const pveMagicDns = `pve.tail65d87d.ts.net${portSuffix}`;
      if (!availableHosts.some((h) => h.host === pveMagicDns)) {
        availableHosts.push({ label: `Tailscale · Proxmox`, host: pveMagicDns });
      }

      // Default to Local LAN for this Mac
      const defaultHost = lanHostWithPort;
      const initialDeepLink = `moonlight://${defaultHost}`;
      const qrSvg = await QRCode.toString(initialDeepLink, { type: "svg", margin: 1 });

      portal.innerHTML = renderMoonlightInviteModal(user, defaultHost, availableHosts, qrSvg, streamPort);

      const closeInvite = () => {
        portal.innerHTML = "";
      };

      document.querySelector("#btn-close-invite-modal")?.addEventListener("click", closeInvite);
      document.querySelector("#btn-close-invite-footer")?.addEventListener("click", closeInvite);

      const hostSelect = document.querySelector<HTMLSelectElement>("#invite-host-select");
      const portInput = document.querySelector<HTMLInputElement>("#invite-port-input");
      const linkInput = document.querySelector<HTMLInputElement>("#invite-link-input");
      const qrContainer = document.querySelector<HTMLElement>("#invite-qr-container");
      const copyMsgBtn = document.querySelector<HTMLButtonElement>("#btn-copy-whatsapp-msg");

      const testPortBtn = document.querySelector<HTMLButtonElement>("#btn-test-stream-port");
      const openMoonlightBtn = document.querySelector<HTMLButtonElement>("#btn-open-moonlight");
      const testFeedback = document.querySelector<HTMLElement>("#stream-test-feedback");
      const copyPinBtn = document.querySelector<HTMLButtonElement>("#btn-copy-pin");

      const getActiveEndpoint = () => {
        const rawHost = hostSelect?.value || defaultHost;
        const baseHost = rawHost.includes(":") ? rawHost.substring(0, rawHost.lastIndexOf(":")) : rawHost;
        const currentPortVal = parseInt(portInput?.value || "47989", 10) || 47989;
        return { baseHost, currentPortVal, fullTarget: `${baseHost}:${currentPortVal}` };
      };

      if (hostSelect && linkInput && qrContainer && copyMsgBtn) {
        const updateInviteLink = async () => {
          const { fullTarget, currentPortVal } = getActiveEndpoint();
          const newDeepLink = `moonlight://${fullTarget}`;
          linkInput.value = newDeepLink;

          if (testFeedback) {
            // A guest on any other port would reach Sunshine, the owner's desktop.
            const wrongPort = user.role === "guest" && currentPortVal !== WOLF_HTTP_PORT;
            testFeedback.classList.toggle("hidden", !wrongPort);
            testFeedback.innerHTML = wrongPort
              ? `<span class="text-amber-300">Gli ospiti devono usare la porta ${WOLF_HTTP_PORT} (Wolf): su altre porte si arriva al desktop admin.</span>`
              : "";
          }

          try {
            const newQr = await QRCode.toString(newDeepLink, { type: "svg", margin: 1 });
            qrContainer.innerHTML = newQr;
          } catch {}

          const updatedMsg = buildInviteMessage(user.display_name, fullTarget, user.pin, user.role === "guest");
          copyMsgBtn.dataset.msg = updatedMsg;
        };

        hostSelect.addEventListener("change", updateInviteLink);
        portInput?.addEventListener("input", updateInviteLink);
      }

      // Test Streaming Port Socket
      testPortBtn?.addEventListener("click", async () => {
        const { baseHost, currentPortVal } = getActiveEndpoint();
        if (!baseHost) {
          showToast("Seleziona o inserisci un host valido", "error");
          return;
        }

        setBusy(testPortBtn, true, "Verifica porta…");
        if (testFeedback) {
          testFeedback.className = "rounded-lg p-2.5 border bg-zinc-950/80 border-zinc-700 text-zinc-300 text-xs";
          testFeedback.innerHTML = `<span>⏳ Connessione socket TCP a <code>${escapeHtml(baseHost)}:${currentPortVal}</code> in corso…</span>`;
          testFeedback.classList.remove("hidden");
        }

        try {
          const res = await api.testStreamPort(baseHost, currentPortVal);
          if (res.reachable) {
            if (testFeedback) {
              testFeedback.className = "rounded-lg p-2.5 border bg-emerald-950/40 border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between";
              testFeedback.innerHTML = `
                <div class="flex items-center gap-1.5 font-semibold">
                  <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                  <span>Porta aperta e raggiungibile!</span>
                </div>
                <span class="font-mono text-emerald-300 font-bold">Latenza: ${res.latency_ms} ms</span>
              `;
            }
            showToast(`Porta ${currentPortVal} raggiungibile (${res.latency_ms}ms)!`, "ok");
          } else {
            const isDuckOrWan = baseHost.includes(".duckdns.org") || (baseHost.match(/^\\d+\\.\\d+\\.\\d+\\.\\d+$/) && !baseHost.startsWith("192.168.") && !baseHost.startsWith("10."));
            if (testFeedback) {
              testFeedback.className = "rounded-lg p-3 border bg-amber-950/30 border-amber-500/40 text-amber-200 text-xs space-y-2";
              testFeedback.innerHTML = `
                <div class="flex items-center gap-1.5 font-semibold text-red-400">
                  <span class="w-2 h-2 rounded-full bg-red-400 inline-block"></span>
                  <span>Porta ${currentPortVal} non raggiungibile su ${escapeHtml(baseHost)} (${escapeHtml(res.message || "Timeout")})</span>
                </div>
                ${isDuckOrWan ? `
                  <div class="text-[11px] text-zinc-300 leading-relaxed bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 space-y-1.5">
                    <p class="font-semibold text-amber-400">💡 Perché DuckDNS dà timeout dal tuo Mac?</p>
                    <p>1. <strong>Sei collegato al Wi-Fi di casa:</strong> I modem Sky Hub bloccano categoricamente il <em>NAT Loopback</em> (non permettono a un PC interno di interrogare il proprio IP pubblico dall'interno della stessa casa).</p>
                    <p>2. <strong>Per giocare da questo Mac:</strong> devi usare l'indirizzo LAN interno, che risponde subito con latenza &lt; 2ms.</p>
                    <button type="button" id="btn-quick-switch-lan" class="w-full mt-2 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition shadow-sm cursor-pointer">
                      <span>🏠</span> <span>Seleziona Nodo Locale (LAN Wi-Fi) e testa subito</span>
                    </button>
                  </div>
                ` : `
                  <div class="text-[11px] text-zinc-300 leading-relaxed">
                    Verifica che la porta <strong>${currentPortVal} (TCP/UDP)</strong> sia abilitata sul server Wolf/Sunshine.
                  </div>
                `}
              `;
              document.querySelector("#btn-quick-switch-lan")?.addEventListener("click", () => {
                if (hostSelect) {
                  hostSelect.value = lanHostWithPort;
                  hostSelect.dispatchEvent(new Event("change"));
                  setTimeout(() => testPortBtn.click(), 100);
                }
              });
            }
            showToast(isDuckOrWan ? "DuckDNS irraggiungibile dalla LAN (il modem Sky blocca il NAT Loopback)" : `Porta non raggiungibile: ${res.message || "Timeout"}`, "error");
          }
        } catch (err) {
          if (testFeedback) {
            testFeedback.className = "rounded-lg p-2.5 border bg-red-950/40 border-red-500/40 text-red-300 text-xs";
            testFeedback.textContent = `Errore durante il test: ${String(err)}`;
          }
          showToast(String(err), "error");
        } finally {
          setBusy(testPortBtn, false);
        }
      });

      // Launch Moonlight directly on macOS
      openMoonlightBtn?.addEventListener("click", async () => {
        const link = (document.querySelector<HTMLInputElement>("#invite-link-input")?.value) || initialDeepLink;
        try {
          setBusy(openMoonlightBtn, true, "Avvio…");
          const msg = await api.openMoonlightUrl(link);
          showToast(msg, "ok");
        } catch (err) {
          showToast(`Impossibile avviare Moonlight: ${String(err)}`, "error");
        } finally {
          setBusy(openMoonlightBtn, false);
        }
      });

      // Copy PIN only
      copyPinBtn?.addEventListener("click", () => {
        navigator.clipboard.writeText(user.pin);
        showToast("PIN copiato negli appunti!", "ok");
      });

      document.querySelector("#btn-trigger-pair-from-invite")?.addEventListener("click", () => {
        openPairDeviceModal("", user.username);
      });

      document.querySelector("#btn-copy-invite-link")?.addEventListener("click", () => {
        const link = (document.querySelector<HTMLInputElement>("#invite-link-input")?.value) || initialDeepLink;
        navigator.clipboard.writeText(link);
        showToast("Link 1-Click copiato negli appunti!", "ok");
      });

      copyMsgBtn?.addEventListener("click", () => {
        const msg = copyMsgBtn.dataset.msg || "";
        navigator.clipboard.writeText(msg);
        showToast("Messaggio pronto per WhatsApp copiato negli appunti!", "ok");
      });
    });
  });

  // Edit user
  document.querySelectorAll<HTMLButtonElement>(".btn-edit-user").forEach((btn) => {
    btn.addEventListener("click", () => {
      const username = btn.dataset.username;
      if (!username || !multiUser) return;
      const user = multiUser.users.find((u) => u.username === username);
      if (!user) return;

      $<HTMLInputElement>("#edit-target-username").value = user.username;
      $<HTMLInputElement>("#edit-username-input").value = user.username;
      $<HTMLInputElement>("#edit-display-input").value = user.display_name;
      $<HTMLInputElement>("#edit-pin-input").value = "";
      $<HTMLSelectElement>("#edit-role-select").value = user.role;
      $<HTMLSelectElement>("#edit-bitrate-select").value = String(user.max_bitrate_mbps);
      const storageInput = $<HTMLInputElement>("#edit-storage-input");
      storageInput.value = String(user.storage_limit_gb ?? 0);
      storageInput.dataset.original = storageInput.value;
      $("#edit-storage-usage").textContent = user.storage_used_gb == null
        ? "Spazio occupato: non ancora disponibile"
        : `Spazio occupato: ${user.storage_used_gb.toFixed(2)} GB`;

      $<HTMLInputElement>("#edit-app-steam").checked = user.allowed_apps.includes("steam");
      $<HTMLInputElement>("#edit-app-desktop").checked = user.allowed_apps.includes("desktop");
      $<HTMLInputElement>("#edit-app-retro").checked = user.allowed_apps.includes("retro");

      const allChecked = user.allowed_nodes?.includes("*") ?? false;
      const allBox = $<HTMLInputElement>("#edit-node-all");
      if (allBox) allBox.checked = allChecked;

      document.querySelectorAll<HTMLInputElement>(".edit-node-check").forEach((cb) => {
        cb.checked = !allChecked && (user.allowed_nodes?.includes(cb.value) ?? false);
      });

      const autoRecBox = $<HTMLInputElement>("#edit-user-auto-record");
      if (autoRecBox) autoRecBox.checked = user.auto_record ?? false;

      $("#edit-user-modal")?.classList.remove("hidden");
    });
  });

  // Ban / Unban / Remove
  document.querySelectorAll<HTMLButtonElement>(".btn-ban-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = btn.dataset.username;
      if (!u) return;
      try {
        setBusy(btn, true, "Banno…");
        const res = brokerMessage(await api.banMultiUser(u, "Disattivato dall'amministratore", currentSession?.token), "Utente bannato");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
        await refreshMultiUserOnly();
      } catch (err) {
        showToast(String(err), "error");
      } finally { setBusy(btn, false); }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-unban-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = btn.dataset.username;
      if (!u) return;
      try {
        setBusy(btn, true);
        const res = brokerMessage(await api.unbanMultiUser(u, currentSession?.token), "Utente riattivato");
        if (!res.ok) throw new Error(res.message);
        showToast(res.message, "ok");
        await refreshMultiUserOnly();
      } catch (err) {
        showToast(String(err), "error");
      } finally { setBusy(btn, false); }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-remove-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = btn.dataset.username;
      if (!u || !(await confirmDialog(`Eliminare l'utente "${u}"?`))) return;
      try {
        const res = await api.removeMultiUser(u, false, currentSession?.token);
        showToast(res, "ok");
        await refreshMultiUserOnly();
      } catch (err) {
        showToast(String(err), "error");
      }
    });
  });
}

function wireEnterpriseActions() {
  wireStorageActions();
  // Push / Pull Savegames
  document.querySelector<HTMLButtonElement>("#btn-manual-sync-push")?.addEventListener("click", async () => {
    const user = (document.querySelector<HTMLSelectElement>("#sync-user-select")?.value) || "admin";
    try {
      const res = await api.syncUserSavegames(user, "push", currentSession?.token);
      showToast(res, "ok");
      await loadEnterpriseData();
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  document.querySelector<HTMLButtonElement>("#btn-manual-sync-pull")?.addEventListener("click", async () => {
    const user = (document.querySelector<HTMLSelectElement>("#sync-user-select")?.value) || "admin";
    try {
      const res = await api.syncUserSavegames(user, "pull", currentSession?.token);
      showToast(res, "ok");
      await loadEnterpriseData();
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  // Admission check
  document.querySelector<HTMLButtonElement>("#btn-check-admission")?.addEventListener("click", async () => {
    try {
      const res = await api.checkAdmission(512);
      showToast(`Stato Ammissione: ${res.reason}`, res.admitted ? "ok" : "error");
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  // Prune storage
  document.querySelector<HTMLButtonElement>("#btn-prune-dryrun")?.addEventListener("click", async () => {
    try {
      const res = await api.pruneNasStorage(true, currentSession?.token);
      showToast(res, "info");
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  document.querySelector<HTMLButtonElement>("#btn-prune-execute")?.addEventListener("click", async () => {
    try {
      const res = await api.pruneNasStorage(false, currentSession?.token);
      showToast(res, "ok");
      await refreshMultiUserOnly();
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  // Salva configurazione Salvataggi & NAS
  document.querySelector<HTMLButtonElement>("#btn-save-settings-savegames")?.addEventListener("click", async () => {
    const btn = document.querySelector<HTMLButtonElement>("#btn-save-settings-savegames");
    const valType = (document.querySelector<HTMLSelectElement>("#cfg-savegames-type")?.value) || "nas";
    const valPath = (document.querySelector<HTMLInputElement>("#cfg-savegames-path")?.value) || "";
    const valSync = String(document.querySelector<HTMLInputElement>("#cfg-savegames-autosync")?.checked ?? false);
    const inputs = ["cfg-savegames-maxsnaps", "cfg-recordings-days", "cfg-savegames-path", "cfg-recordings-path", "cfg-local-saves-path", "cfg-local-recordings-path"];
    for (const id of inputs) {
      const input = document.querySelector<HTMLInputElement>(`#${id}`);
      if (!input || !input.reportValidity()) return;
    }
    const valMaxSnaps = document.querySelector<HTMLInputElement>("#cfg-savegames-maxsnaps")!.value;
    const valDays = document.querySelector<HTMLInputElement>("#cfg-recordings-days")!.value;

    if (btn) setBusy(btn, true, "Salvataggio…");
    try {
      await Promise.all([
        api.updateEnterpriseSetting("savegames_storage_type", valType, currentSession?.token),
        api.updateEnterpriseSetting("savegames_nas_path", valPath, currentSession?.token),
        api.updateEnterpriseSetting("savegames_auto_sync", valSync, currentSession?.token),
        api.updateEnterpriseSetting("retention_saves_max_snapshots", valMaxSnaps, currentSession?.token),
        api.updateEnterpriseSetting("retention_recordings_days", valDays, currentSession?.token),
        ...[["recordings_nas_path", "cfg-recordings-path"], ["local_saves_path", "cfg-local-saves-path"], ["local_recordings_path", "cfg-local-recordings-path"]].map(([key, id]) => api.updateEnterpriseSetting(
          key, document.querySelector<HTMLInputElement>(`#${id}`)!.value, currentSession?.token)),
      ]);
      showToast("Configurazione backup e registrazioni salvata", "ok");
      await loadEnterpriseData();
    } catch (err) {
      showToast(`Errore salvataggio: ${String(err)}`, "error");
    } finally {
      if (btn) setBusy(btn, false);
    }
  });

  // Salva Limiti Ammissione & Encoder
  document.querySelector<HTMLButtonElement>("#btn-save-settings-admission")?.addEventListener("click", async () => {
    const btn = document.querySelector<HTMLButtonElement>("#btn-save-settings-admission");
    const valMaxStreams = (document.querySelector<HTMLInputElement>("#cfg-admission-maxstreams")?.value) || "2";
    const desktopScale = document.querySelector<HTMLInputElement>("#cfg-desktop-scale");
    if (!desktopScale?.reportValidity()) return;

    if (btn) setBusy(btn, true, "Salvataggio…");
    try {
      await Promise.all([
        api.updateEnterpriseSetting("max_concurrent_streams", valMaxStreams, currentSession?.token),
        api.updateEnterpriseSetting("desktop_scale", String(Number(desktopScale.value) / 100), currentSession?.token),
      ]);
      showToast("Impostazioni streaming salvate", "ok");
      await loadEnterpriseData();
    } catch (err) {
      showToast(`Errore salvataggio: ${String(err)}`, "error");
    } finally {
      if (btn) setBusy(btn, false);
    }
  });

  // NAS Mount Modal Handlers
  document.querySelector<HTMLButtonElement>("#btn-open-nas-modal")?.addEventListener("click", () => {
    const modal = document.querySelector<HTMLElement>("#nas-mount-modal");
    refreshNasMountModal(multiUser?.storage);
    if (modal) modal.classList.remove("hidden");
    const feedback = document.querySelector<HTMLElement>("#nas-test-feedback");
    if (feedback) feedback.classList.add("hidden");
  });

  // The NAS modal is static: wire it once, not on every page refresh.
  if (!nasModalWired) {
  nasModalWired = true;
  const closeNasModal = () => {
    document.querySelector<HTMLElement>("#nas-mount-modal")?.classList.add("hidden");
  };
  document.querySelector<HTMLButtonElement>("#btn-close-nas-modal")?.addEventListener("click", closeNasModal);
  document.querySelector<HTMLButtonElement>("#btn-cancel-nas")?.addEventListener("click", closeNasModal);

  document.querySelector<HTMLButtonElement>("#btn-toggle-nas-pass")?.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>("#nas-input-pass");
    if (input) {
      input.type = input.type === "password" ? "text" : "password";
    }
  });

  document.querySelector<HTMLButtonElement>("#btn-test-nas")?.addEventListener("click", async () => {
    const server = document.querySelector<HTMLInputElement>("#nas-input-server")?.value.trim() || "";
    const share = document.querySelector<HTMLInputElement>("#nas-input-share")?.value.trim() || "";
    const username = document.querySelector<HTMLInputElement>("#nas-input-user")?.value.trim() || undefined;
    const password = document.querySelector<HTMLInputElement>("#nas-input-pass")?.value || undefined;
    const feedback = document.querySelector<HTMLElement>("#nas-test-feedback");

    if (!server || !share) {
      showToast("Specifica Server e Share NAS", "error");
      return;
    }

    if (feedback) {
      feedback.className = "p-3 rounded-lg border text-xs font-medium bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-2";
      feedback.innerHTML = "<span>⏳</span> Test connettività SMB in corso verso " + server + "...";
      feedback.classList.remove("hidden");
    }

    try {
      const res = await api.testNasConnection(server, share, username, password);
      if (feedback) {
        if (res.accessible) {
          feedback.className = "p-3 rounded-lg border text-xs font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
          feedback.innerHTML = `✅ <strong>Connessione Riuscita!</strong> ${res.message} (Latenza: ${res.latency_ms ?? 0}ms)`;
        } else {
          feedback.className = "p-3 rounded-lg border text-xs font-medium bg-red-500/10 text-red-400 border-red-500/20";
          feedback.innerHTML = `❌ <strong>Test Fallito:</strong> ${res.error || res.message}`;
        }
      }
    } catch (err) {
      if (feedback) {
        feedback.className = "p-3 rounded-lg border text-xs font-medium bg-red-500/10 text-red-400 border-red-500/20";
        feedback.innerHTML = `❌ <strong>Errore di comunicazione:</strong> ${String(err)}`;
      }
    }
  });

  document.querySelector<HTMLButtonElement>("#btn-save-mount-nas")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const server = document.querySelector<HTMLInputElement>("#nas-input-server")?.value.trim() || "";
    const share = document.querySelector<HTMLInputElement>("#nas-input-share")?.value.trim() || "";
    const mountpoint = document.querySelector<HTMLInputElement>("#nas-input-mountpoint")?.value.trim() || "";
    const username = document.querySelector<HTMLInputElement>("#nas-input-user")?.value.trim() || undefined;
    const password = document.querySelector<HTMLInputElement>("#nas-input-pass")?.value || undefined;
    const feedback = document.querySelector<HTMLElement>("#nas-test-feedback");

    if (!server || !share || !mountpoint) {
      showToast("Specifica server, condivisione e punto di mount NAS", "error");
      return;
    }

    if (feedback) {
      feedback.className = "p-3 rounded-lg border text-xs font-medium bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-2";
      feedback.innerHTML = "<span>⏳</span> Montaggio storage CIFS in corso...";
      feedback.classList.remove("hidden");
    }

    try {
      const res = await api.mountNasStorage(server, share, mountpoint, username, password);
      if (res.mounted) {
        showToast(res.message, "ok");
        closeNasModal();
        await refreshMultiUserOnly();
      } else {
        if (feedback) {
          feedback.className = "p-3 rounded-lg border text-xs font-medium bg-red-500/10 text-red-400 border-red-500/20";
          feedback.innerHTML = `❌ <strong>Montaggio non riuscito:</strong> ${res.error || res.message}`;
        }
      }
    } catch (err) {
      if (feedback) {
        feedback.className = "p-3 rounded-lg border text-xs font-medium bg-red-500/10 text-red-400 border-red-500/20";
        feedback.innerHTML = `❌ <strong>Errore:</strong> ${String(err)}`;
      }
    }
  });
  }

  // DuckDNS Actions
  document.querySelector<HTMLButtonElement>("#btn-sync-ddns-now")?.addEventListener("click", async () => {
    try {
      showToast("Sincronizzazione DuckDNS in corso...", "info");
      const status = await api.getDdnsStatus();
      ddnsStatusInfo = status;
      showToast(status.message || `DuckDNS sincronizzato: ${status.domain} -> ${status.ip}`, status.status === "ok" ? "ok" : "error");
      await loadEnterpriseData();
    } catch (err) {
      showToast(`Errore sincronizzazione DDNS: ${String(err)}`, "error");
    }
  });

  document.querySelector<HTMLButtonElement>("#btn-save-ddns-config")?.addEventListener("click", async () => {
    const subInput = document.querySelector<HTMLInputElement>("#cfg-ddns-subdomain");
    const tokInput = document.querySelector<HTMLInputElement>("#cfg-ddns-token");
    const subdomain = subInput?.value.trim() || "";
    const token = tokInput?.value.trim() || "";
    if (!subdomain) {
      showToast("Inserisci il sottodominio DuckDNS", "error");
      return;
    }
    try {
      showToast("Salvataggio configurazione DuckDNS in corso...", "info");
      await api.updateDdnsConfig(subdomain, token, true);
      showToast(`DuckDNS configurato per ${subdomain}.duckdns.org!`, "ok");
      await loadEnterpriseData();
    } catch (err) {
      showToast(`Errore salvataggio DDNS: ${String(err)}`, "error");
    }
  });

  document.querySelector<HTMLButtonElement>("#btn-toggle-ddns-token")?.addEventListener("click", () => {
    const tokInput = document.querySelector<HTMLInputElement>("#cfg-ddns-token");
    if (tokInput) {
      tokInput.type = tokInput.type === "password" ? "text" : "password";
    }
  });
}

async function loadEnterpriseData() {
  try {
    const [settings, peers, saves, ddns] = await Promise.all([
      api.getEnterpriseSettings().catch(() => multiUser?.settings ?? {}),
      api.listVpnPeers(undefined, currentSession?.token).catch(() => multiUser?.vpn_peers ?? []),
      api.listUserSavegames(undefined, currentSession?.token).catch(() => multiUser?.savegames ?? []),
      api.getDdnsStatus().catch(() => null),
    ]);
    enterpriseSettings = settings;
    vpnPeersList = peers;
    savegamesList = saves;
    if (ddns) ddnsStatusInfo = ddns;

    const enterpriseContainer = document.querySelector<HTMLElement>("#enterprise-container");
    if (enterpriseContainer && multiUser) {
      renderEditableSection(
        enterpriseContainer,
        renderEnterpriseDashboard(multiUser, enterpriseSettings, vpnPeersList, savegamesList, multiUser.users, ddnsStatusInfo),
        wireEnterpriseActions,
        true,
      );
    }
  } catch {
    // ignore
  }
}

function setupAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = window.setInterval(() => {
    if (autoRefreshActive && !refreshing) {
      void refreshAll();
    }
  }, 4000);
}

// Shell Mount
function mountMainShell(session: AuthSession) {
  currentSession = session;
  if (!isAdminSession()) {
    sessionStorage.clear();
    currentSession = null;
    mountLoginScreen();
    const errorBanner = $<HTMLElement>("#login-error-banner");
    const errorText = $<HTMLElement>("#login-error-text");
    if (errorBanner && errorText) {
      errorBanner.classList.remove("hidden");
      errorText.textContent = "Questo account è un profilo giocatore. I giocatori si connettono direttamente da Moonlight con il loro link 1-Click.";
    }
    showToast("Accesso riservato agli amministratori. I giocatori usano l'app Moonlight con il link 1-Click.", "error");
    return;
  }

  $("#app").innerHTML = `
    <div class="flex h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      
      <!-- Sidebar -->
      <aside class="sidebar bg-zinc-900/90 border-r border-zinc-800 flex flex-col shrink-0">
        <div class="h-16 px-4 border-b border-zinc-800/80 flex items-center gap-3">
          <div class="w-9 h-9 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-base">O</div>
          <div class="brand-text min-w-0">
            <div class="font-semibold text-sm text-zinc-100 tracking-tight truncate">Omarchy Control</div>
            <div class="text-[10px] text-zinc-500 font-mono">Control Plane</div>
          </div>
        </div>

        <nav class="flex-1 p-2.5 space-y-1 overflow-y-auto" aria-label="Sezioni">
          <a href="#overview" class="nav-tab" data-tab="overview" title="Dashboard" aria-current="page">
            ${Icons.dashboard()}
            <span class="nav-label">Dashboard</span>
          </a>
          <a href="#sessions" class="nav-tab" data-tab="sessions" title="Sessioni">
            ${Icons.monitor()}
            <span class="nav-label">Sessioni</span>
            <span id="active-sessions-count" class="nav-count">0</span>
          </a>
          <a href="#users" class="nav-tab" data-tab="users" title="Utenti & Accessi">
            ${Icons.users()}
            <span class="nav-label">Utenti & Accessi</span>
            <span id="registered-users-count" class="nav-count">0</span>
          </a>
          <a href="#recordings" class="nav-tab" data-tab="recordings" title="Registrazioni">
            ${Icons.film()}
            <span class="nav-label">Registrazioni</span>
          </a>
          <div class="nav-group-title">Sistema</div>
          <a href="#enterprise" class="nav-tab" data-tab="enterprise" title="Infrastruttura">
            ${Icons.server()}
            <span class="nav-label">Infrastruttura</span>
          </a>
          <a href="#streaming" class="nav-tab" data-tab="streaming" title="Display & Moonlight">
            ${Icons.gamepad()}
            <span class="nav-label">Display & Moonlight</span>
          </a>
          <a href="#requirements" class="nav-tab" data-tab="requirements" title="Diagnostica">
            ${Icons.wrench()}
            <span class="nav-label">Diagnostica</span>
          </a>
        </nav>

        <div class="p-2.5 border-t border-zinc-800/80">
          ${renderUpdateButton()}
        </div>
      </aside>

      <!-- Main Workspace -->
      <section class="flex-1 min-w-0 flex flex-col overflow-hidden bg-zinc-950">
        
        <!-- Topbar -->
        <header class="h-16 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur px-4 md:px-6 flex items-center justify-between gap-3 shrink-0 min-w-0">
          
          <!-- Node Selector / Status -->
          <div class="flex items-center gap-3">
            <button
              type="button"
              id="btn-node-switcher"
              class="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700/80 border border-zinc-700/60 text-xs font-medium text-zinc-200 transition cursor-pointer shadow-sm"
              title="Configura connessione e credenziali SSH"
            >
              <span id="topbar-node-dot" class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
              <span id="current-node-label" class="font-mono text-zinc-100 font-semibold">omarchy.local</span>
              ${Icons.chevronDown("w-3.5 h-3.5 text-zinc-400")}
            </button>

            <!-- Glowing SSH prompt button when not connected -->
            <button
              type="button"
              id="btn-topbar-ssh-prompt"
              class="hidden px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              ${Icons.key("w-3.5 h-3.5 text-amber-400")}
              <span>Credenziali SSH</span>
            </button>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-3">
            <button
              type="button"
              id="moonlight"
              class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm flex items-center gap-2 transition cursor-pointer"
            >
              ${Icons.gamepad("w-4 h-4 text-white")}
              <span class="hidden md:inline">Avvia Moonlight</span>
            </button>

            <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-zinc-800/60 border border-zinc-700/60 text-xs text-zinc-300 cursor-pointer">
              <input type="checkbox" id="toggle-autorefresh" checked class="rounded border-zinc-600 text-emerald-500 cursor-pointer" />
              <span class="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Live</span>
            </label>

            <button type="button" id="refresh" class="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-300 transition cursor-pointer" title="Ricarica telemetria">
              ${Icons.refresh("w-4 h-4 text-zinc-300")}
            </button>

            <div class="flex items-center gap-2 pl-3 border-l border-zinc-800">
              <span class="px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/50 text-zinc-200 text-xs font-medium font-mono">${escapeHtml(session.username)}</span>
              <button type="button" id="btn-lock-screen" class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer" title="Disconnetti">
                ${Icons.lock("w-4 h-4 text-zinc-400")}
              </button>
            </div>
          </div>
        </header>

        <!-- Content Views -->
        <main class="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 space-y-6 min-w-0">
          
          <!-- Tab 1: Dashboard / Overview -->
          <div class="tab-content" id="tab-overview">
            <div id="telemetry-container"></div>
          </div>

          <!-- Tab 2: Sessions -->
          <div class="tab-content hidden" id="tab-sessions">
            <div class="page-head"><h2>Sessioni</h2></div>
            <div id="sessions-container"></div>
          </div>

          <!-- Tab 3: Users -->
          <div class="tab-content hidden" id="tab-users">
            <div class="page-head">
              <h2>Utenti</h2>
              <div class="flex items-center gap-2">
                <button type="button" id="open-pair-device-modal" class="btn-ghost">Accoppia dispositivo</button>
                <button type="button" id="open-add-user-modal" class="btn-primary">Nuovo utente</button>
              </div>
            </div>
            <div id="users-container"></div>
          </div>

          <!-- Recordings -->
          <div class="tab-content hidden" id="tab-recordings">
            <div id="recordings-container"></div>
          </div>

          <!-- Tab 4: Enterprise -->
          <div class="tab-content hidden" id="tab-enterprise">
            <div id="enterprise-container"></div>
          </div>

          <!-- Tab 5: Moonlight on this Mac -->
          <div class="tab-content hidden" id="tab-streaming">
            <div class="page-head"><h2>Display</h2></div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div class="card space-y-4 text-xs">
                <div>
                  <label class="block text-zinc-400 mb-1.5" for="gaming-display">Schermo</label>
                  <div class="flex gap-2">
                    <select id="gaming-display" class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-xs outline-none focus:border-emerald-500"></select>
                    <button type="button" id="refresh-displays" class="btn-ghost px-2.5" title="Ricarica schermi" aria-label="Ricarica schermi">${Icons.refresh("w-4 h-4")}</button>
                  </div>
                </div>
                <div>
                  <div class="text-zinc-400 mb-1.5">Qualità</div>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="flex items-center gap-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 cursor-pointer">
                      <input type="radio" name="gaming-quality" value="performance" checked class="text-emerald-500" />
                      <span class="text-zinc-200">1080p · 60 FPS</span>
                    </label>
                    <label class="flex items-center gap-2 p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 cursor-pointer">
                      <input type="radio" name="gaming-quality" value="native" class="text-emerald-500" />
                      <span class="text-zinc-200">Nativa</span>
                    </label>
                  </div>
                </div>
                <button type="button" id="configure-gaming" class="btn-primary w-full">Applica a Moonlight</button>
              </div>
              <div class="card">
                <div class="card-title">Impostazioni risultanti</div>
                <div id="gaming-summary" class="text-xs text-zinc-500">Caricamento…</div>
              </div>
            </div>
          </div>

          <!-- Tab 6: Diagnostics -->
          <div class="tab-content hidden" id="tab-requirements">
            <div class="page-head"><h2>Diagnostica</h2></div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div class="card">
                <div class="card-title">Componenti</div>
                <div id="dependencies"><div class="text-xs text-zinc-500">Verifica in corso…</div></div>
              </div>
              <div class="card">
                <div class="card-title">Porte</div>
                <div class="kv"><span>Sunshine (admin)</span><span>47989 · 47998–48010</span></div>
                <div class="kv"><span>Wolf (ospiti)</span><span>49989 · 49999–50200</span></div>
                <div class="kv"><span>Broker API</span><span>47995</span></div>
                <div class="kv"><span>Live view (WebRTC)</span><span>8189</span></div>
              </div>
            </div>
          </div>

        </main>
      </section>

      <!-- Portals for modals -->
      <div id="modal-portal"></div>
      <div id="toast-container" class="toast-container"></div>
      ${renderAddUserModal(availableNodes)}
      ${renderEditUserModal(availableNodes)}
      ${renderNasMountModal(multiUser?.storage)}
      ${renderUpdateModal()}
    </div>
  `;

  // Setup tab navigation
  document.querySelectorAll<HTMLAnchorElement>(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const target = tab.dataset.tab;
      if (!target) return;

      document.querySelectorAll(".nav-tab").forEach((t) => t.removeAttribute("aria-current"));
      tab.setAttribute("aria-current", "page");

      document.querySelectorAll<HTMLElement>(".tab-content").forEach((tc) => {
        tc.classList.add("hidden");
        tc.querySelectorAll<HTMLElement>("[data-dirty]").forEach((el) => delete el.dataset.dirty);
      });
      const activeContent = document.querySelector<HTMLElement>(`#tab-${target}`);
      if (activeContent) activeContent.classList.remove("hidden");
      // Recordings are listed on demand (ffprobe on the server), not on every refresh.
      if (target === "recordings") void loadRecordings();
    });
  });

  void initUpdater();
  wireEscapeToClose();

  // Topbar and SSH modal buttons
  $("#btn-node-switcher").addEventListener("click", openSshModal);
  $("#btn-topbar-ssh-prompt")?.addEventListener("click", openSshModal);

  // Moonlight
  $("#moonlight").addEventListener("click", () => void launchMoonlight());

  // Refresh
  $("#refresh").addEventListener("click", () => void refreshAll());

  // Live polling toggle
  const liveToggle = document.querySelector<HTMLInputElement>("#toggle-autorefresh");
  if (liveToggle) {
    liveToggle.addEventListener("change", () => {
      autoRefreshActive = liveToggle.checked;
      showToast(autoRefreshActive ? "Live polling attivo" : "Live polling sospeso", "info");
    });
  }

  // Lock / Logout
  $("#btn-lock-screen")?.addEventListener("click", async () => {
    if (currentSession?.token) {
      try {
        await api.logout(currentSession.token);
      } catch {
        // ignore
      }
    }
    sessionStorage.removeItem("omarchy_auth_token");
    sessionStorage.removeItem("omarchy_auth_user");
    sessionStorage.removeItem("omarchy_auth_role");
    currentSession = null;
    mountLoginScreen();
  });

  // Displays
  $("#refresh-displays")?.addEventListener("click", () => void loadDisplays());
  $("#gaming-display")?.addEventListener("change", updateGamingSummary);
  document.querySelectorAll<HTMLInputElement>('input[name="gaming-quality"]').forEach((r) => {
    r.addEventListener("change", updateGamingSummary);
  });
  $("#configure-gaming")?.addEventListener("click", () => void configureGaming());


  $("#open-pair-device-modal")?.addEventListener("click", () => openPairDeviceModal());

  // User modal open
  $("#open-add-user-modal")?.addEventListener("click", () => {
    const pinInput = document.querySelector<HTMLInputElement>('input[name="new_pin"]');
    if (pinInput && !pinInput.value) {
      pinInput.value = Math.floor(1000 + Math.random() * 9000).toString();
    }
    $("#add-user-modal")?.classList.remove("hidden");
  });

  // Wire Add User form
  $("#generate-pin-btn")?.addEventListener("click", () => {
    const pin = document.querySelector<HTMLInputElement>('input[name="new_pin"]');
    if (pin) pin.value = Math.floor(1000 + Math.random() * 9000).toString();
  });

  $("#add-user-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const username = (form.elements.namedItem("new_username") as HTMLInputElement).value.trim();
    const display = (form.elements.namedItem("new_display") as HTMLInputElement).value.trim();
    let pin = (form.elements.namedItem("new_pin") as HTMLInputElement).value.trim();
    if (!pin) {
      pin = Math.floor(1000 + Math.random() * 9000).toString();
    }
    const role = ((form.elements.namedItem("new_role") as HTMLSelectElement)?.value) || "guest";
    const bitrate = Number((form.elements.namedItem("new_bitrate") as HTMLSelectElement).value);

    const apps: string[] = [];
    if ((form.elements.namedItem("app_steam") as HTMLInputElement)?.checked) apps.push("steam");
    if ((form.elements.namedItem("app_desktop") as HTMLInputElement)?.checked) apps.push("desktop");
    if ((form.elements.namedItem("app_retro") as HTMLInputElement)?.checked) apps.push("retro");

    let allowedNodes: string[] = [];
    if ((form.elements.namedItem("new_node_all") as HTMLInputElement)?.checked) {
      allowedNodes = ["*"];
    } else {
      document.querySelectorAll<HTMLInputElement>(".new-node-check:checked").forEach((cb) => {
        allowedNodes.push(cb.value);
      });
    }

    const autoRecord = (form.elements.namedItem("new_user_auto_record") as HTMLInputElement)?.checked ?? false;

    try {
      const storageLimitGb = Number((form.elements.namedItem("new_storage_gb") as HTMLInputElement).value);
      const res = await api.addMultiUser(username, display, pin, role, apps, bitrate, allowedNodes, currentSession?.token, autoRecord, storageLimitGb);
      showToast(res, "ok");
      $("#add-user-modal")?.classList.add("hidden");
      form.reset();
      await refreshMultiUserOnly();
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  // Edit User form
  $("#generate-edit-pin-btn")?.addEventListener("click", () => {
    const pin = document.querySelector<HTMLInputElement>("#edit-pin-input");
    if (pin) pin.value = Math.floor(1000 + Math.random() * 9000).toString();
  });

  $("#edit-user-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentUsername = $<HTMLInputElement>("#edit-target-username").value.trim();
    const newUsername = $<HTMLInputElement>("#edit-username-input").value.trim();
    const displayName = $<HTMLInputElement>("#edit-display-input").value.trim();
    const pin = $<HTMLInputElement>("#edit-pin-input").value.trim();
    const role = $<HTMLSelectElement>("#edit-role-select").value;
    const bitrate = Number($<HTMLSelectElement>("#edit-bitrate-select").value);
    const autoRecord = $<HTMLInputElement>("#edit-user-auto-record")?.checked ?? false;
    const storageInput = $<HTMLInputElement>("#edit-storage-input");
    const storageLimitGb = Number(storageInput.value);

    const apps: string[] = [];
    if ($<HTMLInputElement>("#edit-app-steam").checked) apps.push("steam");
    if ($<HTMLInputElement>("#edit-app-desktop").checked) apps.push("desktop");
    if ($<HTMLInputElement>("#edit-app-retro").checked) apps.push("retro");

    let allowedNodes: string[] = [];
    if ($<HTMLInputElement>("#edit-node-all").checked) {
      allowedNodes = ["*"];
    } else {
      document.querySelectorAll<HTMLInputElement>(".edit-node-check:checked").forEach((cb) => {
        allowedNodes.push(cb.value);
      });
    }

    try {
      const res = await api.editMultiUser(
        currentUsername,
        {
          newUsername: newUsername !== currentUsername ? newUsername : undefined,
          displayName,
          pin: pin.length > 0 ? pin : undefined,
          role,
          apps,
          maxBitrateMbps: bitrate,
          allowedNodes,
          autoRecord,
          storageLimitGb: storageLimitGb !== Number(storageInput.dataset.original) ? storageLimitGb : undefined,
        },
        currentSession?.token,
      );
      showToast(res, "ok");
      $("#edit-user-modal")?.classList.add("hidden");
      await refreshMultiUserOnly();
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  // Close modals
  document.querySelectorAll(".btn-close-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
    });
  });

  // Initial load
  void loadNodes();
  void refreshAll();
  void loadDisplays();
  void loadEnterpriseData();
  setupAutoRefresh();
}

const MIN_ADMIN_PASSWORD_LENGTH = 10; // auth::MIN_PASSWORD_LEN

function storeSession(session: AuthSession) {
  sessionStorage.setItem("omarchy_auth_token", session.token);
  sessionStorage.setItem("omarchy_auth_user", session.username);
  sessionStorage.setItem("omarchy_auth_role", session.role);
  currentSession = session;
}

/** First launch: no admin password exists yet (there is no built-in default). */
function mountSetupScreen() {
  $("#app").innerHTML = renderSetupScreen(MIN_ADMIN_PASSWORD_LENGTH);
  const form = $<HTMLFormElement>("#setup-form");
  const pwd = $<HTMLInputElement>("#setup-password");
  const confirm = $<HTMLInputElement>("#setup-password-confirm");
  const banner = $<HTMLElement>("#setup-error-banner");
  const bannerText = $<HTMLElement>("#setup-error-text");
  const submitBtn = $<HTMLButtonElement>("#btn-setup-submit");
  const fail = (message: string) => {
    bannerText.textContent = message;
    banner.classList.remove("hidden");
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    banner.classList.add("hidden");
    if (pwd.value.length < MIN_ADMIN_PASSWORD_LENGTH) return fail(`La password deve avere almeno ${MIN_ADMIN_PASSWORD_LENGTH} caratteri.`);
    if (pwd.value !== confirm.value) return fail("Le due password non coincidono.");
    setBusy(submitBtn, true, "Salvataggio…");
    try {
      const session = await api.authSetup(pwd.value);
      storeSession(session);
      mountMainShell(session);
    } catch (err) {
      fail(String(err).replace(/^Error:\s*/i, ""));
      setBusy(submitBtn, false);
    }
  });
}

function mountLoginScreen() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  $("#app").innerHTML = renderLoginScreen();
  // Swap to first-run setup when no admin password has been chosen yet.
  void api.authNeedsSetup().then((needed) => {
    if (needed && document.querySelector("#login-form")) mountSetupScreen();
  }).catch(() => undefined);

  const loginForm = $<HTMLFormElement>("#login-form");
  const errorBanner = $<HTMLElement>("#login-error-banner");
  const errorText = $<HTMLElement>("#login-error-text");
  const submitBtn = $<HTMLButtonElement>("#btn-login-submit");
  const togglePwdBtn = $<HTMLButtonElement>("#btn-toggle-pwd");
  const pwdInput = $<HTMLInputElement>("#login-password");
  const userInput = $<HTMLInputElement>("#login-username");

  togglePwdBtn?.addEventListener("click", () => {
    pwdInput.type = pwdInput.type === "password" ? "text" : "password";
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = userInput.value.trim();
    const password = pwdInput.value;

    errorBanner.classList.add("hidden");
    setBusy(submitBtn, true, "Verifica…");

    try {
      const session = await api.login(username, password);
      storeSession(session);
      mountMainShell(session);
    } catch (err) {
      errorBanner.classList.remove("hidden");
      errorText.textContent = String(err).replace(/^Error:\s*/i, "");
      pwdInput.focus();
    } finally {
      setBusy(submitBtn, false);
    }
  });
}

async function initAuth() {
  const token = sessionStorage.getItem("omarchy_auth_token");
  const username = sessionStorage.getItem("omarchy_auth_user");
  const role = sessionStorage.getItem("omarchy_auth_role") || "admin";
  if (token) {
    try {
      const valid = await api.validateSession(token);
      if (valid) {
        mountMainShell({
          token,
          username: username || "admin",
          role,
          expires_at: 0,
        });
        return;
      }
    } catch {
      // Fallback
    }
  }
  mountLoginScreen();
}

void initAuth();
