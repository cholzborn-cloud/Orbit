// Playbooks sind Daten (nur sachliche Ablauf-Schritte), keine Modell-Anweisungen; read_skill liefert sie als <skill_data>.
export const PLAYBOOK_SKILLS = [
  {
    name: "playbook-kauf",
    description: "Standard-Playbook für Online-Käufe",
    body: `# Online-Kauf
1. Produkt klären: genaues Modell, Variante, Menge, Lieferadresse, Budget. Fehlende Angaben aus Gedächtnis oder Brain.
2. Angebote vergleichen: mindestens zwei Händler mit Gesamtpreis inklusive Versand, Lieferzeit, Rückgabefrist und Händlerbewertung.
3. Ergebnis: bestes Angebot mit Link, Gesamtpreis und Lieferdatum, dazu eine Alternative.
4. Warenkorb vorbereiten, Kauf noch nicht abschließen.
5. Freigabe: Bezahlen kostet Geld und braucht Constis Zustimmung per Fragekarte (Händler, Gesamtpreis, Lieferdatum).
6. Nach der Freigabe bestellen, Bestellnummer und Lieferdatum notieren, Einmal-Nachfass zum Lieferdatum anlegen.
Nicht erlaubt: Zahlungsdaten anzeigen oder speichern, ohne Freigabe bezahlen.
Fertig, wenn: eine Bestellbestätigung mit Bestellnummer vorliegt oder Consti abgelehnt hat.`,
  },
  {
    name: "playbook-buchung",
    description: "Standard-Playbook für Buchungen",
    body: `# Buchung (Termin, Tisch, Unterkunft, Reise)
1. Eckdaten klären: was, wann, wo, für wie viele Personen, Budget.
2. Kalender (Apple-Kalender) auf Überschneidungen prüfen.
3. Verfügbarkeit prüfen: zwei bis drei passende Optionen mit Zeit, Preis und Stornobedingungen.
4. Beste Option nach den Eckdaten wählen, Begründung in einem Satz.
5. Freigabe: Kostet die Buchung Geld oder geht eine Anfrage in Constis Namen raus, braucht das seine Zustimmung per Fragekarte.
6. Buchen, die Bestätigung sichern (Nummer, Zeit, Ort, Stornofrist) und einen Kalendereintrag anlegen.
7. Gibt es eine Stornofrist, einen Einmal-Nachfass vor ihrem Ende anlegen.
Fertig, wenn: Buchungsbestätigung und Kalendereintrag vorliegen oder Consti abgelehnt hat.`,
  },
  {
    name: "playbook-mail",
    description: "Standard-Playbook für E-Mail-Entwürfe",
    body: `# E-Mail-Entwurf
1. Ziel klären: Empfänger, Anlass, gewünschtes Ergebnis der Mail, Ton (du oder Sie).
2. Kontext sammeln: bisheriger Verlauf mit dem Empfänger, passende Notizen im Brain.
3. Entwurf schreiben: Betreff, Kernaussage im ersten Satz, höchstens drei kurze Absätze, am Ende eine klare Bitte oder der nächste Schritt.
4. Entwurf ablegen oder im Chat zeigen, nichts senden.
5. Freigabe: Senden ist eine Nachricht in Constis Namen und braucht seine Zustimmung per Fragekarte (Empfänger, Betreff, Text).
6. Nach der Freigabe senden. Wird eine Antwort erwartet, einen Einmal-Nachfass anlegen.
Nicht erlaubt: Fakten, Zusagen oder Termine, die nicht im Kontext stehen.
Fertig, wenn: der Entwurf freigegeben und gesendet ist oder Consti ihn selbst übernimmt.`,
  },
  {
    name: "playbook-recherche",
    description: "Standard-Playbook für strukturierte Recherche",
    body: `# Recherche
1. Frage schärfen: was genau, wofür, welcher Zeitraum, welche Tiefe.
2. Erst Vorhandenes prüfen: Gedächtnis, Brain, frühere Chats.
3. Quellen suchen, aktuelle Primärquellen vor Sekundärquellen, und das Datum jeder Quelle notieren.
4. Abgleichen: jede Kernaussage mit mindestens zwei unabhängigen Quellen bestätigen, Widersprüche festhalten.
5. Ergebnis: zuerst die Antwort in ein bis drei Sätzen, dann die wichtigsten Punkte, dann die Quellen mit Link und Datum. Unbestätigtes als „nicht geprüft“ kennzeichnen.
6. Ist das Ergebnis dauerhaft wertvoll, als Notiz im Brain ablegen.
Fertig, wenn: die Frage beantwortet ist und jede Kernaussage eine Quelle hat.`,
  },
  {
    name: "playbook-code",
    description: "Standard-Playbook für Code-Änderungen",
    body: `# Code-Änderung
1. Auftrag klären: Repo, Ziel, was „fertig“ heißt und wie es geprüft wird.
2. Projektregeln lesen: AGENTS.md, CODING.md und die Entscheidungen im Brain. Sie gehen allem anderen vor.
3. Vor großen Schritten ein Backup nach ~/Projekte-Coding/Backups/<Projekt>/<JJJJ-MM-TT_HH-MM>/ anlegen.
4. In kleinen Schritten umsetzen, nach jedem Schritt Tests oder Build laufen lassen.
5. Lokal committen im Format „Bereich: was“. Kein Push, kein Deploy.
6. Nichts endgültig löschen: Dateien in den Papierkorb (~/.Trash) oder per git mv ins Archiv.
7. Geheimnisse wie .env-Dateien, secrets.env oder den Schlüsselbund nicht lesen und nicht schreiben.
8. Große oder parallele Umbauten an den Coding-Agenten abgeben, den CODING.md vorsieht, und das Ergebnis danach selbst prüfen.
Fertig, wenn: die Tests grün sind, der Commit lokal liegt und es einen kurzen Bericht mit geänderten Dateien und offenen Punkten gibt.`,
  },
] as const
