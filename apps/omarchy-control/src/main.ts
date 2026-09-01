import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type State = "ready" | "missing" | "blocked" | "unknown";
type Check = { state: State; detail: string; install_command?: string | null };
type Dependency = Check & { id: string; name: string };
type SetupConfig = {
  vm_host: string;
  vm_address: string;
  user: string;
  client_address: string;
  rtp_port: string;
  microphone: string;
  fedora_source: string;
};
type Dashboard = {
  platform: string;
  config_path: string;
  config: SetupConfig;
  checks: { moonlight: Check; ssh: Check; guest_receiver: Check; setup: Check };
  dependencies: Dependency[];
  ssh_password_source?: "environment" | "config" | null;
};
type SaveResult = { path: string; config: SetupConfig };
type DisplayInfo = { index: number; name: string; width: number; height: number; scale_factor: number };

const defaults: SetupConfig = {
  vm_host: "",
  vm_address: "",
  user: "",
  client_address: "",
  rtp_port: "40100",
  microphone: "",
  fedora_source: "@DEFAULT_SOURCE@",
};

let dirty = false;
let hydrated = false;
let refreshing = false;
let dashboard: Dashboard | null = null;
let displays: DisplayInfo[] = [];

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

function setMessage(message: string, level: "ok" | "error" | "info" = "info") {
  const target = $("#message");
  target.textContent = message;
  target.dataset.level = level;
}

function setBusy(button: HTMLButtonElement, busy: boolean, busyLabel = "Attendi…") {
  if (busy) {
    button.dataset.label = button.textContent ?? "";
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label ?? button.textContent;
    button.disabled = false;
  }
}

function input(name: keyof SetupConfig) {
  return $<HTMLInputElement>(`[name="${name}"]`).value.trim();
}

function readForm(): SetupConfig {
  return {
    vm_host: input("vm_host"),
    vm_address: input("vm_address"),
    user: input("user"),
    client_address: input("client_address"),
    rtp_port: input("rtp_port"),
    microphone: input("microphone"),
    fedora_source: input("fedora_source"),
  };
}

function password() {
  const value = $<HTMLInputElement>("#ssh-password").value;
  return value.length ? value : null;
}

function writeForm(config: Partial<SetupConfig>) {
  for (const [key, value] of Object.entries({ ...defaults, ...config })) {
    const element = document.querySelector<HTMLInputElement>(`[name="${key}"]`);
    if (element) element.value = String(value ?? "");
  }
}

function statusRow(title: string, check: Check) {
  return `<div class="status-row">
    <span class="status-dot ${check.state}" aria-hidden="true"></span>
    <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(check.detail)}</p></div>
    <span class="state ${check.state}">${labelFor(check.state)}</span>
  </div>`;
}

function renderDependencies(dependencies: Dependency[]) {
  $("#dependencies").innerHTML = dependencies.map((dependency) => `
    <div class="dependency-row">
      <span class="status-dot ${dependency.state}" aria-hidden="true"></span>
      <div class="dependency-copy">
        <div><strong>${escapeHtml(dependency.name)}</strong><span>${labelFor(dependency.state)}</span></div>
        <p>${escapeHtml(dependency.detail)}</p>
        ${dependency.install_command ? `<code>${escapeHtml(dependency.install_command)}</code>` : ""}
      </div>
      ${dependency.install_command ? `<button type="button" class="quiet install-dependency" data-id="${escapeHtml(dependency.id)}">Installa</button>` : ""}
    </div>`).join("");

  document.querySelectorAll<HTMLButtonElement>(".install-dependency").forEach((button) => {
    button.addEventListener("click", () => void installDependency(button));
  });
}

