---
title: Sending it for review
topic: extensions
kind: guide
section: Shipping
order: 150
summary: Versions, what a reviewer reads, and what happens after it is approved.
---

## Before you send

1. **Build.** The built script, `dist/extension.js`, is what is checked and what is reviewed.
2. **Run** it once and use every button. The test run is the real sandbox, with the network simulated and storage thrown away afterwards.
3. Read the **Checks** in the project settings. Errors stop you sending; warnings are worth reading.
4. Write a real description (at least a sentence) and set the **version**. Each submission needs a new one, like `1.0.1`.

## What a reviewer reads

**Every version** is read by a person before anyone can install it. They read the **built script**, not your TypeScript, so a readable build helps; the build keeps your file names in the comments so they can find their way around.

They check that the code does what the description says, that every power it asks for is used, and that nothing tries to get out of the sandbox. The sandbox is what actually enforces limits; the review is about trust.

## After approval

- People install it from the Marketplace. Their copy runs the exact script that was approved, checked by its hash each time it starts, so nothing can be swapped afterwards.
- Staff can revoke a version, or suspend the whole extension, everywhere at once.
- Once a version is approved, Studio offers a **link** (`…/oauth/authorize?client_id=<id>&scope=extension`) that adds it to someone's account, showing the powers it asks for. See [links that open in the app](doc:general/links).
- Removing the extension deletes its stored data and revokes what it was given.

## Updating

Change the code, build, and send it again. Studio notices the extension is already published and says so: it shows which version is live and which is waiting, offers the next version number (`1.0.1` after `1.0.0`), and the button becomes **Send update for review**.

- **A new version is reviewed like the first one.** The version that is live stays live, and the store page keeps showing it, until the new one is approved. Then the page takes the new version's name and description, and people who have it installed are offered the update.
- **The number has to be newer than every version you've sent.** The same number twice, or one lower than something already sent, is refused with the number to use instead. Numbers compare as numbers: `1.10.0` is newer than `1.9.0`.
- **Spotted a mistake while it's waiting?** Fix it and send again: the version still in the queue is replaced, so you don't have to withdraw it or wait. A version that has already been reviewed is never replaced.
- **Turned down?** The live version is untouched. Studio shows the reviewer's note; fix it and send it again.
- A change that asks for a new power or site is the part the reviewer looks at hardest.

Publishing is limited to Crystal staff while the runtime is rolled out. You can still build and test everything here.
