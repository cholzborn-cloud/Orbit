# Orbit 2: Code-Konventionen (feste Ordnung)

> **Hinweis 03.11.2026:** Teile zur Web-App und zum Proxy sind überholt (Proxy fällt weg, E59). Für Regeln gelten `AGENTS.md` und `CODING.md`.

Gilt für alles Neue und alles, was angefasst wird. Vor jedem Phasen-Prompt lesen.

## Ordnung (Domain-Ordner)
Neue Features liegen nach Domäne, nie lose im Wurzelordner von `lib/` oder `components/`.

| Schicht | Pfad | Inhalt |
|---|---|---|
| Logik (server-only) | `lib/<domain>/*.ts` | reine Funktionen, Parser, Clients; `import "server-only"` wenn Secrets |
| Server Action | `actions/<domain>.ts` | `"use server"`, `auth()` zuerst, zod `safeParse`, Union-Rückgabe |
| Lese-Query | `query/<domain>.ts` | Drizzle, immer `userId`-Parameter |
| UI | `components/<domain>/*.tsx` | kebab-case, benannte Exporte |
| Trigger | `trigger/<domain>.ts` | nur Agent/Tools |
| Tests | neben dem Code `*.test.ts` | `node --test` |

Domänen: `usage`, `settings`, `jev`, `brain`, `skills`, `connectors`, `images`, `search`, `chat`.
Bestehende lose Dateien nur verschieben, wenn die Phase sie ohnehin ändert (ein Verschiebe-Commit getrennt vom Inhalts-Commit).

## Regeln
1. **Eine Quelle je Konstante.** Proxy-URL und Modellkatalog nur in `lib/proxy.ts` / `lib/chat-catalog.ts`. Kein zweites `createOpenAI`.
2. **Fehler als Wert.** Actions geben `{ok:true,…}|{ok:false,error}` mit deutschem Text, werfen nicht. UI zeigt jeden Fehler (Toast aus `components/ui/toast.tsx` oder Inline), nie still.
3. **Jeder Zustand gestaltet:** leer, lädt, Fehler, offline (Proxy/Brain aus), sehr lang, 1 Element, 0 Elemente.
4. **Deutsch** in UI/Fehlern/Kommentaren; `<html lang="de">`; Datum `toLocaleString("de-DE")`.
5. **Format:** Prettier (`npm run format`), keine Semikolons, Doppel-Anführungszeichen. Imports: extern, Leerzeile, `@/…`.
6. **Styling:** nur shadcn-Tokens (`bg-sidebar`, `text-muted-foreground`), `cn()`, Dark+Light prüfen. Keine Hex-Werte.
7. **Secrets** nie ausgeben, nie committen; Keys nur serverseitig; feste URLs im Code, nie aus Nutzereingaben gebaut.
8. **Doppelcode raus:** vor neuem Helfer suchen (`grep`), vorhandenen nutzen.
9. **Kein toter Code:** entfernte Features komplett raus (Konstante, UI, Verwendung).
10. **Kommentare** nur für das Warum, kurz.
11. **Next.js 16:** vor Code `node_modules/next/dist/docs/` zum Thema lesen (AGENTS.md).

## Prüf-Gate (vor jedem Commit)
```
npm run typecheck && npm run lint && npm run build && node --test lib/**/*.test.ts
```
(Phase 0 legt dafür `npm run check` an.) Danach gezielter Browser-Test der Phase. Bestanden = Commit, kein Testlauf-Serien.

## Commit/Deploy
Ein Commit je abgeschlossenem Teilschritt, Nachricht deutsch/kurz. Reihenfolge laut AGENTS.md: `db push` → Commit. Nur localhost: kein Railway, kein `trigger deploy`; Variablen in `.env.local`.

## Web-Messungen
Web-Messungen: `next dev` mit `ORBIT_DATA_DIR` der Testkopie starten, sonst liest die Web-Seite die echte Datenbank.