function render(data: Dashboard) {
  dashboard = data;
  if (!hydrated || !dirty) {
    writeForm(data.config);
    hydrated = true;
    dirty = false;
  }
  $("#platform").textContent = data.platform;
  $("#config-path").textContent = data.config_path;
  $("#overview-status").innerHTML = [
    statusRow("Moonlight", data.checks.moonlight),
    statusRow("SSH locale", data.checks.ssh),
    statusRow("Receiver Omarchy", data.checks.guest_receiver),
    statusRow("Automazione client", data.checks.setup),
  ].join("");
  renderDependencies(data.dependencies);
  const ready = Object.values(data.checks).filter((check) => check.state === "ready").length;
  $("#readiness").textContent = `${ready}/4 pronti`;
  $("#readiness").dataset.state = ready === 4 ? "ready" : "attention";
  const credential = $("#credential-source");
  credential.textContent = data.ssh_password_source
    ? `Credenziale disponibile da ${data.ssh_password_source === "config" ? "omarchy.env" : "variabile d'ambiente"}`
    : "Se coincide per SSH e sudo basta inserirla una volta; non viene salvata";
  const configure = $<HTMLButtonElement>("#configure");
  configure.disabled = data.checks.setup.state === "blocked";
  configure.title = configure.disabled ? data.checks.setup.detail : "";
  const configureGuest = $<HTMLButtonElement>("#configure-guest");
  configureGuest.disabled = !data.platform.toLowerCase().includes("fedora");
  configureGuest.title = configureGuest.disabled
    ? "La sincronizzazione remota Omarchy e disponibile dalla GUI Fedora"
    : "Riapplica idempotentemente la configurazione guest senza modificare PVE";
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const button = $<HTMLButtonElement>("#refresh");
  setBusy(button, true, "Verifico…");
  setMessage("Controllo configurazione, software locale e receiver…");
  try {
    const data = await invoke<Dashboard>("inspect_setup");
    render(data);
    setMessage("Stato aggiornato.", "ok");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
    refreshing = false;
  }
}

