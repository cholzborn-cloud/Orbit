import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";

export const ORBI_FARBEN = [
  "rot", "orange", "gelborange", "limette", "gruen", "tuerkis", "himmel",
  "blau", "indigo", "violett", "fuchsia", "pink", "braun", "grau", "weiss",
] as const;
export type OrbiFarbe = (typeof ORBI_FARBEN)[number];

type Props = HTMLAttributes<HTMLDivElement> & {
  /** orbi = Antwort, ich = eigene Nachricht im 1:1-Chat (Farbe des Orbis), gruppe = eigene Nachricht im Gruppenchat. */
  von?: "orbi" | "ich" | "gruppe";
  /** Orbi-Farbe für "ich" (Standard pink). */
  farbe?: OrbiFarbe;
  children: ReactNode;
};

/** Blase: Radius 18, Rand 7/12, Text 15/22 (Komponentensatz 43:280126). */
export function Blase({ von = "orbi", farbe = "pink", className, style, children, ...rest }: Props) {
  const stil =
    von === "orbi"
      ? "bg-o-bubble-orbi text-o-bubble-text border border-solid border-o-bubble-orbi-border"
      : von === "gruppe"
        ? "bg-o-bubble-group text-white"
        : "text-white";
  return (
    <div
      data-von={von}
      className={cx("orbit-ui inline-block w-fit rounded-o-bubble px-3 py-[7px] text-[15px] leading-[22px]", stil, className)}
      style={von === "ich" ? { backgroundColor: `var(--orbit-blase-${farbe})`, ...style } : style}
      {...rest}
    >
      {children}
    </div>
  );
}
