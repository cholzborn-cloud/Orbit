Ziel: Orbit-Mac-App erst stabilisieren (Block 4h), dann Schritt 5 (Einzug) bauen.
Lies AGENTS.md, plan/CONVENTIONS.md, plan/MAC-UMBAU.md (Schritt 5), plan/API.md, plan/PARITY.md.
Sichere zuerst die Liste unten unverändert in plan/4H-AUFTRAG.md. Ein Commit je Punkt, baut einzeln. Kein Punkt gilt als fertig ohne Beleg (Selbsttest oder Screen Dunkel/Hell).

TEIL 1: Fehler (Consti hat sie beim Testen gefunden)
1. Jev-Modellwahl wählen: App stürzt ab. Ursache finden (Crash-Log). Danach: Jev funktioniert gar nicht, Entscheidung und Jev-Block im Chat müssen wie im Web laufen.
2. Kopfleiste: der Verlauf hinter der Orbi-Figur reicht oben nicht durchgängig bis zum Fensterrand.
3. Orbi-Figuren: Design 1:1 wie im Web (public/orbis, Maße per Messung gegen die Web-UI, nicht schätzen).
4. Nach einem Handoff zeigen Nepi und Marsi „arbeitet“, obwohl sie warten. Zustand aus /v1/events prüfen (waiting sendet der Dienst nicht, siehe API.md), Zustand korrekt ableiten.
5. Reiter/Eintrag „Computer“ gehört in der Seitenleiste nach oben, nicht in die Mitte.
6. Rechte Seitenleiste (Panel) öffnen: Avatar oben im Chat springt/bugt. Layout stabil halten.
7. Kopf-Avatar beim Scrollen: lässt man in der Mitte los, muss er in einen der beiden Zustände (groß/klein) einrasten, nie dazwischen stehen bleiben.
8. Orbis können keine Automationen anlegen: Werkzeug/Berechtigung prüfen und beheben, mit Test (Orbi legt an, erscheint in Geplant).
9. Neue Nachricht senden: automatisch zum neuesten Punkt scrollen. Hochgescrollt: Knopf „nach ganz unten“.
10. Rückfrage-/Frage-Menü ist verbuggt: reproduzieren, beheben, alle Varianten (Einzel, Mehrfach, eigener Text, Überspringen) testen.
11. Geplant-Seite: Orbi-Farbe weicht von der gewählten ab. Überall dieselbe Farbquelle (AccentStore).
12. Automation starten („Jetzt ausführen“): der Lauf erscheint nicht im Chat. Sichtbar machen, live und im Verlauf.
Danach: --selftest, -chat, -orbis, -karten render, -composer, -einstellungen, -geplant, -suche, -desktop, Unit-Tests, npm run check, Xcode ohne Warnungen.

TEIL 2: Schritt 5 (ohne Aufräumen)
Aufgaben 1–5 aus MAC-UMBAU.md: esbuild-Bündel des Dienstes mit better-sqlite3, Node-Laufzeit im App-Bundle, LaunchAgent (launchctl bootstrap, kein SMAppService), Signierung mit dem vorhandenen Zertifikat (de.consti.orbit2, Hash unverändert lassen), secrets.env (0600) einlesen, Menüleisten-Symbol mit Orbi-Status, Mitteilungen über /v1/events (Freigaben Einmal/Immer/Ablehnen, Automationen). Installation nach /Applications per Skript scripts/install.sh. Schlüssel nie lesen oder ausgeben.
Fertig: Dienst läuft ohne offene App und nach Neustart; Aufgabe überlebt App-Schließen; Automation meldet sich bei geschlossenem Fenster; verpasste Läufe nach Ruhezustand werden nachgeholt; App startet über Dock/Spotlight.

STOPP vor Aufgabe 6–9 (Umschalten auf main, Aufräumen, Konten, Review): erst Bericht, dann auf Constis „Start“ warten. Nichts löschen.
Vor jedem Commit git status auf iCloud-Konfliktkopien („Orbit N.xcodeproj“) prüfen.
Ende: Ergebnis je Punkt 1–12 und je Schritt-5-Aufgabe, plus OFFEN-Zeilen. Dokumentation in plan/STATUS.md.

NACHTRAG (Consti, 26.10.2026, mitten im Lauf): 13. Komplett neues App-Icon entwerfen und in die Mac-App einsetzen.

14. (Consti, 26.10.2026) Automationen bekommen im Chat eine eigene Karte (Lauf-Karte), nicht mehr als normale Nutzerblase "[[automation:Name]] ..." wie ein Chat. Gehört zu Punkt 12.

15. (Consti, 26.10.2026) Oben über dem Kopf scheint der Chat hinter dem Schwarzen durch: soll weg (gehört zu Punkt 2).
