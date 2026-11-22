// Kleiner Markdown-Darsteller für Antworten (Fett, Kursiv, Code, Links, Listen, Überschriften, Zitate).
// Baut React-Elemente, nie HTML-Text. Unfertige Zeichen aus dem Strom bleiben als Text stehen.
import { useState, type ReactNode } from "react";
import type { Datei } from "../../lib/types";
import { openUrl } from "../../lib/tauri";
import { isOrbitLink, resolveOrbitLink } from "../../lib/destinations";
import { useOrbit } from "../../lib/store";
import { openOrbitLink } from "./links";

export type Inline =
  | { t: "text"; s: string }
  | { t: "b" | "i" | "s"; c: Inline[] }
  | { t: "code"; s: string }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "bild"; bild: Datei };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: { depth: number; c: Inline[] }[] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; c: Inline[] }
  | { t: "hr" };

const sicher = (href: string) => /^(https:\/\/|mailto:|orbit:\/\/)/i.test(href);
const wortZeichen = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Schließendes Zeichen für Kursiv suchen: nicht nach Leerzeichen, bei "_" nicht mitten im Wort. */
function schliesse(s: string, z: string, von: number): number {
  for (let j = von; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "`") {
      const k = s.indexOf("`", j + 1);
      if (k > j) j = k;
      continue;
    }
    if (s[j] !== z) continue;
    if (s[j + 1] === z) {
      j++;
      continue;
    }
    if (/\s/.test(s[j - 1] ?? " ")) continue;
    if (z === "_" && wortZeichen(s[j + 1])) continue;
    return j;
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", s: buf });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!~>|]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: "code", s: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (s.startsWith("**", i) || s.startsWith("__", i) || s.startsWith("~~", i)) {
      const m = s.slice(i, i + 2);
      if (!(m === "__" && wortZeichen(s[i - 1]))) {
        const j = s.indexOf(m, i + 2);
        if (j > i + 2 && !/\s/.test(s[i + 2]) && !/\s/.test(s[j - 1])) {
          flush();
          out.push({ t: m === "~~" ? "s" : "b", c: parseInline(s.slice(i + 2, j)) });
          i = j + 2;
          continue;
        }
      }
    }
    if ((c === "*" || c === "_") && s[i + 1] !== c && s[i + 1] !== undefined && !/\s/.test(s[i + 1]) && !(c === "_" && wortZeichen(s[i - 1]))) {
      const j = schliesse(s, c, i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: "i", c: parseInline(s.slice(i + 1, j)) });
        i = j + 1;
        continue;
      }
    }
    if (c === "!" && s[i + 1] === "[") {
      const m = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/i.exec(s.slice(i));
      if (m) {
        flush();
        out.push({ t: "bild", bild: { filename: m[1] || "Image", url: m[2], mediaType: "image/*" } });
        i += m[0].length;
        continue;
      }
    }
    if (c === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
      if (m && sicher(m[2])) {
        flush();
        out.push({ t: "a", href: m[2], c: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (c === "h" && /^https:\/\//.test(s.slice(i, i + 8)) && !wortZeichen(s[i - 1])) {
      const m = /^https:\/\/[^\s<>]+/.exec(s.slice(i))!;
      const url = m[0].replace(/[.,;:!?)\]]+$/, "");
      if (url.length > 8) {
        flush();
        out.push({ t: "a", href: url, c: [{ t: "text", s: url }] });
        i += url.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const LISTE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
  const zeilen = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let absatz: string[] = [];
  const endeAbsatz = () => {
    if (absatz.length) blocks.push({ t: "p", c: parseInline(absatz.join("\n")) });
    absatz = [];
  };
  while (i < zeilen.length) {
    const z = zeilen[i];
    const zaun = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(z);
    if (zaun) {
      endeAbsatz();
      const code: string[] = [];
      i++;
      while (i < zeilen.length && !new RegExp(`^\\s*${zaun[1]}\\s*$`).test(zeilen[i])) code.push(zeilen[i++]);
      i++; // schließender Zaun (oder Ende des Textes beim Streamen)
      blocks.push({ t: "code", lang: zaun[2], text: code.join("\n") });
      continue;
    }
    if (!z.trim()) {
      endeAbsatz();
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(z);
    if (h) {
      endeAbsatz();
      blocks.push({ t: "h", level: h[1].length, c: parseInline(h[2]) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(z)) {
      endeAbsatz();
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(z)) {
      endeAbsatz();
      const q: string[] = [];
      while (i < zeilen.length && /^\s*>/.test(zeilen[i])) q.push(zeilen[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", c: parseInline(q.join("\n")) });
      continue;
    }
    const l = LISTE.exec(z);
    if (l) {
      endeAbsatz();
      const ordered = /\d/.test(l[2]);
      const items: { depth: number; c: Inline[] }[] = [];
      const start = ordered ? parseInt(l[2], 10) : 1;
      while (i < zeilen.length) {
        const m = LISTE.exec(zeilen[i]);
        if (m && /\d/.test(m[2]) === ordered) {
          items.push({ depth: Math.min(2, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), c: parseInline(m[3]) });
          i++;
        } else if (m) {
          break;
        } else if (zeilen[i].trim() && /^\s{2,}\S/.test(zeilen[i]) && items.length) {
          items[items.length - 1].c.push({ t: "text", s: " " }, ...parseInline(zeilen[i].trim()));
          i++;
        } else break;
      }
      blocks.push({ t: "list", ordered, start, items });
      continue;
    }
    absatz.push(z);
    i++;
  }
  endeAbsatz();
  return blocks;
}

function oeffne(href: string) {
  openUrl(href).catch(() => {
    /* ohne Browser nichts zu tun */
  });
}

/** Product link (orbit://…): opens the screen inside Orbit; unknown or unavailable targets say so instead of a dead link. */
function OrbitLink({ href, children }: { href: string; children: ReactNode }) {
  const bots = useOrbit((s) => s.bots);
  const main = useOrbit((s) => s.main);
  const groups = useOrbit((s) => s.groups);
  const [meldung, setMeldung] = useState<string | null>(null);
  const r = resolveOrbitLink(href, { bots, main, groups });
  if (r.kind !== "ok") {
    return (
      <span data-orbit-link="unavailable" title={r.message}>
        <span role="link" aria-disabled="true" className="text-o-text-2 underline decoration-dotted underline-offset-2">{children}</span>
        <span className="text-o-text-3"> (not available in this build)</span>
      </span>
    );
  }
  return (
    <>
      <a href={href} data-orbit-link="ok" title={r.destination.label}
        onClick={(e) => {
          e.preventDefault();
          void openOrbitLink(href).then((x) => setMeldung(x.kind === "ok" ? null : x.message));
        }}
        className="cursor-pointer underline decoration-o-line-strong underline-offset-2 hover:decoration-current">
        {children}
      </a>
      {meldung ? <span role="status" className="text-o-text-3"> ({meldung})</span> : null}
    </>
  );
}

function Zeilen({ s }: { s: string }) {
  const teile = s.split("\n");
  return (
    <>
      {teile.map((t, i) => (
        <span key={i}>
          {i > 0 ? <br /> : null}
          {t}
        </span>
      ))}
    </>
  );
}

function renderInline(c: Inline[], onBild?: (d: Datei) => void): ReactNode {
  return c.map((n, i) => {
    switch (n.t) {
      case "text": return <Zeilen key={i} s={n.s} />;
      case "b": return <strong key={i} className="font-semibold">{renderInline(n.c, onBild)}</strong>;
      case "i": return <em key={i}>{renderInline(n.c, onBild)}</em>;
      case "s": return <s key={i}>{renderInline(n.c, onBild)}</s>;
      case "code": return <code key={i} className="rounded-[6px] bg-o-selected px-1 py-px font-mono text-[13px] leading-[18px]">{n.s}</code>;
      case "bild": return <button key={i} type="button"
        className="rounded-o-sm underline decoration-o-line-strong underline-offset-2 focus-visible:outline-2 focus-visible:outline-o-focus"
        onClick={() => onBild ? onBild(n.bild) : oeffne(n.bild.url)}>{n.bild.filename} · Preview</button>;
      case "a":
        if (isOrbitLink(n.href)) return <OrbitLink key={i} href={n.href}>{renderInline(n.c, onBild)}</OrbitLink>;
        return (
          <a
            key={i}
            href={n.href}
            onClick={(e) => {
              e.preventDefault();
              oeffne(n.href);
            }}
            className="cursor-pointer underline decoration-o-line-strong underline-offset-2 hover:decoration-current"
          >
            {renderInline(n.c, onBild)}
          </a>
        );
    }
  });
}

/** Markdown in Blasen und Karten. Absätze haben 8 px Abstand, der Rest erbt Schrift und Farbe der Blase. */
export function Markdown({ text, onBild }: { text: string; onBild?: (d: Datei) => void }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="flex flex-col gap-2 [overflow-wrap:anywhere]" data-markdown>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p": {
            const [link] = b.c;
            if (b.c.length === 1 && link?.t === "a") {
              const id = /^https:\/\/cursor\.com\/agents\/(bc-[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(link.href)?.[1];
              if (id && link.c.length === 1 && link.c[0].t === "text" && link.c[0].s === `Cursor cloud agent · ${id}`) {
                return <a key={i} href={link.href} data-cursor-agent={id}
                  className="flex flex-col rounded-o-lg bg-o-selected px-3 py-2 hover:underline focus-visible:outline-o-focus"
                  onClick={(event) => { event.preventDefault(); oeffne(link.href); }}>
                  <span className="font-semibold">Cursor cloud agent</span>
                  <span className="text-o-text-2">{id}</span>
                </a>;
              }
            }
            return <p key={i}>{renderInline(b.c, onBild)}</p>;
          }
          case "h": return <p key={i} className="font-semibold">{renderInline(b.c, onBild)}</p>;
          case "hr": return <hr key={i} className="my-1 border-0 border-t border-solid border-o-line-strong" />;
          case "quote": return <blockquote key={i} className="border-0 border-l-2 border-solid border-o-line-strong pl-3 text-o-text-2">{renderInline(b.c, onBild)}</blockquote>;
          case "code":
            return (
              <pre key={i} className="m-0 overflow-x-auto rounded-o-lg bg-o-selected px-3 py-2 font-mono text-[13px] leading-[18px]">
                <code>{b.text}</code>
              </pre>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} start={b.ordered ? b.start : undefined} className={`m-0 flex flex-col gap-0.5 pl-5 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((it, j) => (
                  <li key={j} style={it.depth ? { marginLeft: it.depth * 16 } : undefined}>{renderInline(it.c, onBild)}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
