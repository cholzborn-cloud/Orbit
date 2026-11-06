// Akzentfarbe: Variablen an <html> schlagen :root und .dark.
// Lesbare Schrift auf der Farbe (Helligkeit nach WCAG).
function onColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1a1a1a" : "#ffffff"
}

function accentVars(hex: string | null): Record<string, string> {
  if (!hex) return {}
  return {
    "--primary": hex,
    "--primary-foreground": onColor(hex),
    "--ring": hex,
    "--sidebar-primary": hex,
    "--sidebar-primary-foreground": onColor(hex),
  }
}

// null = Standard-Design.
export function applyAccent(hex: string | null) {
  const el = document.documentElement
  for (const k of Object.keys(accentVars("#000000"))) el.style.removeProperty(k)
  for (const [k, v] of Object.entries(accentVars(hex)))
    el.style.setProperty(k, v)
}
