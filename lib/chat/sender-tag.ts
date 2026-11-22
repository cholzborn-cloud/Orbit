const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Marker "[Name]: " am Textanfang, wie das Modell ihn aus dem Gruppenverlauf nachahmt.
// Namen werden maskiert, sonst brechen Sonderzeichen ("C++", "a|b") den Ausdruck.
export const senderTagRe = (names: string[]) =>
  new RegExp(`^\\s*\\[(?:${names.map(escapeRe).join("|")})\\]:\\s*`)
