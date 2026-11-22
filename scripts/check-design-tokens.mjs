import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const visual = /#[\da-f]{6}\b|\b(?:spacing|cornerRadius|radius|duration|size|lineWidth|width|height|minWidth|idealWidth|maxWidth|minHeight|idealHeight|maxHeight|topLeadingRadius|bottomLeadingRadius|topTrailingRadius|bottomTrailingRadius):\s*-?\d|\.(?:padding|cornerRadius|lineSpacing|blur)\((?:\.[a-zA-Z]+,\s*)?-?\d|\.font\(Theme\.Fonts\.(?:geist|mono)\(\d/i;
for (const sample of [".padding(12)", ".padding(.top, 8)", "spacing: 4", "duration: 0.3", ".font(Theme.Fonts.geist(14))", 'Color("#ffffff")']) assert(visual.test(sample));
for (const sample of [".padding(Theme.Spacing.md)", "width: Theme.Layout.sidebar", "duration: Theme.Motion.highlight"]) assert(!visual.test(sample));
const issues = [];
let files = 0;
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith(".swift")) {
      files++;
      readFileSync(path, "utf8").split("\n").forEach((line, index) => {
        const source = line.split("//")[0];
        if (visual.test(source)) issues.push(`${relative(root, path)}:${index + 1}: ${source.trim()}`);
      });
    }
  }
}
visit(join(root, "mac/Orbit/Views"));
visit(join(root, "mac/Orbit/Orbis"));
console.log(`${files} Swift-Dateien: ${issues.length} feste Farb-/Layout-/Schrift-/Dauerwerte.`);
if (issues.length) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
}
