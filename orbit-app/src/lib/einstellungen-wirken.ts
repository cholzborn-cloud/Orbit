/** Wendet Profil-Schalter an, die die Oberfläche selbst ausführen muss (Präsenz, Bewegung, Login). */
import { profilLesen, type Profil } from "../features/onboarding/dienst";
import { apiRequest, setLoginOpen } from "./tauri";

let gestartet = false;
let letzterAktiv: boolean | null = null;

export function bewegungAnwenden(mode: Profil["reducedMotion"] | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "on") root.dataset.motion = "reduce";
  else if (mode === "off") root.dataset.motion = "allow";
  else delete root.dataset.motion;
}

async function praesenz(active: boolean) {
  if (letzterAktiv === active) return;
  letzterAktiv = active;
  try {
    await apiRequest("PUT", "/v1/settings/presence", { active });
  } catch {
    letzterAktiv = null; // beim nächsten Mal erneut versuchen
  }
}

function fensterAktiv(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Nach erfolgreichem Speichern: Login-Item und Bewegung anwenden. */
export async function profilNebenwirkungen(p: Partial<Profil>, vorher?: Profil | null) {
  if (p.reducedMotion !== undefined) bewegungAnwenden(p.reducedMotion);
  if (p.loginOpen !== undefined && p.loginOpen !== vorher?.loginOpen) {
    try {
      await setLoginOpen(p.loginOpen);
    } catch {
      // Hülle fehlt (Browser-Dev): Schalter bleibt im Profil, Wirkung beim nächsten App-Start.
    }
  }
}

/** Einmal beim App-Start: Präsenz melden, Bewegung und Login-Schalter mit dem Dienst abgleichen. */
export function starteEinstellungsWirkung() {
  if (gestartet || typeof window === "undefined") return;
  gestartet = true;

  const melden = () => { void praesenz(fensterAktiv()); };
  melden();
  window.addEventListener("focus", melden);
  window.addEventListener("blur", melden);
  document.addEventListener("visibilitychange", melden);
  window.addEventListener("beforeunload", () => { void praesenz(false); });

  void profilLesen()
    .then(async (r) => {
      const p = r.profile;
      bewegungAnwenden(p.reducedMotion);
      try {
        await setLoginOpen(!!p.loginOpen);
      } catch { /* Browser / Dev ohne Hülle */ }
    })
    .catch(() => {});
}
