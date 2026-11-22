import { useEffect, useState } from "react";
import { useProfilName } from "../../lib/profil";

function leseDunkel(): boolean {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Folgt `data-theme` an <html> und der Systemeinstellung. Die Orbi-Figur braucht den Wert, sie liest kein CSS. */
export function useDark(): boolean {
  const [dunkel, setDunkel] = useState(leseDunkel);
  useEffect(() => {
    const neu = () => setDunkel(leseDunkel());
    const mo = new MutationObserver(neu);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener?.("change", neu);
    neu();
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", neu);
    };
  }, []);
  return dunkel;
}

export function useProfil() {
  const name = useProfilName((s) => s.name);
  const avatarColor = useProfilName((s) => s.avatarColor);
  const avatarFont = useProfilName((s) => s.avatarFont);
  return { kurz: name.split(/\s+/)[0] || "Me", voll: name || "My account", name, avatarColor, avatarFont };
}
