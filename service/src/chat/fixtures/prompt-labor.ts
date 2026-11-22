import {
  FLEET_TOOLS_PROMPT_PLACEHOLDER,
  FOLLOW_UP_ROUTINE_PROMPT_PLACEHOLDER,
  GROK_CORE_STABLE_PLACEHOLDER,
  HAND_OFF_PROMPT_PLACEHOLDER,
  MAC_TOOLS_PROMPT_PLACEHOLDER,
  REPLY_HABITS_PLACEHOLDER,
  TASK_TOOLS_PROMPT_PLACEHOLDER,
  WAKE_LABELS_PLACEHOLDER,
} from "../../../../lib/chat/agent.ts"

// Die Prompt-Labor-Blöcke (06.11.2026) haben ihr eigenes Budget bei Prompt-Labor. Die Längen-Tests messen nur den
// übrigen Prompt, damit der Rest weiter knapp bleibt und die gelieferten Texte wörtlich bleiben.
export const PROMPT_LABOR_BLOCKS = [
  GROK_CORE_STABLE_PLACEHOLDER,
  REPLY_HABITS_PLACEHOLDER,
  WAKE_LABELS_PLACEHOLDER,
  TASK_TOOLS_PROMPT_PLACEHOLDER,
  HAND_OFF_PROMPT_PLACEHOLDER,
  FOLLOW_UP_ROUTINE_PROMPT_PLACEHOLDER,
  FLEET_TOOLS_PROMPT_PLACEHOLDER,
  MAC_TOOLS_PROMPT_PLACEHOLDER,
]

export const ohnePromptLabor = (text: string) =>
  PROMPT_LABOR_BLOCKS.reduce((rest, block) => rest.replace(`\n\n${block}`, ""), text)

// Werkzeuge, deren Beschreibung Prompt-Labor wörtlich liefert (Verhaltensregeln wie bei Grok in der Beschreibung).
export const PROMPT_LABOR_TOOLS = new Set(["send_message", "hand_off", "run_task", "check_task", "message_task", "stop_tasks", "todo_write"])
