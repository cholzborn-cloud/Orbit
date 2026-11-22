import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";

type Props = HTMLAttributes<HTMLElement> & {
  titel?: string;
  children: ReactNode;
};

/** Gruppe: Überschrift 14/20 Mittel zweitrangig, darunter Fläche mit Radius 20 voller Zeilen (43:279608). */
export function Gruppe({ titel, children, className, ...rest }: Props) {
  return (
    <section className={cx("orbit-ui flex flex-col gap-2", className)} {...rest}>
      {titel ? <h3 className="text-[14px] leading-5 font-medium text-o-text-2">{titel}</h3> : null}
      <div className="overflow-hidden rounded-o-dialog bg-o-surface [&>:last-child>[data-sep]]:hidden">{children}</div>
    </section>
  );
}
