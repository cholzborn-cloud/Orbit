# Orbit App – Selbstwissen & Pfade

Dieses Dokument listet die technischen Dateipfade und Einstellungen der Orbit-App auf.

## App-Pfade (macOS)
- **Hauptdaten-Ordner**: `~/Library/Application Support/Orbit/`
- **SQLite-Datenbank**: `~/Library/Application Support/Orbit/orbit.sqlite`
- **Dienst-Token**: `~/Library/Application Support/Orbit/orbitd.token`
- **Schlüsselbund (Keychain)**: Dienstname `de.consti.orbit2` (Zugangsdaten für Drittanbieter wie Composio, Google, Microsoft, Spotify, Nango, Pipedream)
- **Sicherungen & Backups**: `~/Projekte-Coding/Backups/Orbit/`
- **Brain (Obsidian Vault)**: `~/Projekte-Coding/Second Brain/` (Symlink: `~/.second-brain/`)
- **Eigene Skills**: `~/Library/Application Support/Orbit/skills/<bot-id>/`

## App-Einstellungen & Bereiche
1. **Allgemein**:
   - Freigaberegeln (Nie / Immer / Bestätigen)
   - Jev-Schlüssel und Routing-Konfiguration
   - Dienst-Status
2. **Nutzung**:
   - Modell-Kontingente für Claude CLI, Codex CLI und Antigravity
   - 5-Stunden- und 7-Tage-Fenster mit lokalen Rücksetzzeiten
3. **Darstellung**:
   - Theme-Farben, Dark Mode (#121212, Panels #1f1f1f)
   - Layout-Breiten und Schriftgrößen
4. **Orbis**:
   - Liste aller Orbis mit Profil, Aufgabe (Job), Avatar und Farbe
   - Sandbox-Zuweisung
   - Lokales Gedächtnis und Scratchpad
   - Eigene Skills verwalten
5. **Marktplatz**:
   - Drittanbieter-Konnektoren (Google Cloud, Microsoft, Spotify, Nango, Pipedream, Composio)
   - Autorisierungs-Status und Verbindungs-URLs
6. **Einrichtung / Health**:
   - Dienstprüfungen unter `/v1/health` (Proxy, Daytona, Jev, Brain)
