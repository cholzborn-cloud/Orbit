# Offen und Abweichungen (Erststart, Einstellungen)

- Keine Augenformen und kein Zubehör: der Erststart bietet beides nicht an und schickt beim Anlegen kein `look` (nur Figur, Farbe, Name).
- Konto (Schritt 1): läuft über Supabase Auth in der Hülle (`account_*`, src-tauri/src/account.rs). Nach dem Login meldet die Hülle die UID per `POST /v1/setup/account/supabase`. Clerk bleibt nur optional im Dienst. E-Mail-Bestätigung kommt von Supabase (Link); `CodeSchritt` ist ungenutzt. Ohne `supabase.config.json` (Anleitung: src-tauri/SUPABASE-EINRICHTEN.md) bietet die Karte „Ohne Konto fortfahren“.
- Daytona/Jev: eigener Erststart-Schritt `dienste` (nach Programme), gleiche Felder unter Einstellungen → Workspace. Schlüssel via `PUT /v1/keys/{name}`.
- Mac-Schritt: „Mitteilungen“ hat im Dienst kein Recht, es schaltet nur die Profil-Einstellungen für Mitteilungen. „Dateien“ (Festplattenvollzugriff) lässt sich nicht anfragen, der Text des Dienstes erklärt den Weg.
- Erster Orbi: der Dienst verlangt eine Aufgabe, der Erststart sendet fest „Dein erster Ansprechpartner“. Der Vorstellungs-Zug nach „Chat öffnen“ ist Sache des Chats (`onboardingDone` ist false).
- Form-Auswahl hat 14 Formen wie in Figma (ohne Dosi).

## Einstellungen
- Nutzung: kein Plan-Chip („Max“, „Plus“), weil `/v1/usage` keinen Plan liefert. Euro nur mit `ORBIT_USD_PER_EUR`; der Budget-Hinweis nennt US-Dollar, weil der Dienst Dollar führt.
- Plugin-Detail: `/accounts` liefert nur ID und Status, darum „Konto 1, Konto 2“ statt „Verbunden als …“. Werkzeug-Status („Erlaubt“/„Immer fragen“) ist aus `readOnly` abgeleitet und nicht einstellbar, weil Freigaberegeln im Dienst je Art gelten, nicht je Werkzeug. „Welche Orbis“ und die Browser-Rückkehr (Konto-genau über `status?accountId=`) sind echt.
- Personalisierung: Anleitungsgrenze kommt vom Dienst (8000), Figma zeigt 1500. „Ändern“ beim Brain-Ordner fehlt, der Dienst hat dafür keine Route.
- Darstellung: Blickrichtung und Hintergrundart des App-Symbols liegen nur im Browser-Speicher, der Dienst speichert Figur, Farbe und Hintergrund (Hex). `designAnwenden()` setzt `data-theme`; die Hülle sollte es beim Start mit `GET /v1/settings` aufrufen.
- Sicherheit: Namen der Freigabearten (`tool`) sind nur für wenige bekannt, sonst steht der Dienstname.
- SettingsView füllt seinen Platz (Navigation 260 + Inhalt) und ersetzt die Seitenleiste; der Chat-Rahmen muss ihr die ganze Fensterfläche geben.
