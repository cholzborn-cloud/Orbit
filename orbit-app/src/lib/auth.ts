// Anmeldestatus der Hülle (Supabase). App und Einstellungen teilen sich denselben Stand.
import { create } from "zustand";
import { accountSignOut, accountStatus, type KontoInfo } from "./tauri";
import { kontoAktion } from "../features/onboarding/dienst";

interface AuthStand {
  /** null = noch nicht geprüft. */
  signedIn: boolean | null;
  configured: boolean;
  info: KontoInfo | null;
  laden: () => Promise<void>;
  setzen: (info: KontoInfo) => void;
  /** Abmelden in Hülle + Dienst, danach signedIn false. */
  abmelden: () => Promise<void>;
}

export const useAuth = create<AuthStand>((set) => ({
  signedIn: null,
  configured: true,
  info: null,
  setzen: (info) => set({ info, signedIn: info.signedIn, configured: info.configured !== false }),
  laden: async () => {
    try {
      const info = await accountStatus();
      set({ info, signedIn: !!info.signedIn, configured: info.configured !== false });
    } catch {
      // Hülle nicht da (Browser-Tests): als abgemeldet behandeln, außer Tests mocken accountStatus.
      set({ info: null, signedIn: false, configured: true });
    }
  },
  abmelden: async () => {
    try { await accountSignOut(); } catch { /* schon weg */ }
    try { await kontoAktion("logout"); } catch { /* kein Clerk/Supabase-Eintrag */ }
    set({ info: null, signedIn: false });
  },
}));
