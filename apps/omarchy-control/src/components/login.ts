const FIELD = "w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-zinc-100 text-sm outline-none transition";

export function renderLoginScreen(): string {
  return `
    <div id="login-container" class="min-h-screen w-full bg-zinc-950 flex items-center justify-center p-4">
      <div class="card max-w-xs w-full !p-7">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold">O</div>
          <h2 class="text-base font-semibold text-zinc-100">Omarchy Control</h2>
        </div>

        <form id="login-form" class="space-y-3">
          <div id="login-error-banner" class="hidden text-xs text-red-300" role="alert">
            <span id="login-error-text">Credenziali non valide</span>
          </div>
          <input type="text" id="login-username" name="username" required value="admin" autocomplete="username" aria-label="Utente" class="${FIELD}" />
          <div class="relative">
            <input type="password" id="login-password" name="password" required placeholder="Password" autocomplete="current-password" aria-label="Password" class="${FIELD} pr-10" autofocus />
            <button type="button" id="btn-toggle-pwd" class="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300" title="Mostra password" aria-label="Mostra password">👁️</button>
          </div>
          <button type="submit" id="btn-login-submit" class="btn-primary w-full !h-10">Accedi</button>
        </form>
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

        <p class="text-xs text-zinc-400 mb-5">Password dell'utente <strong class="text-zinc-200">admin</strong> su questo computer.</p>

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
