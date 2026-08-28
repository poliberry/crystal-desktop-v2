/**
 * Starting points for the custom-CSS editor.
 *
 * Writing custom CSS for an app you didn't build is mostly archaeology: you
 * can see the thing you want to change, but not what to call it. These
 * snippets are the answer to that — each one names a part of the interface,
 * gives the selector that actually matches it, and comes with a rule that does
 * something visible, so the first edit is a value rather than a guess.
 *
 * The selectors are `data-slot` attributes wherever possible. Those are set by
 * the primitives in src/components/ui and are the closest thing this codebase
 * has to a stable API for styling: Tailwind utility classes come and go as
 * components are edited, whereas a dialog has been `[data-slot="dialog-content"]`
 * since it was written.
 *
 * The theme snippet is the exception and the one worth reaching for first:
 * every colour in the app resolves through those variables, so overriding one
 * of them restyles hundreds of elements that no selector here mentions.
 */

export interface CssSnippet {
  key: string;
  /** What part of the app this is, in the words someone would use for it. */
  label: string;
  /** One line on what the rule below does, shown under the label. */
  hint: string;
  /** The CSS itself, inserted at the caret. */
  code: string;
}

export interface CssSnippetGroup {
  label: string;
  snippets: CssSnippet[];
}

export const CSS_SNIPPET_GROUPS: CssSnippetGroup[] = [
  {
    label: "Theme",
    snippets: [
      {
        key: "colours",
        label: "Every colour",
        hint: "The variables the whole interface resolves through. Start here.",
        code: `/* Every surface, border and label in the app reads these. */
:root {
  --background: oklch(0.14 0.01 285);
  --card: oklch(0.19 0.01 285);
  --popover: oklch(0.19 0.01 285);
  --primary: oklch(0.72 0.18 300);
  --accent: oklch(0.27 0.01 286);
  --border: oklch(1 0 0 / 12%);
  --muted-foreground: oklch(0.70 0.01 286);
}`,
      },
      {
        key: "radius",
        label: "Corner rounding",
        hint: "One number, applied to every rounded box.",
        code: `:root {
  /* 0 for square corners, 1rem for very round ones. */
  --radius: 0.625rem;
}`,
      },
      {
        key: "font",
        label: "Font",
        hint: "The typeface everything is set in.",
        code: `:root {
  --font-sans: "Inter", system-ui, sans-serif;
}`,
      },
    ],
  },
  {
    label: "Surfaces",
    snippets: [
      {
        key: "card",
        label: "Cards",
        hint: "Profile cards, settings panels, widgets.",
        code: `.bg-card,
[data-slot="card"] {
  background-color: color-mix(in oklab, var(--card) 70%, transparent);
  backdrop-filter: blur(10px);
  border-color: color-mix(in oklab, var(--primary) 30%, transparent);
}`,
      },
      {
        key: "dialog",
        label: "Dialogs",
        hint: "Every modal — settings, the profile editor, this one.",
        code: `[data-slot="dialog-content"] {
  border-radius: 1rem;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.55);
}

[data-slot="dialog-overlay"] {
  backdrop-filter: blur(4px);
}`,
      },
      {
        key: "menus",
        label: "Menus & popovers",
        hint: "Right-click menus, dropdowns, hover cards.",
        code: `[data-slot="dropdown-menu-content"],
[data-slot="context-menu-content"],
[data-slot="popover-content"],
[data-slot="hover-card-content"] {
  border-radius: 0.75rem;
  background-color: color-mix(in oklab, var(--popover) 85%, transparent);
  backdrop-filter: blur(12px);
}`,
      },
      {
        key: "tooltip",
        label: "Tooltips",
        hint: "The small labels on hover.",
        code: `[data-slot="tooltip-content"] {
  font-size: 0.75rem;
  border-radius: 0.5rem;
}`,
      },
    ],
  },
  {
    label: "Navigation",
    snippets: [
      {
        key: "sidebar",
        label: "Sidebars",
        hint: "The settings sidebar and any panel built on it.",
        code: `[data-slot="sidebar-inner"] {
  background-color: color-mix(in oklab, var(--sidebar) 80%, transparent);
}

[data-slot="sidebar-menu-button"][data-active="true"] {
  background-color: color-mix(in oklab, var(--primary) 22%, transparent);
}`,
      },
      {
        key: "tabs",
        label: "Tabs",
        hint: "Tab rows, and the underline on the selected one.",
        code: `[data-slot="tabs-trigger"][data-state="active"] {
  color: var(--primary);
  border-color: var(--primary);
}`,
      },
    ],
  },
  {
    label: "People",
    snippets: [
      {
        key: "avatar",
        label: "Avatars",
        hint: "Everywhere a person's picture appears.",
        code: `[data-slot="avatar"] {
  /* Squircles rather than circles. */
  border-radius: 30%;
}

[data-slot="avatar-image"],
[data-slot="avatar-fallback"] {
  border-radius: inherit;
}`,
      },
      {
        key: "decoration",
        label: "Avatar decorations",
        hint: "The frame drawn around an avatar.",
        code: `[data-slot="avatar-decoration"] {
  /* Bigger than the default 126% makes a frame sit further out. */
  width: 132%;
  height: 132%;
}`,
      },
      {
        key: "presence",
        label: "Presence dots",
        hint: "The online/away/busy dot on an avatar.",
        code: `[data-slot="avatar-badge"] {
  box-shadow: 0 0 0 2px var(--background);
}`,
      },
    ],
  },
  {
    label: "Chat",
    snippets: [
      {
        key: "message-hover",
        label: "Message rows",
        hint: "One row in a channel or a DM, and its hover treatment.",
        code: `[data-slot="message-row"] {
  padding-block: 0.25rem;
}

[data-slot="message-row"]:hover {
  background-color: color-mix(in oklab, var(--accent) 40%, transparent);
}`,
      },
      {
        key: "composer",
        label: "The message box",
        hint: "Where you type.",
        code: `[data-slot="textarea"] {
  border-radius: 1rem;
  background-color: color-mix(in oklab, var(--card) 60%, transparent);
}`,
      },
      {
        key: "scrollbar",
        label: "Scrollbars",
        hint: "The thin bars down the side of every scrolling panel.",
        code: `[data-slot="scroll-area-thumb"] {
  background-color: color-mix(in oklab, var(--primary) 50%, transparent);
}`,
      },
    ],
  },
  {
    label: "Controls",
    snippets: [
      {
        key: "buttons",
        label: "Buttons",
        hint: "Every button, and the primary variant on its own.",
        code: `[data-slot="button"] {
  border-radius: 0.75rem;
}

[data-slot="button"].bg-primary {
  background-image: linear-gradient(
    to bottom right,
    color-mix(in oklab, var(--primary) 90%, white),
    var(--primary)
  );
}`,
      },
      {
        key: "inputs",
        label: "Inputs",
        hint: "Text fields and the ring when one is focused.",
        code: `[data-slot="input"] {
  border-radius: 0.75rem;
}

[data-slot="input"]:focus-visible {
  --ring: var(--primary);
}`,
      },
      {
        key: "sliders",
        label: "Sliders",
        hint: "Volume, opacity, anything dragged.",
        code: `[data-slot="slider-range"] {
  background-color: var(--primary);
}

[data-slot="slider-thumb"] {
  border-color: var(--primary);
}`,
      },
      {
        key: "switch",
        label: "Switches",
        hint: "On/off toggles.",
        code: `[data-slot="switch"][data-state="checked"] {
  background-color: var(--primary);
}`,
      },
    ],
  },
  {
    label: "Windows",
    snippets: [
      {
        key: "hide-titlebar",
        label: "Hide a region",
        hint: "The shape of any “I don't want to see this” rule.",
        code: `/* Anything can be hidden this way. Be careful: hiding something you
   need is fixed by editing custom.css outside the app. */
/*
[data-slot="tooltip-content"] {
  display: none;
}
*/`,
      },
      {
        key: "density",
        label: "Tighter layout",
        hint: "Shrinks the base font, which most spacing follows.",
        code: `html {
  font-size: 15px;
}`,
      },
    ],
  },
];

/** Every snippet, flattened — for search. */
export const ALL_CSS_SNIPPETS: CssSnippet[] = CSS_SNIPPET_GROUPS.flatMap(
  (group) => group.snippets,
);
