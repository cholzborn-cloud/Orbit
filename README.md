# Orbit

Orbit ist eine macOS-App für KI-Chats, Dateien und wiederkehrende Aufgaben. Die Oberfläche nutzt Tauri, Rust und React. Ein lokaler Python-Dienst übernimmt Hintergrundaufgaben und speichert Daten in SQLite.

## Entwicklung

```sh
cd orbit-app
npm ci
npm run dev
```

Für die Desktop-App brauchst du zusätzlich Rust und die Xcode Command Line Tools. Starte sie aus `orbit-app` mit `npm run tauri -- dev`.

## Tests

- Frontend in `orbit-app` mit `npx vitest run`
- Rust nach einem Frontend-Build in `orbit-app/src-tauri` mit `cargo test`
- Python-Dienst in `orbitd` mit `uv run pytest`

Für die Kontoanmeldung kannst du `orbit-app/src-tauri/supabase.config.example.json` als lokale Vorlage nutzen.
