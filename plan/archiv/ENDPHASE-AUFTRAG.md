# Endphase-Auftrag: Figma-Einbau (F2) in die Mac-App

Auftrag von Consti, 02.11.2026: Alle geplanten Phasen vollständig in der bestehenden App umsetzen, besonders das Figma-Design **pixelgenau 1:1**: Layout, Farben, Typografie, Abstände, Animationen, Übergänge, Interaktionen. Keine eigenmächtigen Vereinfachungen oder Abweichungen. Bestehende Funktionen bleiben erhalten.

## Pflichtlektüre (in dieser Reihenfolge)
1. `AGENTS.md`, `CODING.md` (Regeln: nur lokal committen, kein Push, keine E-Mail-Adresse in Commits, Warnungen sind Fehler).
2. `plan/DESIGN-SYSTEM.md` (maßgeblich, Werte, Zustände, Bildschirme) und die Bilder in `plan/design/` (Pixelvorlagen; Bildschirme in `05-bildschirme/`, Karten `04-schritt4-karten/`, Animationen `08-animationen/`, Posen `07-posen/`, Onboarding `06-onboarding/`), dazu `plan/design/tokens.dtcg.json`, `variablen-vollstaendig.json`, `plan/AVATAR-ANIMATIONEN.md`.
3. Brain-Notiz `~/Projekte-Coding/Second Brain/02 Projekte/Orbit/App-Anpassungen aus Endcheck.md` (offene Punkte P11–P15, F19–F21, Augen, Karten) und `Umsetzungsplan Orbit.md` Abschnitt „Endphase“.

## Aufgaben
1. `mac/Orbit/Theme/Theme.swift` exakt auf die Figma-Variablen (hell/dunkel, 15 Orbi-Farben `orbi/*`, `orbi-bubble/*`, `orbi-auge`, Radien, Abstände, Schriftskala, Bewegungszeiten/Kurven) bringen. Danach **keine festen Werte** (Hex, Zahlen für Abstand/Radius/Schrift/Dauer) mehr in Views: per Suche nachweisen.
2. Offene App-Punkte: P11 Farben (`BotEditorModel.colorPresets`, `OrbiLook`, Beispiel-Orbis Palette v3), P12 „Limit“ → „Pausiert, wartet“ (alle Stellen inkl. Einstellungen), P13 „⌘K“-Anzeige entfernen (Kürzel bleibt), P14 Seitenleiste wie „Schritt 3 – final“ (kein „Geplant“, keine Überschriften, Chats und Gruppen in einer Liste, Hauptorbi ohne Kasten, Routinen nur im rechten Panel), P15 Status blau (ausgeklappt Punkt rechts, eingeklappt am Orbi, orangenes Abzeichen weg), F19 Link-Karte, F20 Neues-Orbi-Menü (Reiter Form/Personalisieren, Warnung „Neuer Hauptorbi?“), F21 Rest (Zeitstempel-Trennzeilen, Umbenennen in der Zeile, Filter-Chips der Bibliothek), Augen (`orbi-auge`: hell weiß, dunkel dunkel).
3. Fehlende Karten: Freigabe in Gruppen (neutrale Knopffarben), Fehler-Karte, Automation-Karte, Systemhinweis „Unterbrochen – Weiter“ und „Nochmal“-Knopf. Der Dienst (`service/`, `lib/`) liefert dafür bisher nur Text: bei Bedarf strukturierte Felder ergänzen (`plan/API.md` mitpflegen), Tests dazu.
4. Alle Bildschirme (Einzelchat, Gruppenchat, Start, eingeklappte Seitenleiste, Erststart, Onboarding, Einstellungen, Dialoge, Menüs, Panels) gegen die Bilder prüfen und angleichen; Animationen und Übergänge wie in `08-animationen/` und `AVATAR-ANIMATIONEN.md`.
5. Keine Tastenkürzel-Anzeigen, kein Wort „Limit“, keine sichtbaren Werkzeuge im Chat.

## Prüfen (einmal gezielt, kein Testlauf-Serien)
- `npm run check` im Repo muss grün bleiben (Basis laut Phase 5: 354 + 200).
- Mac: `mac/scripts/build.sh` ohne Warnungen; `xcodebuild test` (unsigniert, Basis 138 Tests, 0 Fehler) – neue Tests für neue Modelle/Karten ergänzen.
- Suche nach festen Werten in `mac/Orbit/Views` und `Orbis` leer (Beleg im Bericht).
- **Nichts installieren, LaunchAgent nicht anfassen, keine echte Datenbank/Secrets anfassen** (Claude installiert danach selbst). Test-Kopien unsichtbar, keine Dock-Symbole, nichts liegen lassen.
- Pixelvergleich: Bildschirmfotos der gebauten App (unsichtbar/headless, Attrappen-Daten) neben den Figma-Bildern ablegen unter `plan/design/abnahme/` und Abweichungen ehrlich auflisten.

## Abgabe
Lokal committen (kleine Commits), `plan/STATUS.md` mit Ergebnis, Messwerten, Nicht geprüftem ergänzen. Bericht: was umgesetzt, was getestet, welche Abweichungen/Reste bleiben. Backup liegt unter `~/Projekte-Coding/Backups/Orbit/endphase_2026-11-02_22-55*`.
