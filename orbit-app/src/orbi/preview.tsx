// Vorschau der Galerie: npm run dev, dann /src/orbi/preview.html öffnen.
import { createRoot } from "react-dom/client";
import { OrbiGallery } from "./OrbiGallery";

createRoot(document.getElementById("root")!).render(<OrbiGallery />);
