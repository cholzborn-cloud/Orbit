// Vorschau des Erststarts mit gespieltem Dienst. Aufruf: npm run dev, dann
// /src/features/onboarding/preview.html?step=start&theme=dark
// weitere: &form=grokbot&farbe=blau (nur Schritt orbi, fertig), &still=1 (ohne CSS-Animationen)
// step: willkommen | start | code | name | modelle | plugins | mac | mac-alle | orbi | fertig
import { createRoot } from "react-dom/client";
import "../../index.css";
import { Onboarding } from "./index";
import { mockDienst } from "./mock";
import { useErststart, type Schritt } from "./store";

const q = new URLSearchParams(location.search);
if (q.get("theme") === "dark") document.documentElement.dataset.theme = "dark";
else if (q.get("theme") === "light") document.documentElement.dataset.theme = "light";

if (q.get("still")) document.head.insertAdjacentHTML("beforeend", "<style>*{animation:none!important}</style>");

const { zustand } = mockDienst();
const step = q.get("step") ?? "willkommen";
const alle = step === "mac-alle";
if (step === "mac" || alle) for (const p of zustand.perms) if (alle || p.id === "accessibility") p.status = "granted";
const schritt = (step === "mac-alle" ? "mac" : step) as Schritt;
useErststart.setState({
  schritt,
  szene: schritt === "start" ? "start" : "mitte",
  email: "name@beispiel.de",
  passwort: "••••••••••",
  code: "4812",
  person: "Consti",
  modelle: { claude: true },
  modelleVorbelegt: true,
  plugins: { Gmail: true, Kalender: true },
  orbiName: schritt === "fertig" ? "Mira" : "",
  form: q.get("form") ?? "strobi",
  farbe: (q.get("farbe") ?? "pink") as never,
  chatId: "neuchat",
});

createRoot(document.getElementById("root")!).render(<Onboarding onDone={() => { document.title = "fertig"; }} />);
