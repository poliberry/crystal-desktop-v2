#!/usr/bin/env bun
/**
 * Builds the SDK reference from the SDKs themselves: every exported class, function, constant,
 * interface and type in `sdk/bot` and `sdk/extension`, with its signature, its doc comment and its
 * members, written to src/studio/docs/reference.generated.ts. The reference can't say a method
 * exists when it doesn't, or give it a different signature than the code has, because it is read
 * from the code. What the reference says about a thing is whatever its doc comment says, so the
 * way to improve it is to write a better comment in the SDK.
 *
 *   bun scripts/build-reference.mjs           write the module
 *   bun scripts/build-reference.mjs --check   exit 1 if it is out of date
 *
 * Uses the TypeScript 5 compiler API (the `typescript5` dev dependency): the project's own
 * TypeScript is the native 7.x, which has no JavaScript API to read source with.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript5");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = join(root, "src/studio/docs/reference.generated.ts");

const KINDS = { bot: { dir: "sdk/bot", pkg: "@crystal/bot" }, extension: { dir: "sdk/extension", pkg: "@crystal/extension" } };

/** The text of a doc comment, with `{@link x}` turned into `x`, and tags pulled out. */
const KNOWN_TAGS = new Set(["param", "returns", "internal", "example", "deprecated", "see", "throws"]);

function docOf(symbol, checker) {
  const parts = symbol.getDocumentationComment(checker);
  const summary = ts.displayPartsToString(parts).trim();
  const tags = symbol.getJsDocTags(checker).map((t) => ({ name: t.name, text: ts.displayPartsToString(t.text ?? []).trim() }));
  // TypeScript reads any `@word` in a comment as a tag and ends the description there, so a stray one
  // (`@everyone`, `@livekit/…`, "without the @") silently cuts the text short. Fail loudly rather than publish that.
  const stray = tags.find((t) => !KNOWN_TAGS.has(t.name));
  if (stray) throw new Error(`The doc comment of ${symbol.getName()} has “@${stray.name}” in its text, which TypeScript takes for a tag and cuts the description there. Reword it to avoid an at-sign.`);
  const clean = (s) => s.replace(/\r/g, "").replace(/\{@link\s+([^}|\s]+)(?:[|\s][^}]*)?\}/g, "$1");
  return { summary: clean(summary), tags: tags.map((t) => ({ name: t.name, text: clean(t.text) })) };
}

const printer = ts.createPrinter({ removeComments: true });

function typeText(checker, type, node) {
  return checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope | ts.TypeFormatFlags.WriteArrowStyleSignature);
}

function signatureOf(checker, sig, node) {
  const params = sig.getParameters().map((p) => {
    const decl = p.valueDeclaration;
    const optional = !!decl && (ts.isParameter(decl) && (decl.questionToken || decl.initializer)) ;
    const rest = !!decl && ts.isParameter(decl) && !!decl.dotDotDotToken;
    return {
      name: p.getName(),
      type: typeText(checker, checker.getTypeOfSymbolAtLocation(p, decl ?? node), node),
      optional: !!optional,
      rest,
      doc: ts.displayPartsToString(p.getDocumentationComment(checker)).trim(),
    };
  });
  const returns = typeText(checker, sig.getReturnType(), node);
  const text = `(${params.map((p) => `${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ")}) => ${returns}`;
  const tags = sig.getJsDocTags().map((t) => ({ name: t.name, text: ts.displayPartsToString(t.text ?? []).trim() }));
  const returnsDoc = tags.find((t) => t.name === "returns")?.text ?? "";
  return { params, returns, text, returnsDoc, doc: ts.displayPartsToString(sig.getDocumentationComment(checker)).trim() };
}

let sdkDir = "";
const isPublicMember = (sym) => {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return false;
  // Inherited from the standard library (`Map`'s methods, `Error`'s message) is not the SDK's to document.
  if (!decl.getSourceFile().fileName.startsWith(sdkDir)) return false;
  const flags = ts.getCombinedModifierFlags(decl);
  if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false;
  if (sym.getName().startsWith("_") || sym.getName().startsWith("#")) return false;
  // `@internal` marks what is exported for the SDK's own files.
  return !sym.getJsDocTags().some((t) => t.name === "internal");
};

function membersOf(checker, type, node) {
  const out = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    if (!isPublicMember(prop)) continue;
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    const t = checker.getTypeOfSymbolAtLocation(prop, decl ?? node);
    const sigs = t.getCallSignatures();
    const base = { name: prop.getName(), doc: docOf(prop, checker), optional: !!(prop.flags & ts.SymbolFlags.Optional), readonly: !!decl && !!(ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly) };
    // Anything callable is a method, however it is written: a class method, an arrow function in a
    // class field, or a function in an object literal like `ui.row`.
    const isMethod = sigs.length > 0 && !(prop.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor));
    if (isMethod && sigs.length) out.push({ ...base, kind: "method", signatures: sigs.map((s) => signatureOf(checker, s, node)), static: false });
    else if (prop.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) out.push({ ...base, kind: "accessor", type: typeText(checker, t, node), static: false });
    else out.push({ ...base, kind: "property", type: typeText(checker, t, node), static: false });
  }
  return out;
}

