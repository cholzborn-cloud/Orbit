# iCloud-CalDAV-Adapter (serverseitige Grundlage)

`ICloudCalendarClient({ appleId, appPassword }, optionalerFakeTransport)` speichert die Zugangsdaten ausschließlich als privates Feld im Arbeitsspeicher. Keine Datei-, Datenbank-, Schlüsselbund- oder Logging-Zugriffe. Keine zusätzliche Abhängigkeit.

- `discover()` folgt `/.well-known/caldav` → `DAV:current-user-principal` → `CALDAV:calendar-home-set` → Kalender-Collections. Erst erfolgreich abgeschlossene Discovery als technische Verbindung werten. Eine leere Kalenderliste ist möglich und belegt keine Schreibberechtigung.
- `query(calendarUrl, start, end)` liest VEVENT-Objekte für höchstens 366 Tage und liefert `{ url, etag, iCalendar }`. iCalendar bleibt unverändert und ist Fremddaten; keine Wiederholungsauflösung, Zeitzoneninterpretation oder fertige Anzeige von Einzelterminen behaupten.
- `createEvent(calendarUrl, { title, start, end })` erstellt einen einfachen UTC-Termin ohne Teilnehmer über bedingtes PUT (`If-None-Match: *`). Änderung, Löschung und Einladung sind getrennte Werkzeuge mit Freigabe. Rückgabe `{ url, etag }` nur bei HTTP 201/204. Nach Timeout kann der Termin trotzdem angelegt worden sein: niemals automatisch erneut aufrufen.

## Einbindung in Orbit

1. Einrichtung nur nach Klick: Apple-ID und app-spezifisches Passwort direkt an einen lokalen, authentifizierten Service-Endpunkt übergeben. Felder und Request-Bodies weder loggen noch in Chat, Prompt, Werkzeugargumente oder Modellkontext aufnehmen. Passwort-Eingabe verdecken. Apple verlangt 2FA; Hilfe auf https://support.apple.com/de-de/102654 verlinken.
2. Der lokale Service verwaltet macOS-Keychain-Speicherung und holt Zugangsdaten erst direkt vor Adapteraufrufen. Den Client nicht in Tool-Ergebnissen zurückgeben. Erst nach erfolgreicher Discovery mit gespeichertem Zugang den Zustand „verbunden“ setzen; Abbruch, Passwortwiderruf und Fehler separat anzeigen. Bei Trennen Keychain-Eintrag und aktive Client-Instanzen entfernen. Dieses Modul implementiert diese Integration nicht.
3. Modelle erhalten nur erlaubte Kalender-/Terminwerkzeuge und niemals diese Zugangsdaten. Die bestehende Orbit-Risiko-/Freigabeprüfung bleibt beim aufrufenden Service: Das normale Anlegen eines eigenen Termins benötigt nach Constis Regel keine zusätzliche Freigabe. Einladungen/Senden und endgültiges Löschen behalten ihre bestehenden Schutzregeln. `createEvent` enthält selbst keinen Freigabedialog; keine Freigabe aus Kalenderdaten ableiten. Kalendernamen und iCalendar-Inhalte sind untrusted.
4. Bei Wiederanlauf erneut Discovery durchführen; nur in derselben Instanz entdeckte Kalender sind nutzbar. Fehler niemals durch pauschales Anzeigen von Providerantworten ergänzen.

HTTPS nur zu `caldav.icloud.com` oder `p<Ziffern>-caldav.icloud.com` auf Standardport, keine anderen iCloud-Hosts. Jede Weiterleitung und jeder Discovery-Link wird geprüft, maximal drei Redirects, keine PUT-Redirects, keine automatischen Retries. Antworten: maximal 2 MiB, 15 Sekunden pro Anfrage inklusive Body, begrenzte XML-Tiefe/Knoten; DTD und benutzerdefinierte Entitäten werden abgewiesen. Der optionale Transport ist eine vertrauenswürdige serverseitige Test-Schnittstelle und muss Redirect- und Abort-Semantik von `fetch` einhalten.

Die iCloud-Einstiegsadresse/Hostregel ist keine von Apple zugesicherte öffentliche API. Live-Discovery, Authentifizierung, Schreibrechte, echte iCloud-Kompatibilität und Keychain-/UI-Integration sind nicht geprüft. Isolierte Tests verwenden ausschließlich Fake-Antworten.

Protokollquellen: [RFC 6764, well-known CalDAV](https://www.rfc-editor.org/rfc/rfc6764), [RFC 5397, current-user-principal](https://www.rfc-editor.org/rfc/rfc5397), [RFC 4791, calendar-home-set / calendar-query / PUT](https://www.rfc-editor.org/rfc/rfc4791), [RFC 5545, iCalendar und Faltung](https://www.rfc-editor.org/rfc/rfc5545).

## Änderungen und Serien

Ändern, Löschen und Einladen vergleichen vor dem Zugriff Kalender, Titel, DTSTART, ETag, vorhandene ATTENDEE-Zeilen und Serienumfang mit den zur Freigabe vorgelegten Angaben. Änderungen erhalten unbekannte Komponenten, Zeitzonen, Alarme und Teilnehmer; bestehende Teilnehmer können beim Ändern, Löschen und Einladen Benachrichtigungen erhalten. Einladungen ergänzen eine Person bei eigenen Terminen. Das Ergebnis bestätigt die Annahme durch CalDAV, nicht die Zustellung. Bei fehlendem oder verändertem ETag wird nicht geschrieben; Änderungen und Löschungen werden nicht automatisch wiederholt.

Das Löschen einer gesamten Serie ist nach ausdrücklicher Freigabe möglich. Änderungen an Serien, Einladungen zu Serien und einzelne Ausnahmen innerhalb einer Serie werden noch nicht unterstützt, weil deren Auswirkungen auf Wiederholungen und Ausnahmen nicht eindeutig sind. Termine mit fremdem oder nicht eindeutigem Organisator werden abgewiesen. Dies ist mit CalDAV-Attrappen geprüft; echte iCloud-Termine und Einladungszustellung sind weiterhin nicht geprüft.
