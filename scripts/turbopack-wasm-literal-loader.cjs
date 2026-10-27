/**
 * Turbopack loader: re-encode the WebAssembly that `@jitl/quickjs-singlefile-browser-*` embeds as a
 * template literal, so the production minifier can't corrupt it.
 *
 * The problem: the single-file QuickJS build carries its ~800 KB .wasm as one template literal full
 * of NUL bytes (`\x00`), some of them followed by a digit (`\x000`). Turbopack's production minifier
 * re-prints the literal and shortens `\x00` to `\0`, so `\x000` becomes `\00` — a legacy octal escape,
 * which is a SyntaxError inside a template literal. The chunk then can't be parsed, and the extension
 * Worker that imports it dies with "Octal escape sequences are not allowed in template strings".
 * `next dev` doesn't minify, so it only shows up in a production build.
 *
 * The fix: before the minifier sees it, swap the literal for `atob("<base64>")`. It yields the same
 * binary string the original literal did, and base64 is plain ASCII, so there is nothing to mangle.
 *
 * It finds the literal by the WebAssembly magic number (`\0asm`) rather than by variable names, so it
 * survives the package being rebuilt. If it can't find it, it fails the build instead of quietly
 * shipping a broken worker.
 *
 * Wired up in `next.config.ts` under `turbopack.rules`. Drop it once the minifier is fixed upstream
 * (check by building without it and running `node --check` over `out/_next/static/chunks/*.js`).
 */
module.exports = function wasmLiteralLoader(source) {
  const open = source.indexOf("`\\0asm");
  if (open === -1) {
    throw new Error(
      "turbopack-wasm-literal-loader: no embedded WebAssembly template literal found in " +
        this.resourcePath +
        ". The package changed shape; this loader can be removed or needs updating.",
    );
  }

  const bodyStart = open + 1;
  let end = bodyStart;
  for (; end < source.length; end++) {
    if (source[end] === "\\") end++;
    else if (source[end] === "`") break;
  }
  if (end >= source.length) throw new Error("turbopack-wasm-literal-loader: unterminated template literal");

  // Evaluate the literal exactly as the browser would, to get the binary string it stood for.
  const binary = (0, eval)("`" + source.slice(bodyStart, end) + "`");
  for (let i = 0; i < binary.length; i++) {
    if (binary.charCodeAt(i) > 0xff) throw new Error("turbopack-wasm-literal-loader: literal is not a binary string");
  }

  const base64 = Buffer.from(binary, "latin1").toString("base64");
  return source.slice(0, open) + 'atob("' + base64 + '")' + source.slice(end + 1);
};
