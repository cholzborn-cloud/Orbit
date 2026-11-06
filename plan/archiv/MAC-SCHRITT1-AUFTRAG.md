# Auftrag: lokale Datenbank und lokale Identität

21.10.2026, Quelle: Constis Auftrag in dieser Sitzung.

- Nur dieser Checkout `Orbit 2 Mac`, Branch `mac-umbau`; Nachbarprojekt bleibt unberührt.
- SQLite mit WAL, 14 Tabellen, FTS5 und echten Transaktionen.
- Lokale Identität `local`, Clerk vollständig aus der Anwendung entfernen.
- Neon-Export nur als Skript vorbereiten, sieben Tabellen ohne Chats; ausschließlich SELECT, nie ausführen.
- Vier getrennte deutsche Commits nach Prüf-Gate; keine Secrets ausgeben oder committen.
- Abnahme: `npm run check`, lib-Tests und Start ohne Clerk-, Datenbank-, Neon- und AWS-Variablen.
