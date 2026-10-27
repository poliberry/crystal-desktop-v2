---
title: Limits and the sandbox
topic: extensions
kind: reference
section: Reference
order: 170
summary: How much an extension may use, and what happens when it goes over.
---

Your code runs in an isolated JavaScript engine inside a Web Worker, away from the page and the person's account. It has these limits, enforced inside the sandbox and watched from outside, so a sandbox that stopped enforcing them would still be stopped.

{{extension-limits}}

## What happens when it goes over

Crystal stops the extension and tells the person why, in plain words: it was using too much of the processor, it ran out of memory, it stopped responding, it was sending too many requests. Fix the cause and send a new version. Staff can also suspend an extension that misbehaves.

## What exists in the sandbox

| There | Not there |
| --- | --- |
| The JavaScript language, `JSON`, `Math`, `Date`, `Promise`, `Map`, `Set`, `RegExp` | `window`, `document`, `localStorage`, `navigator` |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` | `fetch`, `XMLHttpRequest`, `WebSocket` (use `http.fetch`) |
| `console.log`, `info`, `warn`, `error` (shown in the Run output) | `require`, `import()`, `eval`, `new Function` |
| The `@crystal/extension` SDK | Any other package |

The editor already knows this: it has no DOM library, so `window` is underlined as an unknown name before you ever run anything.

## Tips for staying inside the budget

- Do the work in response to something (`onOpen`, `onAction`, a timer) and finish quickly. A handler gets a fraction of a second.
- Don't redraw in a loop. Change state when something changes.
- Keep stored values small; store ids and settings, not whole responses.
