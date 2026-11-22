// Vorschau der Einstellungen mit gespieltem Dienst. Aufruf:
// /src/features/einstellungen/preview.html?page=plugins&plugin=gmail&theme=dark
// page: allgemein | darstellung | personalisierung | plugins | nutzung | arbeitsumgebung | sicherheit
// weitere: tab=verbunden, einheit=euro, zeitraum=month, still=1 (ohne Animationen)
import { createRoot } from "react-dom/client";
import "../../index.css";
import { useNav } from "../../lib/nav";
import { useOrbit } from "../../lib/store";
import { mockDienst, BOTS } from "../onboarding/mock";
import { SettingsView } from "./index";
import { useEinst } from "./store";

const q = new URLSearchParams(location.search);
if (q.get("theme") === "dark" || q.get("theme") === "light") document.documentElement.dataset.theme = q.get("theme")!;
if (q.get("still")) document.head.insertAdjacentHTML("beforeend", "<style>*{animation:none!important;transition:none!important}</style>");

const { zustand } = mockDienst();
zustand.konto.phase = "done";
zustand.konto.mode = "clerk";
zustand.konto.email = "name@beispiel.de";
zustand.theme = q.get("theme") === "dark" ? "dark" : "light";
zustand.instructions = "Antworte auf Deutsch, kurz und einfach. Frag nach, bevor du etwas in meinem Namen sendest.";
for (const p of zustand.perms) if (["accessibility", "screen", "full_disk"].includes(p.id)) p.status = "granted";
zustand.macAn = true;
zustand.clis[3].state = "abgemeldet";
useOrbit.setState({ bots: BOTS as never, bereit: true });
useEinst.setState({ tab: q.get("tab") === "verbunden" ? "verbunden" : "alle", einheit: q.get("einheit") === "euro" ? "euro" : "tokens", zeitraum: q.get("zeitraum") === "month" ? "month" : "week" });

const page = q.get("page") ?? "allgemein";
const pluginId = q.get("plugin") ?? undefined;
useNav.setState({ main: { kind: "einstellungen", page, pluginId } });

function Wurzel() {
  const main = useNav((s) => s.main);
  return main.kind === "einstellungen" ? <SettingsView page={main.page} pluginId={main.pluginId} /> : <div className="p-8 text-o-text">Chat (Vorschau)</div>;
}
createRoot(document.getElementById("root")!).render(<Wurzel />);
