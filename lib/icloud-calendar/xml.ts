// Deliberately limited XML reader: no DTD, external resources or entity declarations.
export interface XmlNode { name: string; text: string; children: XmlNode[] }

export function parseXml(xml: string): XmlNode {
  const fail = (): never => { throw new Error("Ungültige CalDAV-XML-Antwort."); };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail();
  const decode = (value: string): string => value.replace(/&([^;]*);|&/g, (_whole, entity: string) => {
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", apos: "'", quot: '"' };
    if (Object.hasOwn(known, entity)) return known[entity];
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity ?? "")) return fail();
    const point = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!(point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff))) return fail();
    return String.fromCodePoint(point);
  });
  const root: XmlNode = { name: "", text: "", children: [] };
  const stack = [{ node: root, tag: "", namespaces: {} as Record<string, string> }];
  let offset = 0, nodes = 0;
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== offset) fail();
    const token = match[0]; offset += token.length;
    const top = stack[stack.length - 1];
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) { if (stack.length === 1) fail(); top.node.text += token.slice(9, -3); continue; }
    if (!token.startsWith("<")) { if (stack.length === 1 && token.trim()) fail(); top.node.text += decode(token); continue; }
    if (token.startsWith("</")) {
      if (stack.length === 1 || token !== `</${top.tag}>`) fail();
      stack.pop(); continue;
    }
    const opening = /^<([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!opening || ++nodes > 20000 || stack.length > 32) fail();
    const [, tag, attributes, selfClosing] = opening!;
    const namespaces = { ...top.namespaces };
    const seen = new Set<string>();
    let consumed = 0;
    const attrPattern = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
    for (const attr of attributes.matchAll(attrPattern)) {
      if (attr.index !== consumed || seen.has(attr[1])) fail();
      consumed += attr[0].length; seen.add(attr[1]);
      const value = decode(attr[2] ?? attr[3]);
      if (attr[1] === "xmlns") namespaces[""] = value;
      else if (attr[1].startsWith("xmlns:")) namespaces[attr[1].slice(6)] = value;
    }
    if (attributes.slice(consumed).trim()) fail();
    const parts = tag.split(":");
    if (parts.length > 2 || (parts.length === 2 && !namespaces[parts[0]])) fail();
    const node: XmlNode = { name: `${namespaces[parts.length === 2 ? parts[0] : ""] ?? ""}|${parts.at(-1)}`, text: "", children: [] };
    top.node.children.push(node);
    if (!selfClosing) stack.push({ node, tag, namespaces });
  }
  if (offset !== xml.length || stack.length !== 1 || root.children.length !== 1) fail();
  return root.children[0];
}

export const children = (node: XmlNode, name: string): XmlNode[] => node.children.filter(child => child.name === name);
export const child = (node: XmlNode, name: string): XmlNode | undefined => children(node, name)[0];
