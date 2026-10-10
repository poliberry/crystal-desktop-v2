---
title: What an extension is
topic: extensions
kind: guide
section: Start here
order: 100
summary: A small program that adds a panel to Crystal, and runs in a sandbox on the person's own computer.
---

An **extension** adds a panel to Crystal. You describe the panel (text, buttons, lists, inputs) and say what happens when somebody uses it. Crystal draws the panel with its own components, in the person's own theme.

Your code runs on the **person's computer**, inside a sandbox: a bare JavaScript engine with no window, no page, no network and no files of its own. The only way out is the SDK, and it only works for the *powers* your extension asked for and the person agreed to.

## How it fits together

- You write ordinary **TypeScript** in a project folder, in the code editor in Studio (or in VS Code, if you prefer: it's just a folder).
- You import everything from one package, `@crystal/extension`. Studio copies its source into `.crystal/sdk/extension` in your project, so you can read it and press F12 on anything to jump to it.
- **Build** bundles your files into one plain script, `dist/extension.js`. That script, not your TypeScript, is what Crystal's reviewers read and what runs.
- **Run** tries it in the real sandbox, the same one a person gets, with the network simulated.
- **Send for review** submits it. Every version is read by a person before anyone can install it.

## What it can't do

- It can't draw its own HTML, CSS or scripts. A panel is a tree of Crystal's own components, so it can't pass itself off as part of Crystal.
- It can't import other packages. The sandbox runs one script, so you can use your own files (`./helpers`) and `@crystal/extension`, nothing else.
- It can't build code at run time (`eval`, `new Function`, `import()`): a reviewer can only approve what they can read.
- It can only reach the internet through the sites you list, over https.

## Where next

1. [Your first extension](doc:extensions/first-extension)
2. [Building panels](doc:extensions/panels)
3. [Powers: storage, the internet and notices](doc:extensions/powers)
4. [Limits and the sandbox](doc:extensions/limits)
5. [What the editor checks as you type](doc:extensions/editor-checks)
6. [Sending it for review](doc:extensions/publishing)
