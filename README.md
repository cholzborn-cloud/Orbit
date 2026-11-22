<div align="center">
  <img src="orbit-app/src-tauri/icons/128x128.png" width="112" height="112" alt="Orbit-App-Symbol">
  <h1>Orbit</h1>
  <p>Eine macOS-App für KI-Chats, Dateien und wiederkehrende Aufgaben.</p>
  <p><a href="#schnellstart">Schnellstart</a> · <a href="#projektaufbau">Projektaufbau</a> · <a href="#tests">Tests</a></p>
</div>

---

## Schnellstart

Du brauchst macOS, Node.js, Rust und die Xcode Command Line Tools.

```sh
cd orbit-app
npm ci
npm run tauri -- dev
```

Für die Oberfläche im Browser genügt `npm run dev`. Die Kontoanmeldung lässt sich lokal über die [Supabase-Vorlage](orbit-app/src-tauri/supabase.config.example.json) einrichten. Kopiere sie nach `orbit-app/src-tauri/supabase.config.json` und ergänze deine Werte.

## Projektaufbau

| Bereich | Aufgabe |
| --- | --- |
| [Oberfläche](orbit-app/src) | Chats, Dateien und Routinen in React und TypeScript |
| [Desktop-App](orbit-app/src-tauri) | Tauri und Rust für die macOS-Integration |
| [Lokaler Dienst](orbitd) | Python und SQLite für Daten und Hintergrundaufgaben |

## Tests

| Bereich | Befehl ab Repo-Wurzel |
| --- | --- |
| Frontend | `cd orbit-app && npx vitest run` |
| Rust | `cd orbit-app && npm run build && cd src-tauri && cargo test` |
| Python | `cd orbitd && uv run pytest` |
