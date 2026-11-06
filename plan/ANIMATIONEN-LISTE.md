# Animationen in Orbit

**Von Consti am 03.11.2026 freigegeben.** Noch nicht eingebaut. Grundlage: Entscheidungen D16/L6, `FIGMA-ABGLEICH.md` §6/20 (Figma „Animationen – Orbis“ 147:59236), `DESIGN-SYSTEM.md` §9 und `AVATAR-ANIMATIONEN.md`. Bei Abweichungen gilt der neuere Figma-Abgleich. Beide Bewegungssysteme bleiben erhalten.

## Wo bewegt sich was?

| Stelle und Zustand | Vorschlag | Quelle und Übergang |
|---|---|---|
| Seitenleiste, Chat zu | Figur 40 pt, 9° geneigt, Blick links oben; vollständig still, ohne Atmen und Blinzeln. Maus im Feld: Augen folgen. | §9/Figma `idle`; beim Öffnen weich in `selected`. |
| Seitenleiste, Chat offen | 40 pt; Blick sanft links/rechts ±0,2–0,35, Wechsel alle 1,2–2,5 s über 0,7–0,9 s, Neigung lx·3°, Blinzeln alle 2,5–4 s. | §9/Figma `selected`; bei neuer Arbeit weich in `working`. |
| Seitenleiste, arbeitet | 40 pt; wippt mit 1,67 s Periode, Blickwechsel alle 1,2–2,5 s über 0,55–0,8 s, Augen 0,94–1,10×. Nach 8 s Sprung mit Drehung, nach 18 s Rückwärtssalto, jeweils 0,95 s. Kein Statuspunkt. | §9/Figma `working`; bei Rückfrage weich zu `waiting`, nach Abschluss zu `done`. |
| Seitenleiste, braucht dich | 40 pt; Wiegen ±5 bei 6,7 s Periode, Neigung ±2,5°, Blick lx ±0,9; keine Hüpfer, kein Blinzeln. Orangefarbener Punkt. | §9/Figma `waiting`; nach Antwort weich zur nächsten passenden Pose. |
| Seitenleiste, fertig und Chat noch zu | Erst ducken, Salto 26 hoch/0,62 s, ducken, Salto 32 hoch/0,75 s, 18 Sterne und Wackeln. Ab 2,3 s Augen 1,2×, Hüpfer 9 hoch alle 1,3–1,9 s; blauer Punkt. | §9/Figma `done`; beim Öffnen weich zu `selected`. |
| Chat-Kopf, auch Gruppe | Augen folgen der Maus im Kopf; Stärke tanh(Abstand / (Breite · 1,4)) × 1,5, Neigung lx·5°. Nach Verlassen in 1,6 s weich zum Blick links oben. | §9/Figma `head`; Übergang weich. Größe gemäß Kopf-Baustein, nicht neu festgelegt. |
| Neben Gruppennachrichten | Figur 24 pt, gerade und still, ohne Blinzeln. | §9/Figma `message`; zusammen mit der Nachrichtenzeile ein- und ausblenden. |
| Live-Zeile beim Arbeiten | Figur 20 pt, Arbeitsbewegung wie oben; grauer Text schimmert nur während der Arbeit. Bei Warten kein Schimmer. | §9/Figma `working` bzw. `waiting`; Text- und Zustandswechsel weich. |
| Rechtes Panel | Figur 72 pt; Maus folgen wie beim Chat-Kopf, Rückkehr 1,6 s. | §9/Figma `head`; beim Öffnen und Schließen mit dem Panel bewegen. |
| Leerzustand | Figur 56 pt; Maus folgen wie beim Chat-Kopf, Blinzeln alle 2,5–4 s. | §9/Figma; Blick weich zurück in 1,6 s. |
| @-Liste | Figur 20 pt, still. | §9/Figma `message`; Ein- und Ausblenden mit der Liste. |
| Bearbeiten-Menü | Figur still; die Editor-Vorschau nutzt weiterhin die Lab-Engine. | Figma für die stille Darstellung, Lab für den Editor; Wechsel weich. |
| Hört zu: Entwurf im Eingabefeld | Kopf leicht nach links, solange der Entwurf besteht. | Lab `listen-1`; bei Beginn und Ende weich zur jeweiligen Zustandspose. |
| Fehler | Dreimal Kopfschütteln, danach traurig stehen, bis der Fehler verfällt (eine Minute oder nächstes Ereignis). | Lab `error-1` → `error-5`, anschließend weich zur nächsten Pose; keine Figma-Vorgabe. |
| Pausiert | Schlafpose. Das Wort „Limit“ erscheint nicht in der Oberfläche. | Lab `limit-1`; beim Ende weich zur nächsten Pose; keine Figma-Vorgabe. |