export function extract(kind) {
  const { dir, pkg } = KINDS[kind];
  const entry = join(root, dir, "index.ts");
  sdkDir = join(root, dir) + "/";
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts"],
    types: kind === "bot" ? ["node"] : [],
    typeRoots: [join(root, "node_modules/@types")],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const items = [];
  for (const exp of checker.getExportsOfModule(moduleSymbol)) {
    const name = exp.getName();
    const aliased = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    const decl = aliased.declarations?.[0];
    if (!decl) continue;
    const file = relative(join(root, dir), decl.getSourceFile().fileName).split("\\").join("/");
    if (file.startsWith("..")) continue; // from node_modules or the standard library
    if (aliased.getJsDocTags().some((t) => t.name === "internal")) continue;
    const doc = docOf(aliased, checker);
    const base = { name, doc, file };

    if (aliased.flags & ts.SymbolFlags.Class) {
      const classType = checker.getDeclaredTypeOfSymbol(aliased);
      const ctorType = checker.getTypeOfSymbolAtLocation(aliased, decl);
      const ctors = ctorType.getConstructSignatures().map((s) => signatureOf(checker, s, decl));
      const staticMembers = checker.getPropertiesOfType(ctorType).filter((p) => !["prototype"].includes(p.getName()) && isPublicMember(p)).map((p) => {
        const d = p.valueDeclaration ?? p.declarations?.[0];
        const t = checker.getTypeOfSymbolAtLocation(p, d ?? decl);
        const sigs = t.getCallSignatures();
        return sigs.length && d && (ts.isMethodDeclaration(d)) ? { name: p.getName(), kind: "method", static: true, optional: false, readonly: false, doc: docOf(p, checker), signatures: sigs.map((s) => signatureOf(checker, s, decl)) } : { name: p.getName(), kind: "property", static: true, optional: false, readonly: !!d && !!(ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly), doc: docOf(p, checker), type: typeText(checker, t, decl) };
      });
      const heritage = (decl.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.getText()));
      items.push({ ...base, kind: "class", extends: heritage[0] ?? null, constructors: ctors, members: [...staticMembers, ...membersOf(checker, classType, decl)] });
    } else if (aliased.flags & ts.SymbolFlags.Interface) {
      const t = checker.getDeclaredTypeOfSymbol(aliased);
      items.push({ ...base, kind: "interface", members: membersOf(checker, t, decl) });
    } else if (aliased.flags & ts.SymbolFlags.TypeAlias) {
      const t = checker.getDeclaredTypeOfSymbol(aliased);
      items.push({ ...base, kind: "type", definition: ts.isTypeAliasDeclaration(decl) ? printer.printNode(ts.EmitHint.Unspecified, decl.type, decl.getSourceFile()) : typeText(checker, t, decl) });
    } else if (aliased.flags & (ts.SymbolFlags.Function)) {
      const t = checker.getTypeOfSymbolAtLocation(aliased, decl);
      items.push({ ...base, kind: "function", signatures: t.getCallSignatures().map((s) => signatureOf(checker, s, decl)) });
    } else if (aliased.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.BlockScopedVariable)) {
      const t = checker.getTypeOfSymbolAtLocation(aliased, decl);
      const props = t.getProperties();
      // An object of functions (`ui`, `storage`, `http`) is documented by its members; a plain value by its type.
      const objectLike = props.length > 0 && !t.getCallSignatures().length && props.every((p) => isPublicMember(p));
      if (objectLike && props.some((p) => checker.getTypeOfSymbolAtLocation(p, decl).getCallSignatures().length)) {
        items.push({ ...base, kind: "namespace", members: membersOf(checker, t, decl) });
      } else if (t.getCallSignatures().length) {
        items.push({ ...base, kind: "function", signatures: t.getCallSignatures().map((s) => signatureOf(checker, s, decl)) });
      } else {
        const isConst = ts.isVariableDeclaration(decl) && (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0;
        items.push({ ...base, kind: "constant", type: typeText(checker, t, decl), value: isConst && decl.initializer && decl.initializer.getText().length < 400 ? decl.initializer.getText() : null });
      }
    }
  }
  // Stable order: by kind group, then name.
  const rank = { class: 0, namespace: 1, function: 2, constant: 3, interface: 4, type: 5 };
  items.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
  const version = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).version;
  return { kind, package: pkg, version, items };
}

/** The text of the generated module. */
export function renderModule() {
  const data = { bot: extract("bot"), extension: extract("extension") };
  return `// GENERATED by scripts/build-reference.mjs from sdk/bot and sdk/extension — do not edit by hand.
// Run \`bun scripts/build-reference.mjs\` after changing an SDK's exports or doc comments.
import type { SdkReference } from "@/studio/docs/reference";

export const SDK_REFERENCE: Record<"bot" | "extension", SdkReference> = ${JSON.stringify(data, null, 1)};
`;
}

export function writeReference() {
  const text = renderModule();
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== text) {
    writeFileSync(OUT, text);
    return true;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const stale = (existsSync(OUT) ? readFileSync(OUT, "utf8") : "") !== renderModule();
    if (stale) {
      console.error("[reference] reference.generated.ts is out of date. Run: bun scripts/build-reference.mjs");
      process.exit(1);
    }
    console.log("[reference] up to date");
  } else {
    console.log(writeReference() ? "[reference] wrote src/studio/docs/reference.generated.ts" : "[reference] up to date");
  }
}
