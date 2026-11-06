// Standardbeschreibung je Aufgabe aus den Vorlagen in bot-dialog.tsx; eigene Aufgaben nutzen den Fallback.
const JOB_DESCRIPTIONS: Record<string, string> = {
  Begleiter:
    "Du bist ein freundlicher Alltagsbegleiter. Du plauderst, hörst zu, beantwortest kurze Fragen und hilfst bei kleinen Dingen des Alltags.",
  Recherche:
    "Du recherchierst Themen gründlich, vergleichst Quellen, trennst Fakten von Meinungen und fasst Ergebnisse klar mit Quellen zusammen.",
  Programmieren:
    "Du schreibst, erklärst und debuggst Code. Du bevorzugst einfache, lesbare Lösungen und erklärst kurz, was du änderst und warum.",
  "Code-Review":
    "Du prüfst Code auf Fehler, Lesbarkeit, Sicherheit und Performance und gibst konkretes, priorisiertes Feedback.",
  Texte:
    "Du schreibst, überarbeitest und verbesserst Texte wie E-Mails, Aufsätze und Beiträge und bewahrst dabei Stil und Absicht des Autors.",
  Lernen:
    "Du bist ein geduldiger Tutor. Du erklärst Schritt für Schritt, nutzt Beispiele und prüfst das Verständnis mit kurzen Fragen.",
  Übersetzen:
    "Du übersetzt natürlich und treffend zwischen Sprachen, behältst Ton und Bedeutung bei und weist auf Mehrdeutigkeiten hin.",
  Ideen:
    "Du sammelst kreative Ideen aus verschiedenen Blickwinkeln, hältst jede kurz und konkret und empfiehlst am Ende die beste.",
  Planen:
    "Du hilfst, Projekte, Tage und Ziele zu planen, indem du sie in kleine Schritte mit klaren Prioritäten und realistischer Zeit aufteilst.",
}

// Typische Aufgabe je Vorlage, für Übergabe-Beispiele im System-Prompt.
const JOB_EXAMPLES: Record<string, string> = {
  Begleiter: "Lass uns kurz über meinen Tag plaudern",
  Recherche: "Vergleich mir die drei besten E-Bikes unter 2000 € mit Quellen",
  Programmieren: "Schreib mir eine Python-Funktion, die Primzahlen prüft",
  "Code-Review": "Schau dir diesen Code auf Fehler und Sicherheitslücken an",
  Texte: "Formulier mir eine höfliche E-Mail an meinen Vermieter",
  Lernen: "Erklär mir die Photosynthese Schritt für Schritt",
  Übersetzen: "Übersetz diesen Absatz ins Englische",
  Ideen: "Gib mir Ideen für einen Geburtstag",
  Planen: "Plan mir die Lernwoche vor der Prüfung",
}
// Hauptorbi: Beispiel aus Koordination (mehrere Teile), nie eine Fachaufgabe.
const MAIN_EXAMPLE =
  "Recherchier die besten E-Bikes unter 2000 € und schreib mir daraus eine kurze Kaufempfehlung"
export const jobExample = (job: string, isMain = false) =>
  isMain
    ? MAIN_EXAMPLE
    : (JOB_EXAMPLES[job.trim()] ?? `eine Aufgabe zum Thema „${job}“`)

const MAIN_DESCRIPTION =
  "Du bist der Hauptorbi des Nutzers. Deine Spezialität ist Koordination: Du verstehst, was der Nutzer braucht, und entscheidest, ob du es selbst erledigst, an einen passenden Orbi übergibst oder in Teile aufteilst. Kleine, schnelle Dinge und deine eigenen Teile erledigst du selbst, alles andere gibst du an den passenden Orbi. Am Ende fasst du alles zu einer Antwort zusammen."

// Client-sicher: Teil des System-Prompts und Vorbelegung von „Verhalten“ im Dialog.
export const describeJob = (job: string, isMain: boolean) =>
  isMain
    ? MAIN_DESCRIPTION
    : (JOB_DESCRIPTIONS[job.trim()] ??
      "Du hilfst dem Nutzer bei allem, was zu deiner Aufgabe gehört.")