Allgemein: Bewegung weich mit ease-in-out; Übergänge auch zwischen beiden Systemen ohne sichtbaren Sprung. Für Systemwechsel schlägt die ältere Lab-Liste etwa 0,6 s vor; die genaue Dauer ist in Figma nicht belegt und bleibt für die Umsetzung offen. Bei macOS „Bewegung reduzieren“ keine Schleifen oder Saltos, stattdessen die passende statische Zustandspose; Status bleibt erkennbar. Die Figma-Animationen von 147:59236 gehen der älteren Posen-Seite vor: Ruhe ist vollständig still und „braucht dich“ orange.

**Entfällt aus der alten Lab-Zuordnung:** `work-1` wird durch Figma `working` ersetzt; `wait-2` (Hibbeln nach 30 s) entfällt; `done-3` wird durch die Figma-Feier und anschließende kleine Hüpfer ersetzt. Die alte Beschränkung „Augen folgen nur direkt über dem Orbi“ entfällt für die ausdrücklich genannten Mausbereiche. `calm-1`/`calm-3` und `wait-1` ersetzen die Figma-Zustände nicht; Lab bleibt für die oben genannten Fälle und den Editor.

## Prüfung der acht vermuteten Ursachen

Die folgenden Codebefunde zeigen mögliche Mechanismen, beweisen aber weder einen sichtbaren Sprung noch Ruckeln. Eine Aufzeichnung, Bildfolge und Messung der tatsächlichen Bildzeiten wurden hier nicht durchgeführt; daher ist jede Ursache als **nicht geprüft** einzustufen. Keine Behauptung über das Verhalten in der installierten App ist daraus ableitbar.

| Nr. | Vermutung | Gelesener Befund und Grenze |
|---|---|---|
| 1 | AppKit-Figur läuft bei SwiftUI-Übergängen falsch mit | `mac/Orbit/Figures/FigureView.swift:58,319–330` verwendet `NSView`/`CALayer` und `NSViewRepresentable`; `ChatView.swift:159` setzt einen Übergang. **Nicht geprüft:** Position und Clip während des Übergangs. |
| 2 | Figur malt über ihren Rahmen | `FigureView.swift:85,93–96`: `masksToBounds = false`, Rand 24/80 der Breite pro Seite. Das belegt den erweiterten Zeichenbereich, **nicht** einen sichtbaren Fehler oder seine Ursache. |
| 3 | Fensterweite Animation verschiebt Elemente | `MainWindow.swift:37–38` animiert auf erste Orbi-ID und Seitenleistenzustand. **Nicht geprüft:** tatsächliche Anfangs- und Endpositionen. |
| 4 | Chatladen animiert Nachrichten doppelt | `ChatView.swift:193` animiert Nachrichten-IDs; `:159` setzt den Zeilenübergang und `:278,300,308` animieren Scrollvorgänge. Die äußeren Animationen `:90–91` beobachten Fragen bzw. Karten, **nicht** Nachrichten-IDs: die behauptete doppelte Nachrichten-ID-Animation ist dort nicht belegt. **Nicht geprüft:** Wirkung beim Laden/Wechsel. |
| 5 | Synchrones Neuzeichnen bei Layout verursacht Ruckeln | `FigureView.swift:164–170` ruft im Layout `tick` auf; der Behavior-Pfad zeichnet unter `:218–224` ein Bild. Im Lab-Pfad kann die Signatur unter `:274–275` unverändertes Zeichnen auslassen. **Nicht geprüft:** Häufigkeit und Dauer je Frame. |
| 6 | Hauptthread-Timer und Raster verursachen Ruckeln | `FigureView.swift:17–49` nutzt den Haupt-Runloop; `:210` nennt 1/48 bzw. 1/30 s. **Nicht geprüft:** tatsächlich erreichte Bildzeiten und Last bei fünf Figuren. |
| 7 | Wechsel zwischen beiden Systemen lässt die Figur springen | `FigureView.swift:104–108,112–129,244–249` zeigt Zustandswechsel und Wahl der beiden Pfade. Der Lab-Player selbst überblendet intern (`AvatarPlayer.swift:40,114–124`); daraus folgt noch keine Aussage über den Wechsel *zwischen* Systemen. **Nicht geprüft:** tatsächliche Bildfolge beim Wechsel. |
| 8 | Panel und Kopf werden doppelt animiert, Material kostet zu viel | `SidePanel.swift:33` animiert `panelOpen`, `MainWindow.swift:38` dagegen `sidebarCollapsed`; ein identischer Auslöser ist damit nicht belegt. `ChatHeaderView.swift:54` nutzt Material. **Nicht geprüft:** gleichzeitige Animation und tatsächliche Renderkosten. |

Für die spätere Abnahme: isolierte Testdaten verwenden; Chatwechsel, Seitenleiste und Panel über Bildfolgen bzw. Positions-Probes messen und bei fünf Figuren die Frame-Zeiten erfassen. Ziel aus Schritt 20: höchstens 16,7 ms pro Frame; außerdem „Bewegung reduzieren“ prüfen. Eine Bildschirmaufnahme nur mit bestehender Freigabe.

Freigabe: Ja, Liste freigegeben (Consti im Chat, 03.11.2026).
