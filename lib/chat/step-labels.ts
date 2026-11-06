// Status-Labels für die Statusleiste: Klartext aus dem Code, nie vom Modell, nie Befehle, Pfade oder Eingaben.
// null = kein Label (Karten wie Rückfragen und Freigaben oder Zwischennachrichten stehen für sich).
const LABELS: Record<string, string | null> = {
  web_search: "Sucht im Web …",
  brain_search: "Sucht im Brain …",
  brain_read: "Liest eine Brain-Notiz …",
  brain_write: "Schreibt Notiz …",
  brain_move: "Verschiebt Notiz …",
  read_skill: "Liest einen Skill …",
  save_skill: "Speichert einen Skill …",
  memory_get: "Liest das Gedächtnis …",
  chat_recall: "Sucht im Verlauf …",
  upgrade_model: "Wechselt zu einem stärkeren Modell …",
  memory_save: "Merkt sich etwas …",
  memory_forget: "Räumt das Gedächtnis auf …",
  read_coding_rules: "Liest die Coding-Regeln …",
  generate_image: "Erstellt ein Bild …",
  create_pdf: "Erstellt ein PDF …",
  create_word: "Erstellt ein Word-Dokument …",
  bash: "Arbeitet im Terminal …",
  read_file: "Liest eine Datei …",
  create_file: "Schreibt eine Datei …",
  write_file: "Schreibt eine Datei …",
  list_files: "Sieht Dateien durch …",
  share_file: "Bereitet die Datei vor …",
  view_screen: "Schaut auf den Bildschirm …",
  show_screen: "Zeigt den Bildschirm …",
  mouse_click: "Bedient den Desktop …",
  mouse_move: "Bedient den Desktop …",
  mouse_scroll: "Bedient den Desktop …",
  mouse_drag: "Bedient den Desktop …",
  keyboard_type: "Bedient den Desktop …",
  keyboard_press: "Bedient den Desktop …",
  keyboard_hotkey: "Bedient den Desktop …",
  wait: "Wartet kurz …",
  send_message: "Schreibt an einen Orbi …",
  automation_create: "Legt eine Routine an …",
  update_routine: "Aktualisiert Routine …",
  run_task: "Startet Helfer …",
  check_task: "Prüft Helfer …",
  message_task: "Schreibt an Helfer …",
  stop_tasks: "Stoppt Helfer …",
  todo_write: "Aktualisiert Aufgaben …",
  assignment_status: "Prüft Auftragsstatus …",
  scratchpad: "Aktualisiert Notizblock …",
  create_orbi: "Legt einen Orbi an …",
  list_orbis: "Listet Orbis auf …",
  update_orbi: "Aktualisiert Orbi …",
  archive_orbi: "Archiviert Orbi …",
  propose_profile: "Schlägt Profil vor …",
  confirm_action: "Wartet auf deine Freigabe …",
  // Lokal am Mac (lib/mac)
  mac_shell: "Arbeitet im Terminal am Mac …",
  mac_files: "Arbeitet mit Dateien am Mac …",
  mac_open: "Öffnet etwas am Mac …",
  mac_applescript: "Steuert eine App am Mac …",
  mac_shortcut: "Startet einen Kurzbefehl …",
  mac_screen: "Schaut auf deinen Bildschirm …",
  mac_input: "Bedient deinen Mac …",
  mac_clipboard: "Nutzt die Zwischenablage …",
  mac_notify: "Schickt eine Mitteilung …",
  mac_calendar: "Schaut in den Kalender …",
  mac_reminders: "Schaut in die Erinnerungen …",
  mac_contacts: "Sucht in den Kontakten …",
  mac_notes: "Schaut in die Notizen …",
  mac_browser: "Arbeitet im Browser …",
  // Eigene Karten bzw. Blasen, keine Statuszeile.
  say: null,
  react: null,
  ask_user: null,
  onboarding_finish: null,
  onboarding_create_orbis: null,
}

export const FALLBACK_LABEL = "Arbeitet …"

export function stepLabel(tool: string): string | null {
  if (Object.hasOwn(LABELS, tool)) return LABELS[tool]!
  if (tool.startsWith("connector:")) return "Nutzt ein Plugin …"
  return FALLBACK_LABEL
}

export const knownStepTools = () => Object.keys(LABELS)
