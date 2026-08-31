import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type Check = { state: "ready" | "missing" | "blocked" | "unknown"; detail: string };
type Dashboard = {
  platform: string;
  config_path: string;
  config: SetupConfig;
  checks: { moonlight: Check; ssh: Check; guest_receiver: Check; setup: Check };
};
type SetupConfig = {
  vm_host: string;
  vm_address: string;
  user: string;
  client_address: string;
  rtp_port: string;
  microphone: string;
  fedora_source: string;
};

const defaults: SetupConfig = {
  vm_host: "",
  vm_address: "",
  user: "",
  client_address: "",
  rtp_port: "40100",
  microphone: "",
  fedora_source: "@DEFAULT_SOURCE@",
};

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

function setMessage(message: string, level: "ok" | "error" | "info" = "info") {
  const target = $("#message");
  target.textContent = message;
  target.dataset.level = level;
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

function writeForm(config: Partial<SetupConfig>) {
  for (const [key, value] of Object.entries({ ...defaults, ...config })) {
    const element = document.querySelector<HTMLInputElement>(`[name="${key}"]`);
    if (element) element.value = String(value ?? "");
  }
}

function checkCard(title: string, check: Check) {
  return `<article class="check ${check.state}">
    <p>${escapeHtml(title)}</p>
    <strong>${escapeHtml(check.state)}</strong>
    <span>${escapeHtml(check.detail)}</span>
  </article>`;
}

function render(dashboard: Dashboard) {
  writeForm(dashboard.config);
  $("#platform").textContent = dashboard.platform;
  $("#config-path").textContent = dashboard.config_path;
  $("#checks").innerHTML = [
    checkCard("Moonlight", dashboard.checks.moonlight),
    checkCard("SSH client", dashboard.checks.ssh),
    checkCard("Receiver Omarchy", dashboard.checks.guest_receiver),
    checkCard("Automazione client", dashboard.checks.setup),
  ].join("");
}

async function refresh() {
  setMessage("Verifica in corso…");
  try {
    const dashboard = await invoke<Dashboard>("inspect_setup");
    render(dashboard);
    setMessage("Verifica completata.", "ok");
  } catch (error) {
    setMessage(String(error), "error");
  }
}

async function save() {
  try {
    const path = await invoke<string>("save_config", { config: readForm() });
    $("#config-path").textContent = path;
    setMessage("Configurazione salvata localmente. Nessuna password viene memorizzata.", "ok");
  } catch (error) {
    setMessage(String(error), "error");
  }
}

async function launchMoonlight() {
  try {
    await invoke("launch_moonlight");
    setMessage("Moonlight avviato.", "ok");
  } catch (error) {
    setMessage(String(error), "error");
  }
}

async function configureClient() {
  try {
    await save();
    const detail = await invoke<string>("run_setup_in_terminal");
    setMessage(detail, "ok");
  } catch (error) {
    setMessage(String(error), "error");
  }
}

$("#app").innerHTML = `
  <main>
    <header>
      <div><p class="eyebrow">REMOTE DESKTOP CONTROL PLANE</p><h1>Omarchy Control</h1></div>
      <div class="platform"><span>Platform</span><strong id="platform">…</strong></div>
    </header>
    <section class="hero">
      <div><h2>Un solo pannello, tre confini chiari.</h2><p>Client locale, VM Omarchy e nodo PVE restano separati. Questa app prepara il client, verifica il receiver nella VM e apre Moonlight senza memorizzare credenziali.</p></div>
      <div class="actions"><button id="refresh" class="secondary">Verifica</button><button id="moonlight">Apri Moonlight</button></div>
    </section>
    <section id="checks" class="checks" aria-live="polite"></section>
    <section class="grid">
      <form class="panel" onsubmit="return false">
        <div class="panel-heading"><div><p class="eyebrow">CONFIGURAZIONE</p><h2>Connessione Omarchy</h2></div><span class="file" id="config-path">…</span></div>
        <div class="fields">
          <label>Host o IP SSH VM<input name="vm_host" placeholder="omarchy.local" /></label>
          <label>IP LAN VM<input name="vm_address" placeholder="192.168.x.x" /></label>
          <label>Utente VM<input name="user" placeholder="utente" /></label>
          <label>IP di questo client<input name="client_address" placeholder="192.168.x.x" /></label>
          <label>Porta RTP<input name="rtp_port" inputmode="numeric" /></label>
          <label>Microfono Windows<input name="microphone" placeholder="necessario su Windows" /></label>
          <label>Sorgente PipeWire Fedora<input name="fedora_source" /></label>
        </div>
        <div class="form-actions"><button id="save" class="secondary">Salva localmente</button><button id="configure">Configura questo client</button></div>
      </form>
      <aside class="panel guide">
        <p class="eyebrow">COME FUNZIONA</p>
        <h2>Privilegi e password restano visibili.</h2>
        <ol><li>L’app salva soltanto indirizzi e preferenze nel profilo locale.</li><li>Per setup, SSH e sudo apre il terminale nativo: la password non passa nella GUI né su disco.</li><li>Il terminale esegue gli script versionati e poi puoi tornare qui per verificare.</li></ol>
        <p class="muted">Windows e Fedora eseguono l’automazione già inclusa nella repository. macOS può verificare e avviare Moonlight, ma non ha ancora un adapter microfono RTP: l’app lo dichiara esplicitamente, senza fingere che sia configurato.</p>
      </aside>
    </section>
    <div id="message" data-level="info" role="status">Pronto.</div>
  </main>`;

$("#save").addEventListener("click", () => void save());
$("#refresh").addEventListener("click", () => void refresh());
$("#moonlight").addEventListener("click", () => void launchMoonlight());
$("#configure").addEventListener("click", () => void configureClient());

void refresh();
