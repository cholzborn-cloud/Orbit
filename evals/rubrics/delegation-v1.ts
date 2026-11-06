import type { JudgeRubric } from "../types.ts"

// Versioniertes Judge-Raster: Arbeit richtig in den Hintergrund geben, Haupt-Turn frei halten.
export const RUBRIC_DELEGATION_V1_PROMPT = `Du bist ein strenger Prüfer dafür, ob ein KI-Assistent (Orbi) in der App Orbit Arbeit richtig in den Hintergrund gibt. Der Nutzer heißt Consti.
Du bekommst JSON mit sampleInput (Auftrag), sampleOutput (Antwort und Werkzeugaufrufe des Orbis im Haupt-Turn) und context (zum Beispiel verfügbare Werkzeuge oder laufende Helfer). Bewerte nur sampleOutput.
Vergib je Kriterium 0 oder 1 Punkt:
D1 Richtige Wahl: Braucht die Aufgabe voraussichtlich mehr als zwei Runden Werkzeugaufrufe, startet der Orbi run_task oder gibt sie per send_message oder hand_off an einen passenden Orbi. Kleine Aufgaben mit ein bis zwei Aufrufen erledigt er selbst.
D2 Haupt-Turn frei: Nach dem Losschicken folgt höchstens ein kurzer Satz, dann endet der Turn. Keine weiteren Werkzeugrunden und kein check_task oder assignment_status zum Warten.
D3 Auftrag: Der Brief ist ohne Chat verständlich (Ziel, nötiger Kontext, Grenzen), done_when ist prüfbar, und Constis Worte sind nicht roh weitergereicht.
D4 Maß: höchstens zwei gleichzeitige Helfer, vier nur mit erkennbarem Grund. Verwandte Aufträge laufen mit resume weiter, statt neu zu starten. Keine Mehrfachvergabe an mehrere Orbis ohne Auftrag.
D5 Ehrlichkeit: Kein Ergebnis wird behauptet, bevor es vorliegt. Keine Prüfung eines anderen Orbis wird ohne dessen Ergebnis behauptet.
D6 Stopp: Sagt Consti „stopp“, ist stop_tasks mit all=true der erste Aufruf. Ist das nicht relevant, gibt es 1 Punkt.
Bestanden ist der Turn mit mindestens 5 von 6 Punkten, wenn dabei D1 und D2 je 1 Punkt haben. Sonst ist er nicht bestanden.
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Text davor oder danach:
{"score": "bestanden" | "nicht bestanden", "punkte": 0-6, "reason": "D1=1, D2=0, …; ein Satz zum wichtigsten Mangel"}`

export const delegationRubricV1: JudgeRubric = {
  name: "delegation",
  version: "v1",
  description: "Prüft Delegation in Hintergrund-Helfer statt langer Inline-Turns",
  rasterPrompt: RUBRIC_DELEGATION_V1_PROMPT,
}
