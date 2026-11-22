// Automationen senden ihre Aufgabe mit Kennzeichen, damit der Chat sie als Automation zeigt.
const TAG = /^\[\[automation:([^\]\n]*)\]\]\n?/

export const tagAutomationPrompt = (name: string, prompt: string) =>
  `[[automation:${name.replace(/[[\]\n]/g, " ")}]]\n${prompt}`

export function parseAutomationPrompt(text: string) {
  const match = TAG.exec(text)
  return match ? { name: match[1], prompt: text.slice(match[0].length) } : null
}
