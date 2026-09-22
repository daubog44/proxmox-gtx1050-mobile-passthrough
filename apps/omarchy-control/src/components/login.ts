export function renderLoginScreen(): string {
  return `
    <div id="login-container" class="min-h-screen w-full bg-zinc-950 flex items-center justify-center p-4">
      <div class="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl max-w-md w-full p-8 relative overflow-hidden animate-in fade-in duration-300">
        
        <!-- Glow accent -->
        <div class="absolute -top-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div class="flex items-center gap-3.5 mb-6">
          <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-black text-xl shadow-inner">
            O
          </div>
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Control Plane</div>
            <h2 class="text-xl font-bold text-zinc-100">Omarchy Workstation</h2>
          </div>
        </div>

        <p class="text-xs text-zinc-400 mb-6 leading-relaxed">
          Inserisci le credenziali di accesso per monitorare l'hardware, gestire i client Moonlight e configurare la rete mesh.
        </p>

        <form id="login-form" class="space-y-4">
          <div id="login-error-banner" class="hidden p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-xs text-red-300 flex items-center gap-2" role="alert">
            <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
            <span id="login-error-text">Credenziali non valide</span>
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-400 mb-1" for="login-username">Username</label>
            <input 
              type="text" 
              id="login-username" 
              name="username" 
              required 
              value="admin" 
              placeholder="admin" 
              autocomplete="username" 
              class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-zinc-100 text-xs outline-none transition"
              autofocus 
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-400 mb-1" for="login-password">Password Console</label>
            <div class="relative">
              <input 
                type="password" 
                id="login-password" 
                name="password" 
                required 
                placeholder="Password di sicurezza" 
                autocomplete="current-password" 
                class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl pl-3.5 pr-10 py-2.5 text-zinc-100 text-xs outline-none transition"
              />
              <button 
                type="button" 
                id="btn-toggle-pwd" 
                class="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300 transition" 
                title="Mostra / Nascondi password"
              >
                👁️
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            id="btn-login-submit"
            class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition flex items-center justify-center gap-2 cursor-pointer mt-2"
          >
            <span>🔓</span>
            <span>Accedi al Pannello</span>
          </button>
        </form>

        <div class="mt-6 pt-4 border-t border-zinc-800/80 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Sessione cifrata SHA-256 e crittografia AES-256</span>
        </div>

      </div>
      <div id="toast-container" class="toast-container" aria-live="polite"></div>
    </div>
  `;
}

/**
 * First launch (or a legacy record from <= 0.3.0): the admin chooses the
 * console password. There is no built-in default password.
 */
export function renderSetupScreen(minLength: number): string {
  return `
    <div id="login-container" class="min-h-screen w-full bg-zinc-950 flex items-center justify-center p-4">
      <div class="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div class="flex items-center gap-3.5 mb-6">
          <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-black text-xl">O</div>
          <div>
            <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Primo avvio</div>
            <h2 class="text-xl font-bold text-zinc-100">Imposta la password</h2>
          </div>
        </div>

        <p class="text-xs text-zinc-400 mb-6 leading-relaxed">
          Scegli la password dell'account <strong class="text-zinc-200">admin</strong> per questo computer.
          Non esiste una password predefinita: servirà a ogni accesso al pannello.
        </p>

        <form id="setup-form" class="space-y-4">
          <div id="setup-error-banner" class="hidden p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-xs text-red-300" role="alert">
            <span id="setup-error-text"></span>
          </div>
          <div>
            <label class="block text-xs font-medium text-zinc-400 mb-1" for="setup-password">Nuova password (almeno ${minLength} caratteri)</label>
            <input type="password" id="setup-password" required minlength="${minLength}" autocomplete="new-password" autofocus
              class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-zinc-100 text-xs outline-none transition" />
          </div>
          <div>
            <label class="block text-xs font-medium text-zinc-400 mb-1" for="setup-password-confirm">Ripeti la password</label>
            <input type="password" id="setup-password-confirm" required minlength="${minLength}" autocomplete="new-password"
              class="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-zinc-100 text-xs outline-none transition" />
          </div>
          <button type="submit" id="btn-setup-submit"
            class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer mt-2">
            Salva e accedi
          </button>
        </form>
      </div>
      <div id="toast-container" class="toast-container" aria-live="polite"></div>
    </div>
  `;
}