async function discover() {
  const button = $<HTMLButtonElement>("#discover");
  setBusy(button, true, "Rilevo…");
  try {
    const config = readForm();
    config.vm_address = "";
    config.client_address = "";
    const detected = await invoke<SetupConfig>("discover_config", { config });
    writeForm(detected);
    dirty = true;
    setMessage("Hostname risolto e indirizzi di rete rilevati. Controlla i valori e salva.", "ok");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function save(): Promise<boolean> {
  const button = $<HTMLButtonElement>("#save");
  setBusy(button, true, "Salvo…");
  try {
    const result = await invoke<SaveResult>("save_config", { config: readForm() });
    writeForm(result.config);
    $("#config-path").textContent = result.path;
    dirty = false;
    setMessage("Configurazione salvata. La password inserita nella GUI non è stata scritta su disco.", "ok");
    return true;
  } catch (error) {
    setMessage(String(error), "error");
    return false;
  } finally {
    setBusy(button, false);
  }
}

async function checkReceiver() {
  const button = $<HTMLButtonElement>("#check-receiver");
  setBusy(button, true, "Connetto…");
  setMessage("Connessione SSH a Omarchy…");
  try {
    const check = await invoke<Check>("check_receiver", {
      config: readForm(),
      sshPassword: password(),
    });
    if (dashboard) {
      dashboard.checks.guest_receiver = check;
      render(dashboard);
    }
    setMessage(check.detail, check.state === "ready" || check.state === "missing" ? "ok" : "error");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function launchMoonlight() {
  const button = $<HTMLButtonElement>("#moonlight");
  setBusy(button, true, "Apro…");
  try {
    const detail = await invoke<string>("launch_moonlight");
    setMessage(detail, "ok");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadDisplays() {
  try {
    displays = await invoke<DisplayInfo[]>("list_displays");
    const select = $<HTMLSelectElement>("#gaming-display");
    select.innerHTML = displays.map((display) =>
      `<option value="${display.index}">${escapeHtml(display.name)} — ${display.width}×${display.height}</option>`,
    ).join("");
    const fourK = displays.find((display) => display.width === 3840 && display.height === 2160);
    if (fourK) select.value = String(fourK.index);
    $<HTMLButtonElement>("#configure-gaming").disabled = displays.length === 0;
  } catch (error) {
    setMessage(String(error), "error");
  }
}

async function configureGaming() {
  const button = $<HTMLButtonElement>("#configure-gaming");
  const displayIndex = Number($<HTMLSelectElement>("#gaming-display").value);
  const qualityMode = $<HTMLSelectElement>("#gaming-quality").value;
  setBusy(button, true, "Ottimizzo…");
  try {
    const detail = await invoke<string>("configure_moonlight_gaming", { displayIndex, qualityMode });
    setMessage(detail, "ok");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function configureClient() {
  if (dashboard?.checks.setup.state === "blocked") {
    setMessage(dashboard.checks.setup.detail, "error");
    return;
  }
  const button = $<HTMLButtonElement>("#configure");
  setBusy(button, true, "Preparo…");
  try {
    if (!await save()) return;
    const detail = await invoke<string>("run_setup_in_terminal", {
      sshPassword: password(),
      setupScope: "client",
    });
    await refresh();
    $<HTMLInputElement>("#ssh-password").value = "";
    setMessage(detail, "ok");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function configureGuest() {
  const button = $<HTMLButtonElement>("#configure-guest");
  setBusy(button, true, "Sincronizzo…");
  try {
    if (!await save()) return;
    const detail = await invoke<string>("run_setup_in_terminal", {
      sshPassword: password(),
      setupScope: "guest",
    });
    await refresh();
    $<HTMLInputElement>("#ssh-password").value = "";
    setMessage(detail, "ok");
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function installDependency(button: HTMLButtonElement) {
  setBusy(button, true, "Apro…");
  try {
    const detail = await invoke<string>("install_dependency", { dependencyId: button.dataset.id });
    setMessage(detail, "ok");
    await refresh();
  } catch (error) {
    setMessage(String(error), "error");
  } finally {
    setBusy(button, false);
  }
}

$("#app").innerHTML = `
  <main class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">O</span><div><strong>Omarchy</strong><span>Control</span></div></div>
      <nav aria-label="Sezioni">
        <a href="#overview" class="active"><span>01</span> Stato</a>
        <a href="#connection"><span>02</span> Connessione</a>
        <a href="#streaming"><span>03</span> Gaming</a>
        <a href="#requirements"><span>04</span> Dipendenze</a>
      </nav>
      <div class="sidebar-foot"><span>Client locale</span><strong id="platform">Rilevamento…</strong><small id="config-path">…</small></div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div><p class="eyebrow">REMOTE DESKTOP CONTROL PLANE</p><h1>Configura. Verifica. Connettiti.</h1></div>
        <div class="top-actions"><span id="readiness" data-state="attention">Verifica in corso</span><button type="button" class="quiet" id="refresh">Aggiorna stato</button></div>
      </header>

      <section id="overview" class="section overview">
        <div class="section-heading"><div><p class="eyebrow">STATO DEL SISTEMA</p><h2>Il percorso fino a Omarchy</h2></div><button type="button" id="moonlight">Apri Moonlight <span>↗</span></button></div>
        <div id="overview-status" class="status-list" aria-live="polite"></div>
      </section>

      <section id="streaming" class="section">
        <div class="section-heading"><div><p class="eyebrow">MOONLIGHT GAMING</p><h2>Adatta lo stream allo schermo</h2><p>Seleziona il pannello su cui giocherai. Il profilo usa i pixel fisici, 60 FPS, bitrate automatico, V-Sync e frame pacing; riavvia Moonlight senza toccare l’associazione a Omarchy.</p></div></div>
        <div class="gaming-profile">
          <label><span>Schermo di destinazione</span><select id="gaming-display" aria-label="Schermo di destinazione"></select><small>Una TV 4K viene configurata come 3840×2160@60; il notebook resta disponibile come profilo 1080p.</small></label>
          <label><span>Profilo</span><select id="gaming-quality" aria-label="Profilo gaming"><option value="performance">Prestazioni 1080p — consigliato GTX 1050</option><option value="native">Qualità nativa — desktop e giochi leggeri</option></select><small>Entrambi sono 16:9 e riempiono la TV. Il 4K nativo richiede quattro volte i pixel del 1080p.</small></label>
          <button type="button" id="configure-gaming" disabled>Ottimizza e riavvia Moonlight</button>
        </div>
        <p class="profile-note">HEVC resta automatico perché viene usato solo se encoder e decoder lo supportano. HDR e YUV 4:4:4 restano spenti: sono meno affidabili e non migliorano il movimento nei giochi.</p>
      </section>

      <section id="connection" class="section">
        <div class="section-heading"><div><p class="eyebrow">CONNESSIONE</p><h2>Rete e accesso SSH</h2><p>Inserisci soltanto hostname e utente: gli indirizzi vengono ricavati dalla route locale.</p></div><button type="button" class="quiet" id="discover">Rileva rete</button></div>
        <form id="connection-form">
          <div class="field-grid primary-fields">
            <label><span>Hostname Omarchy</span><input name="vm_host" placeholder="omarchy.local" autocomplete="off" /><small>Risolto automaticamente in IP</small></label>
            <label><span>Utente SSH</span><input name="user" placeholder="utente" autocomplete="username" /><small>Precompilato con l’utente locale</small></label>
            <label><span>Password temporanea SSH + sudo</span><input id="ssh-password" type="password" autocomplete="current-password" placeholder="Non viene salvata" /><small id="credential-source">Usata una volta dal wizard, solo se coincide sui due PC</small></label>
          </div>
          <div class="connection-actions">
            <button type="button" class="quiet" id="check-receiver">Prova accesso SSH</button>
            <button type="button" class="quiet" id="save">Salva localmente</button>
            <button type="button" class="quiet" id="configure-guest">Sincronizza Omarchy</button>
            <button type="button" id="configure">Configura questo client</button>
          </div>
          <details>
            <summary>Impostazioni rilevate e audio</summary>
            <div class="field-grid advanced-fields">
              <label><span>IP VM</span><input name="vm_address" placeholder="rilevato dal hostname" inputmode="decimal" /></label>
              <label><span>IP client</span><input name="client_address" placeholder="rilevato dalla route" inputmode="decimal" /></label>
              <label><span>Porta RTP</span><input name="rtp_port" inputmode="numeric" /></label>
              <label><span>Microfono Windows</span><input name="microphone" placeholder="rilevato dallo script FFmpeg" /></label>
              <label><span>Sorgente Fedora</span><input name="fedora_source" /></label>
            </div>
          </details>
        </form>
      </section>

      <section id="requirements" class="section dependencies-section">
        <div class="section-heading"><div><p class="eyebrow">DIPENDENZE LOCALI</p><h2>Software richiesto</h2><p>I comandi cambiano automaticamente in base al sistema operativo.</p></div></div>
        <div id="dependencies" class="dependency-list"></div>
      </section>

      <div id="message" data-level="info" role="status">Avvio dei controlli…</div>
    </section>
  </main>`;

$("#connection-form").addEventListener("submit", (event) => event.preventDefault());
$("#connection-form").addEventListener("input", (event) => {
  if ((event.target as HTMLElement).id !== "ssh-password") dirty = true;
});
$("#save").addEventListener("click", () => void save());
$("#refresh").addEventListener("click", () => void refresh());
$("#discover").addEventListener("click", () => void discover());
$("#check-receiver").addEventListener("click", () => void checkReceiver());
$("#moonlight").addEventListener("click", () => void launchMoonlight());
$("#configure-gaming").addEventListener("click", () => void configureGaming());
$("#configure").addEventListener("click", () => void configureClient());
$("#configure-guest").addEventListener("click", () => void configureGuest());
window.addEventListener("focus", () => {
  if (hydrated) {
    void refresh();
    void loadDisplays();
  }
});

void refresh();
void loadDisplays();
