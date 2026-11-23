# OrbitBot-UI – nur Inspiration

> **Das hier ist nur Inspiration, keine Vorgabe.** Aussehen, Karten und Orbi-Animationen zeigen die Richtung.
> Funktionen, Aufbau und Code müssen **nicht 1:1** übernommen werden.

Ein klickbarer Prototyp in einer einzigen Datei, ohne Abhängigkeiten. Öffnen:

```sh
cd inspiration/orbitbot-ui && python3 -m http.server 5173
# dann http://localhost:5173
```

## Was drin ist

- **Seitenleiste:** Bot-Kachel, Chatliste mit Orbis (beim Darüberfahren werden sie lebendig), Kontomenü → Einstellungen.
- **Chat:** alle Kartentypen: Fragen-Stapel (Einfach-/Mehrfachauswahl, eigene Antwort, Warnoption), Produktkarten, E-Mail-Entwurf, geschütztes Feld, Tipp-Animation mit Orbi.
- **Alle Orbis:** die 15 Formen mit den Zuständen Normal, Lebendig, Blick und Schläft.
- **Rechtes Panel:** Toni folgt dem Mauszeiger. Ein Klick auf Toni wechselt die Form per Morph.
- **Einstellungen:** Konto, Erscheinungsbild, System.

## Herkunft der Orbis

Formen und Verhalten stammen aus [`orbit-app/src/orbi`](../../orbit-app/src/orbi): `geometry`, `behavior`, `shapes`, `ticker` und `morph`.
Sie sind als Bündel in die HTML-Datei eingebettet. Senden, Antworten und Daten sind nur gespielt, ein Backend gibt es nicht.
