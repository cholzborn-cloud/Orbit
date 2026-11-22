# Avatar-Lab: Engine, Animationen, Web-App

Quelle: github.com/smontlouis/bible-strong-avatar-lab (MIT). Alles läuft mit Nodes eingebautem TypeScript (`run.sh`), ohne Installation.

- `avatar-defs.ts`: die 15 Avatare (10 Vorlagen, 5 Grundformen; Augenabstand von Cloudee und Cubee angepasst).
- `animations.ts`: eigene Animationen (7 Zustände × 5+ Varianten).
- `build-animationen.ts`: baut die Web-App `avatar-animationen.html` und (mit `OUT_SWIFT`) die Daten der Mac-App
  `Orbit/Figures/AvatarAnimData.swift` (Engine-Quelltext des Labs als JavaScript plus Ausdrücke und Abläufe der verwendeten Animationen).

Neu bauen (Repo klonen, Pfad als LAB):

```
LAB=<repo> OUT_HTML=$PWD/avatar-animationen.html OUT_SWIFT=$PWD/../../Orbit/Figures/AvatarAnimData.swift ./run.sh build-animationen.ts
```

Welche Animation in der App zu welchem Zustand gehört: `Orbit/Figures/AvatarPlayer.swift` (`AvatarProgram.make`); verwendete Animationen: `USED` in `build-animationen.ts`.
