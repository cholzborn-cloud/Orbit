---
tags: [orbit, avatar, animation]
status: umgesetzt und installiert (27.10.2026)
date: 2026-10-26
herkunft: Consti im Chat, 26.10.2026 (Auswahl aus avatar-animationen.html, Interview)
---

# Avatar-Animationen in der Mac-App

> **Ersetzt (03.11.2026):** Maßgeblich wird die neue Liste `plan/ANIMATIONEN-LISTE.md` aus Umbau-Schritt 6 (nach Constis Freigabe). Diese Datei beschreibt den Stand vom 27.10.2026.

Quelle der Animationen: `mac/scripts/avatar-lab/animations.ts` (Web-App `avatar-animationen.html`). Avatare/Umrisse: `mac/scripts/avatar-lab/`.

## Entscheidungen (Consti)
- **Technik:** Lab-Engine 1:1: statt Port läuft ihr JavaScript unverändert in JavaScriptCore (`AvatarEngine.swift`), dieselbe Rechnung wie die Web-App. Ablauf, Zustände und Übergänge in Swift (`AvatarPlayer.swift`).
- **Auswahl fest für alle Orbis** (nicht je Orbi wählbar):

| Zustand | Animation | Besonderheit |
|---|---|---|
| Ruhig, Chat zu | Position 1: Kopf nach rechts geneigt, Blick links oben (`calm-1`-Ruhepose), atmet, blinzelt | statisch bis auf Atmen und Blinzeln |
| Ruhig, Chat offen | `calm-3` „Blick wandert“ (animierter) | |
| Hört zu (tippt) | `listen-1` Kopf schief links | solange Entwurf im Eingabefeld |
| Arbeitet | `work-1` Tippen | |
| Wartet auf dich | `wait-1` Umschauen, nach 30 s `wait-2` Hibbeln | bis Antwort |
| Fertig | `done-1` Hüpfen/Feiern, danach `done-3` Stolz | bleibt, bis der Chat geöffnet wird (nicht mehr 4 s) |
| Limit erreicht | `limit-1` Schlafen | |
| Fehler | `error-1` Kopfschütteln 3× | danach traurig stehen (`error-5`), bis Fehler verfällt (1 Min oder nächstes Ereignis) |

- **Übergänge:** weich überblenden (~0,6 s).
- **Maus:** Augen folgen der Maus nur beim Hovern direkt über dem Orbi; nirgends im Chat links von einer Nachricht. Animation hat sonst Vorrang.
- Reduzierte Bewegung (Systemeinstellung): keine Schleifen, nur Zustandspose.

## Schritte
1. Engine nach Swift (Oberflächen, Kopfdrehung, Silhouette, Augen), Test gegen Lab-Referenz (15 Avatare × mehrere Posen).
2. Ablauf in Swift (Schritte, Übergänge, Blinzeln, Ambient-Bewegung).
3. Zeichnen im Figurenview (Pfade statt SVG), Zubehör/Wangen an die Augen koppeln.
4. Zustandslogik laut Tabelle (Fertig bis Chat geöffnet, Wartet nach 30 s, Fehler 3× dann traurig).
5. Maus nur bei Hover. Test, Bilder, Installation nach Okay.

## Stand 26.10.2026
Umgesetzt und per `--selftest-figuren` (34 Checks) und `xcodebuild test` geprüft. Alte SVG-Figuren, FigureMotion und Generator gelöscht. Offen: Installation (`scripts/install.sh --ohne-start`) nach Constis Okay; Eindruck der Animationen im echten Fenster.
Kosten: ca. 1,7–8 ms CPU je Sekunde Animation bei Wiederholung (erster Durchlauf 5–70 ms), Engine 0,5–10 ms je neuem Bild.
