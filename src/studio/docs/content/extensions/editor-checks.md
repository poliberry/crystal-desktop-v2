---
title: What the editor checks as you type
topic: extensions
kind: guide
section: Building
order: 140
summary: TypeScript's errors, and Crystal's own checks for powers, forbidden code, imports and sites.
---

The code editor is Monaco, the editor inside VS Code, so type errors, completions, hover documentation and *Go to definition* work the way you expect. Because the SDK's source is in your project, hovering `ui.button` shows its documentation and F12 takes you to it.

On top of TypeScript, Crystal checks the things that would stop an extension being approved. They are underlined like any other problem, marked **Crystal**, and listed in the Problems panel.

## A power used but not asked for

Using `storage`, `http`, `notify`, `ui` or `Panel` without ticking the matching power in **What it asks for** is an error, underlined where you use it. Tick it in the project settings and the underline goes away.

## Code that builds code

`eval(…)`, `new Function(…)`, `import(…)`, `constructor.constructor` and `setTimeout("string")` are errors. They make code that doesn't exist until it runs, and a reviewer can only approve what they can read.

## Imports

You can import your own files and `@crystal/extension`. Anything else is an error at the import, because the sandbox runs one script.

## Sites

When the network power is on, any web address written in your code that isn't in **Sites it may talk to** is a warning, and plain `http://` is flagged because only https can be reached.

## Snippets

Type `crystal-extension` for a complete starting point, or `onAction`, `onOpen`, `panel`, `storage-load-save`, `http-json`, `notify` and `ui-form` for the shapes you write most. Each describes which power it needs.

## Checks before review

**Build** then runs the server's own checks on the finished script, the same ones a submission goes through, and lists the result under *Checks* in the project settings. Fix errors before you send it.

~~~ts extension
// Everything Crystal flags, for reference. Don't write this.
import { Extension } from "@crystal/extension";

const ext = new Extension();
ext.onOpen(() => {
  // eval("1 + 1");            error: builds code at run time
  // fetch("https://x.test");  not defined in the sandbox: use http.fetch
});
~~~
