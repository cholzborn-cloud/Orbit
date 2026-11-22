import { useEffect, useState } from "react";
import { cx } from "./util";

/** Kurze Abfragen enden, bevor eine Anzeige ins Bild kommt. */
export function Ladeanzeige({ text = "Loading…", className }: { text?: string; className?: string }) {
  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSichtbar(true), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!sichtbar) return null;
  return (
    <span role="status" className={cx("inline-flex items-center gap-2 text-[13px] leading-[18px] text-o-text-2", className)}>
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-solid border-current border-r-transparent motion-safe:animate-spin" />
      {text}
    </span>
  );
}
