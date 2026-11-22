import { accountStatus } from "./tauri";
import { getPlugins } from "./api";
import { clis, macZugriff } from "../features/onboarding/dienst";

// Beim App-Start vorladen: Programme, Konto, Mac-Rechte, Plugins samt Logos. Die Seiten des Erststarts holen sich
// die fertigen (oder laufenden) Antworten hier ab, statt erst beim Öffnen zu laden. Ohne `startVorladen` (Tests) wird nichts gemerkt.

let aktiv = false;
const speicher = new Map<string, { t: number; p: Promise<unknown> }>();

export function vorgeladen<T>(key: string, laden: () => Promise<T>, maxAlterMs = 90_000): Promise<T> {
  if (!aktiv) return laden();
  const e = speicher.get(key);
  if (e && Date.now() - e.t < maxAlterMs) return e.p as Promise<T>;
  const p = laden();
  speicher.set(key, { t: Date.now(), p });
  p.catch(() => { if (speicher.get(key)?.p === p) speicher.delete(key); });
  return p;
}

export function startVorladen(): void {
  aktiv = true;
  void vorgeladen("clis", () => clis(false)).catch(() => {});
  void vorgeladen("konto", () => accountStatus()).catch(() => {});
  void vorgeladen("mac", () => macZugriff()).catch(() => {});
  void vorgeladen("plugins", () => getPlugins({ limit: 100 })).then((r) => {
    for (const e of r.entries ?? []) if (e.logoUrl) { const bild = new Image(); bild.src = e.logoUrl; } // Logos in den Bildspeicher holen
  }).catch(() => {});
}
