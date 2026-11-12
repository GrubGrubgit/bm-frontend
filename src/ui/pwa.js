// src/ui/pwa.js -- install prompt wiring. Thin UI only.
export function wireInstall(btn, log) {
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    if (btn) btn.hidden = false;
    if (log) log("install available");
  });
  async function install() {
    if (!deferred) return "unavailable";
    deferred.prompt();
    const r = await deferred.userChoice;
    deferred = null;
    if (btn) btn.hidden = true;
    if (log) log("install " + r.outcome);
    return r.outcome;
  }
  if (btn) btn.addEventListener("click", () => {
    install().catch((e) => { if (log) log("install err " + e.message); });
  });
  window.BM.install = install;
  window.BM.pwa = function () {
    return {
      sw: ("serviceWorker" in navigator),
      controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      installable: !!deferred
    };
  };
}
