/** Klassen zusammenfügen, leere Werte ignorieren. */
export function cx(...teile: Array<string | false | null | undefined>): string {
  return teile.filter(Boolean).join(" ");
}

/** Sichtbarer Fokus (3:1): 2 px Ring in der Fokusfarbe, nur bei Tastaturbedienung. */
export const FOKUS =
  "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-o-focus focus-visible:outline-offset-0 data-[zustand=fokus]:outline-2 data-[zustand=fokus]:outline-solid data-[zustand=fokus]:outline-o-focus";

/** Deaktiviert: gedämpft, ohne Zeiger. */
export const AUS = "disabled:opacity-40 disabled:pointer-events-none";

/** Weicher Übergang, der bei reduzierter Bewegung entfällt (siehe tokens.css). */
export const UEBERGANG =
  "transition-[background-color,opacity,color] duration-[var(--orbit-dur)] ease-[var(--orbit-ease)]";
