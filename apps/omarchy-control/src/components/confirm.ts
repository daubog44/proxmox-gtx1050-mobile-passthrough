// window.confirm() returns false at once in the Tauri webview on macOS
// (WKWebView shows no JS dialogs), so destructive actions ask here instead.

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[c] ?? c);
}

export function confirmDialog(message: string, confirmLabel = "Elimina"): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "modal-backdrop";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML = `
      <div class="modal-card max-w-xs">
        <div class="modal-body !pt-5"><p>${escapeHtml(message)}</p></div>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-answer="no">Annulla</button>
          <button type="button" class="btn-primary !bg-red-600 hover:!bg-red-500" data-answer="yes">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (answer: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        done(true);
      }
    };
    root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const answer = target.closest<HTMLElement>("[data-answer]")?.dataset.answer;
      if (answer) done(answer === "yes");
      else if (target === root) done(false);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>('[data-answer="no"]')?.focus();
  });
}
