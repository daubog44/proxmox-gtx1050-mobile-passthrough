import type { GpuTelemetry, StorageTelemetry } from "../types";
import { Icons } from "./ui/icons";

export function renderTelemetryWidget(
  telemetry: GpuTelemetry,
  _wolfOnline: boolean,
  storage?: StorageTelemetry,
): string {
  const tel = telemetry && telemetry.available ? telemetry : {
    available: false,
    name: "NVIDIA GeForce GTX 1050 Mobile",
    driver_version: "--",
    gpu_utilization_pct: 0,
    memory_used_mb: 0,
    memory_total_mb: 4096,
    memory_free_mb: 4096,
    temperature_c: 0,
    encoder_sessions_count: 0,
    vram_status: "ok" as const,
    cpu_utilization_pct: 0,
    ram_used_mb: 0,
    ram_total_mb: 16384,
  };

  const vramPercent = tel.available && tel.memory_total_mb > 0
    ? Math.min(100, Math.round((tel.memory_used_mb / tel.memory_total_mb) * 100))
    : 0;

  const vramBarColor = !tel.available
    ? "bg-zinc-700"
    : vramPercent > 85
      ? "bg-rose-500"
      : vramPercent > 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  const cpuPct = tel.available ? (tel.cpu_utilization_pct ?? 0) : 0;
  const ramUsedGb = tel.available ? (Math.round(((tel.ram_used_mb ?? 0) / 1024) * 10) / 10) : 0;
  const ramTotalGb = Math.round(((tel.ram_total_mb || 16384) / 1024));
  const ramPercent = tel.available && ramTotalGb > 0
    ? Math.min(100, Math.round((ramUsedGb / ramTotalGb) * 100))
    : 0;

  const nasMounted = Boolean(storage?.nas_mounted);
  const recordingsMb = storage?.recordings_mb ?? 0;
  const recordingsCount = storage?.recordings_count ?? 0;
  const nasFreeGb = storage?.nas_free_gb ?? 0;
  const nasTotalGb = storage?.nas_total_gb ?? 0;
  const nasUsedGb = Math.max(0, Math.round((nasTotalGb - nasFreeGb) * 10) / 10);
  const quotaPercent = nasTotalGb > 0
    ? Math.min(100, Math.max(0, Math.round(((nasTotalGb - nasFreeGb) / nasTotalGb) * 100)))
    : 0;

  return `
    <div class="space-y-6">
      ${!tel.available ? `
        <div class="bg-amber-950/20 border border-amber-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              ${Icons.key("w-4 h-4")}
            </div>
            <div>
              <div class="text-sm font-semibold text-amber-300">Connessione SSH non autenticata</div>
              <div class="text-xs text-zinc-400 mt-0.5">
                Il server risponde in rete. Inserisci le credenziali SSH per abilitare la telemetria live della GPU GTX 1050.
              </div>
            </div>
          </div>
          <button
            type="button"
            id="btn-open-ssh-prompt"
            class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold shrink-0 shadow-sm transition flex items-center gap-2 cursor-pointer"
          >
            ${Icons.key("w-3.5 h-3.5")}
            <span>Inserisci Password SSH</span>
          </button>
        </div>
      ` : ''}

      <!-- 4 Stat Cards Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        
        <!-- Card 1: VRAM GPU -->
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">VRAM Dedicata</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-medium ${tel.available ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'}">
              ${tel.available ? `${vramPercent}%` : 'Standby'}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold font-mono text-zinc-100">${tel.available ? tel.memory_used_mb : '--'}</span>
              <span class="text-xs text-zinc-400 font-medium">MB</span>
            </div>
            <div class="text-xs text-zinc-400 mt-1">Capacità totale 4096 MB</div>
          </div>

          <div class="space-y-2 pt-2 border-t border-zinc-800/60">
            <div class="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div class="h-full ${vramBarColor} rounded-full transition-all duration-500" style="width: ${vramPercent}%"></div>
            </div>
            <div class="flex justify-between text-[11px] text-zinc-400 pt-1">
              <span>Libera</span>
              <span class="font-mono text-zinc-300 font-medium">${tel.available ? `${tel.memory_free_mb} MB` : '--'}</span>
            </div>
          </div>
        </div>

        <!-- Card 2: GPU & NVENC Encoder -->
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">GPU & Encoder</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-medium ${tel.encoder_sessions_count > 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'}">
              ${tel.encoder_sessions_count > 0 ? `1 Flusso Attivo` : 'Inattivo'}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold font-mono text-zinc-100">${tel.available ? `${tel.gpu_utilization_pct}%` : '--'}</span>
              <span class="text-xs text-zinc-400 font-medium">Carico GPU</span>
            </div>
            <div class="text-xs text-zinc-400 mt-1">
              ${tel.available && tel.temperature_c > 0 ? `Temperatura ${tel.temperature_c}°C` : 'GTX 1050 Mobile'}
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-800/60 text-center">
            <div>
              <div class="text-[10px] uppercase text-zinc-400 font-medium">Stream</div>
              <div class="text-xs font-bold font-mono text-zinc-200 mt-0.5">${tel.available ? tel.encoder_sessions_count : '--'}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-zinc-400 font-medium">Temp</div>
              <div class="text-xs font-bold font-mono text-zinc-200 mt-0.5">${tel.available && tel.temperature_c > 0 ? `${tel.temperature_c}°C` : '--'}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase text-zinc-400 font-medium">Driver</div>
              <div class="text-xs font-mono text-zinc-300 mt-0.5 truncate" title="${tel.driver_version}">${tel.driver_version}</div>
            </div>
          </div>
        </div>

        <!-- Card 3: CPU & RAM Host -->
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">CPU & Memoria</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-medium ${tel.available ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-zinc-800 text-zinc-400'}">
              ${tel.available ? `CPU ${cpuPct}%` : 'Standby'}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold font-mono text-zinc-100">${tel.available ? ramUsedGb : '--'}</span>
              <span class="text-xs text-zinc-400 font-medium">/ ${ramTotalGb} GB</span>
            </div>
            <div class="text-xs text-zinc-400 mt-1">Memoria di sistema Linux</div>
          </div>

          <div class="space-y-2 pt-2 border-t border-zinc-800/60">
            <div class="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div class="h-full bg-blue-500 rounded-full transition-all duration-500" style="width: ${ramPercent}%"></div>
            </div>
            <div class="flex justify-between text-[11px] text-zinc-400 pt-1">
              <span>RAM utilizzata</span>
              <span class="font-mono text-zinc-300 font-medium">${ramPercent}%</span>
            </div>
          </div>
        </div>

        <!-- Card 4: NAS Samba Storage -->
        <div class="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-zinc-700/80 transition">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Storage NAS</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full font-medium ${nasMounted ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}">
              ${nasMounted ? 'Connesso' : 'Non Montato'}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-baseline gap-1.5">
              <span class="text-2xl font-bold font-mono text-zinc-100">${recordingsMb > 0 ? Math.round(recordingsMb) : '0'}</span>
              <span class="text-xs text-zinc-400 font-medium">MB</span>
            </div>
            <div class="text-xs text-zinc-400 mt-1">${recordingsCount} registrazioni archiviate</div>
          </div>

          <div class="space-y-2 pt-2 border-t border-zinc-800/60">
            <div class="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500 rounded-full transition-all duration-500" style="width: ${quotaPercent}%"></div>
            </div>
            <div class="flex justify-between text-[11px] text-zinc-400 pt-1">
              <span>Quota usata</span>
              <span class="font-mono text-zinc-300 font-medium">${nasTotalGb > 0 ? `${nasUsedGb} / ${nasTotalGb} GB` : '--'}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}
