---
tags: [orbit, mac, 4c]
status: erledigt (25.10.2026, Nachweis in STATUS.md)
date: 2026-10-25
herkunft: Auftrag von Consti, 25.10.2026 (im Chat), sinngemäß gesichert
---
# Block 4c: Composer komplett (Auftrag)

Optik pixelnah wie Web-UI (Referenz), Werte aus DESIGN-MAP.md/Theme.swift, keine neuen Hex-Werte, Web-Screen neben nativ in plan/screens/, 4g-Knopfsatz. Jeder Zustand gestaltet, deutsch, Fehler nie still. Ein Commit je Teil, baut einzeln. Nachweis in STATUS.md. Nicht in 4c: Einstellungen (4d), Geplant/Suche/Daytona (4e).

1. Slash-Menü (Skills Marktplatz + eigene, Filter, Pfeile, Enter, Chip im Composer und in der Nachricht).
2. Modellwahl inkl. Auto (Jev), Stufen, Standard je Orbi, aktives Modell sichtbar.
3. Freigabe-Modi: allow_all, auto, ask, plan (nach Plan: ausführen und auf Auto oder überarbeiten). Geld, Senden in Constis Namen, Veröffentlichen, endgültig Löschen bleiben immer freigabepflichtig; Jev entscheidet keine Freigaben.
4. Anhänge: Drag & Drop, Büroklammer, Cmd+V (Bild, PDF, Text), Vorschau, Entfernen, Grenzen wie Web, klarer Fehler.
5. Tastatur: Enter sendet, Shift+Enter Umbruch, Esc stoppt.
6. Sonderfälle: Proxy aus, Jev aus, Dienst offline, klein/groß, Dunkel/Hell, sehr langer Text, Anhang zu groß.
7. `--selftest-composer`: Slash-Auswahl, Modell-/Moduswechsel, Anhang senden gegen Testkopie, JSON, Exit 0/1.
8. `--selftest-layout` unabhängig von echten Chats: fester Seed (Nachrichten, ein Bild, eine Karte) in der Testkopie; Web und nativ messen denselben Chat; Messung einmal komplett, Abweichungen nennen.

Fertig: Selbsttest und alle bisherigen grün, Screens Web neben nativ, Tastatur per Eingabetest belegt oder als nicht belegt benannt.
