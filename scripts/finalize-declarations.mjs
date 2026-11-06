/** Make emitted declaration specifiers valid for ESM NodeNext consumers. */
import { readdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function finalize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await finalize(path); continue; }
    if (!entry.name.endsWith(".d.ts")) continue;
    let text = await readFile(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const specifiers = [];
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        specifiers.push(node.argument.literal);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const specifier of specifiers.sort((a, b) => b.getStart(source) - a.getStart(source))) {
      const name = specifier.text;
      if (!name.startsWith(".") || /\.[cm]?js$/.test(name)) continue;
      const target = resolve(dirname(path), name);
      const suffix = await exists(`${target}.d.ts`) ? ".js" : await exists(join(target, "index.d.ts")) ? "/index.js" : null;
      if (!suffix) throw new Error(`Unresolved declaration import ${name} in ${path}`);
      text = text.slice(0, specifier.getStart(source)) + JSON.stringify(name + suffix) + text.slice(specifier.getEnd());
    }
    await writeFile(path, text);
  }
}

await finalize(fileURLToPath(new URL("../dist", import.meta.url)));
