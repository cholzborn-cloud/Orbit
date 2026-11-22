import type { SVGProps } from "react";
import { BRAND_PATHS, ICON_PATHS } from "./icons.generated";

export type SymbolName = keyof typeof ICON_PATHS | (string & {});
export type MarkenName = keyof typeof BRAND_PATHS | (string & {});

export const SYMBOL_NAMEN = Object.keys(ICON_PATHS);
export const MARKEN_NAMEN = Object.keys(BRAND_PATHS);

type Props = Omit<SVGProps<SVGSVGElement>, "name" | "children"> & {
  /** Name aus dem Symbolsatz (z. B. "plus", "chevd"). */
  name?: SymbolName;
  /** Markenzeichen (z. B. "slack"); statt `name`. */
  marke?: MarkenName;
  /** Kantenlänge in px, Standard 16 (Figma-Raster). */
  groesse?: number;
  /** Zugänglicher Name; ohne ihn ist das Symbol dekorativ. */
  titel?: string;
};

/** Symbol: dünne Linie (1,75 im 24er-Raster = 1,17 px bei 16 px), Farbe über currentColor. */
export function Symbol({ name, marke, groesse = 16, titel, ...rest }: Props) {
  const istMarke = Boolean(marke);
  const html = istMarke ? BRAND_PATHS[marke as string] : ICON_PATHS[name as string];
  const a11y = titel ? { role: "img", "aria-label": titel } : { "aria-hidden": true };
  const stil = istMarke
    ? {}
    : { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg
      data-symbol={istMarke ? `marke:${marke}` : name}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={groesse}
      height={groesse}
      focusable="false"
      className="shrink-0"
      {...stil}
      {...a11y}
      {...rest}
      dangerouslySetInnerHTML={{ __html: html ?? "" }}
    />
  );
}
