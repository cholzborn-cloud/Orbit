// Erzeugt engine.gen.ts und avatars.gen.ts aus ../mac/Orbit/Figures/AvatarAnimData.swift (Quelle der Wahrheit).
// Aufruf: node src/orbi/gen.mjs
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../../../mac/Orbit/Figures/AvatarAnimData.swift", import.meta.url), "utf8");
const engine = source.match(/static let js = ##"([\s\S]*?)"##/)[1];
const fast = engine.replace("Se=25,Ce=73,V=144,we=33,Te=73", "Se=25,Ce=73,V=72,we=33,Te=73");
if (fast === engine) throw new Error("Konstante V nicht gefunden");
const wrap = (name, js) => `export const ${name}: Engine = (function () {\n${js}\nreturn AvatarProceduralEngine;\n})();\n`;
writeFileSync(new URL("./engine.gen.ts", import.meta.url),
  `// @ts-nocheck\n// GENERIERT von gen.mjs aus mac/Orbit/Figures/AvatarAnimData.swift. Nicht von Hand ändern.\n` +
  `import type { Engine } from "./engineTypes";\n${wrap("engineFine", engine)}${wrap("engineFast", fast)}`);

const avatars = {};
for (const [, name, json] of source.matchAll(/"([a-z]+)": ##"([^\n]*)"##,/g)) {
  const a = JSON.parse(json);
  avatars[name] = { surface: a.surface, bodyNodes: a.bodyNodes, neutral: a.expressions["expression-neutral"] };
}
writeFileSync(new URL("./avatars.gen.ts", import.meta.url),
  `// GENERIERT von gen.mjs aus mac/Orbit/Figures/AvatarAnimData.swift. Nicht von Hand ändern.\n` +
  `import type { AvatarDef } from "./engineTypes";\nexport const AVATARS: Record<string, AvatarDef> = ${JSON.stringify(avatars)};\n`);
console.log(Object.keys(avatars).length, "Avatare");
