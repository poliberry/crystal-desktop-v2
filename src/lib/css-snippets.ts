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

/* -------------------------------------------------------------------------- */
/* The index of names                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One targetable part of the interface.
 *
 * The snippets above are for somebody who knows what they want the app to look
 * like and not how to say it. This is the other half: an index for somebody who
 * knows CSS perfectly well and only needs to be told what this app calls its
 * parts. It exists because inspecting an element isn't always possible — the
 * thing you want to restyle may only appear on hover, or live inside a menu
 * that closes the moment the inspector opens.
 */
export interface CssSelectorEntry {
  selector: string;
  label: string;
  description: string;
}

export interface CssSelectorGroup {
  label: string;
  selectors: CssSelectorEntry[];
}

/** Every selector the app-wide stylesheet can rely on. */
export const CSS_SELECTOR_GROUPS: CssSelectorGroup[] = [
  {
    label: "Theme variables",
    selectors: [
      {
        selector: ":root",
        label: "Colour variables",
        description:
          "--background, --foreground, --card, --popover, --primary, --secondary, --muted, --accent, --destructive, --border, --input, --ring and --sidebar, each with a -foreground pair, plus --radius and --font-sans.",
      },
    ],
  },
  {
    label: "Surfaces",
    selectors: [
      { selector: '[data-slot="card"]', label: "Card", description: "Any card: settings panels, widgets, profile cards." },
      { selector: '[data-slot="card-header"]', label: "Card header", description: "The title row at the top of a card." },
      { selector: '[data-slot="card-title"]', label: "Card title", description: "A card's heading text." },
      { selector: '[data-slot="card-description"]', label: "Card description", description: "The line under a card's heading." },
      { selector: '[data-slot="card-content"]', label: "Card content", description: "Everything below a card's header." },
      { selector: '[data-slot="dialog-content"]', label: "Dialog", description: "Every modal box — settings, the profile editor, confirmations." },
      { selector: '[data-slot="dialog-overlay"]', label: "Dialog backdrop", description: "The dimmed layer behind an open dialog." },
      { selector: '[data-slot="dialog-title"]', label: "Dialog title", description: "A dialog's heading." },
      { selector: '[data-slot="popover-content"]', label: "Popover", description: "Profile popovers and anything else anchored to a control." },
      { selector: '[data-slot="hover-card-content"]', label: "Hover card", description: "The card shown when hovering a server or a name." },
      { selector: '[data-slot="tooltip-content"]', label: "Tooltip", description: "The small labels on hover." },
      { selector: '[data-slot="sheet-content"]', label: "Sheet", description: "Panels that slide in from an edge." },
    ],
  },
  {
    label: "Menus",
    selectors: [
      { selector: '[data-slot="dropdown-menu-content"]', label: "Dropdown menu", description: "The box of a dropdown." },
      { selector: '[data-slot="dropdown-menu-item"]', label: "Dropdown item", description: "One row in a dropdown." },
      { selector: '[data-slot="context-menu-content"]', label: "Right-click menu", description: "The box of a context menu." },
      { selector: '[data-slot="context-menu-item"]', label: "Right-click item", description: "One row in a context menu." },
      { selector: '[data-slot="context-menu-separator"]', label: "Menu separator", description: "The dividing line between menu groups." },
    ],
  },
  {
    label: "Navigation",
    selectors: [
      { selector: '[data-slot="sidebar-inner"]', label: "Sidebar", description: "The settings sidebar's panel." },
      { selector: '[data-slot="sidebar-menu-button"]', label: "Sidebar row", description: 'One navigation row. Add [data-active="true"] for the selected one.' },
      { selector: '[data-slot="sidebar-group-label"]', label: "Sidebar group label", description: "The small heading over a group of rows." },
      { selector: '[data-slot="tabs-list"]', label: "Tab bar", description: "The row a set of tabs sits in." },
      { selector: '[data-slot="tabs-trigger"]', label: "Tab", description: 'One tab. Add [data-state="active"] for the selected one.' },
    ],
  },
  {
    label: "Chat",
    selectors: [
      { selector: '[data-slot="message-row"]', label: "Message row", description: "One message in a channel or a DM, avatar and all." },
      { selector: '[data-slot="textarea"]', label: "Message box", description: "Where you type — and every other multi-line field." },
      { selector: '[data-slot="scroll-area-thumb"]', label: "Scrollbar", description: "The draggable bar in any scrolling panel." },
    ],
  },
  {
    label: "People",
    selectors: [
      { selector: '[data-slot="avatar"]', label: "Avatar", description: "The box around anybody's picture, anywhere." },
      { selector: '[data-slot="avatar-image"]', label: "Avatar picture", description: "The picture itself." },
      { selector: '[data-slot="avatar-fallback"]', label: "Avatar initials", description: "Shown when there is no picture." },
      { selector: '[data-slot="avatar-decoration"]', label: "Avatar decoration", description: "The frame drawn around an avatar." },
      { selector: '[data-slot="avatar-badge"]', label: "Presence dot", description: "The online/away/busy dot on an avatar." },
      { selector: '[data-slot="profile-card"]', label: "Profile card", description: "Somebody's profile card, wherever it appears." },
    ],
  },
  {
    label: "Controls",
    selectors: [
      { selector: '[data-slot="button"]', label: "Button", description: "Every button. Combine with .bg-primary for the accented ones." },
      { selector: '[data-slot="input"]', label: "Text field", description: "Single-line inputs." },
      { selector: '[data-slot="checkbox"]', label: "Checkbox", description: 'Add [data-state="checked"] for the ticked state.' },
      { selector: '[data-slot="switch"]', label: "Switch", description: 'Add [data-state="checked"] for the on state.' },
      { selector: '[data-slot="slider-range"]', label: "Slider fill", description: "The filled part of a slider's track." },
      { selector: '[data-slot="slider-thumb"]', label: "Slider handle", description: "The draggable knob." },
      { selector: '[data-slot="badge"]', label: "Badge", description: "Small pills — role tags, counts." },
      { selector: '[data-slot="separator"]', label: "Separator", description: "A dividing line." },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Profile cards                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What a profile stylesheet can reach.
 *
 * A shorter list than the one above, deliberately: profile CSS is confined to
 * the profile it belongs to (see src/lib/scoped-css.ts), so a selector for the
 * sidebar would simply never match. Offering one would be inviting somebody to
 * write a rule and then wonder why nothing happened.
 *
 * "The profile" means the card *and* the full page it opens into — the board,
 * the activity list and the tabs above them are all equally the owner's, and a
 * stylesheet that could only reach the card in the corner would be a strange
 * half-measure.
 *
 * The `:root` entry is worth reading twice — inside a scoped sheet the root
 * *is* the card, so setting --card or --primary there restyles everything on it
 * at once, and is almost always the right first move.
 */
export const PROFILE_CSS_SELECTOR_GROUPS: CssSelectorGroup[] = [
  {
    label: "The page",
    selectors: [
      {
        selector: '[data-slot="profile-page"]',
        label: "Whole page",
        description:
          "The full-page profile — everything, card and board and all. Set a background here and it's behind the lot.",
      },
      {
        selector: '[data-slot="profile-page-backdrop"]',
        label: "Blurred backdrop",
        description: "The tint your banner throws across the page behind everything.",
      },
      {
        selector: '[data-slot="profile-page-header"]',
        label: "Header bar",
        description: "The strip at the top with your name and the close button.",
      },
      {
        selector: '[data-slot="profile-page-body"]',
        label: "Layout",
        description:
          "The two-column grid. Change grid-template-columns here to give the card more or less room.",
      },
      {
        selector: '[data-slot="profile-page-card-column"]',
        label: "Card column",
        description: "The left column, which holds the card.",
      },
      {
        selector: '[data-slot="profile-page-panel"]',
        label: "Right panel",
        description: "The column holding the tabs and whatever they show.",
      },
      {
        selector: '[data-slot="profile-page-tabs"]',
        label: "Tab row",
        description: "Board and Activity, and the line under them.",
      },
      {
        selector: '[data-slot="profile-page-tab"]',
        label: "One tab",
        description: 'Add [data-state="active"] for the selected one.',
      },
    ],
  },
  {
    label: "Board",
    selectors: [
      {
        selector: '[data-slot="profile-board"]',
        label: "The board",
        description:
          "The grid your widgets sit in. grid-template-columns here changes how many go across.",
      },
      {
        selector: '[data-slot="profile-widget"]',
        label: "A widget",
        description: "One card on your board.",
      },
      {
        selector: '[data-slot="profile-widget-image"]',
        label: "Widget image",
        description: "The picture across the top of a widget.",
      },
      {
        selector: '[data-slot="profile-widget-title"]',
        label: "Widget title",
        description: "A widget's heading.",
      },
      {
        selector: '[data-slot="profile-widget-description"]',
        label: "Widget text",
        description: "A widget's description.",
      },
    ],
  },
  {
    label: "The card",
    selectors: [
      {
        selector: ":root",
        label: "Variables, for this card only",
        description:
          "Inside your profile's stylesheet the root is the card. Set --card, --primary, --border, --muted-foreground or --radius here to restyle everything on it at once.",
      },
      { selector: '[data-slot="profile-card"]', label: "The whole card", description: "The outer box, including the gradient border." },
      { selector: '[data-slot="profile-card-inner"]', label: "Card body", description: "Everything inside the border — this is what carries the background." },
      { selector: '[data-slot="profile-banner"]', label: "Banner", description: "The picture across the top." },
    ],
  },
  {
    label: "Identity",
    selectors: [
      { selector: '[data-slot="profile-identity"]', label: "Name block", description: "The name, handle and badges together." },
      { selector: '[data-slot="profile-name"]', label: "Display name", description: "Your name. A gradient here needs background-clip: text." },
      { selector: '[data-slot="profile-username"]', label: "Username", description: "The @handle under your name." },
      { selector: '[data-slot="profile-badges"]', label: "Badge row", description: "The strip of earned badges." },
      { selector: '[data-slot="avatar"]', label: "Avatar", description: "Your picture on this card." },
      { selector: '[data-slot="avatar-decoration"]', label: "Avatar decoration", description: "The frame around it." },
      { selector: '[data-slot="avatar-badge"]', label: "Presence dot", description: "The status dot on the avatar." },
    ],
  },
  {
    label: "Content",
    selectors: [
      { selector: '[data-slot="profile-body"]', label: "Body", description: "Everything under the name — bio, roles, dates." },
      { selector: '[data-slot="profile-bio"]', label: "Bio", description: "Your bio text." },
      { selector: '[data-slot="profile-member-since"]', label: "Member since", description: "The join-date block." },
      { selector: '[data-slot="badge"]', label: "Role tags", description: "The pills listing your roles in a server." },
      { selector: '[data-slot="profile-actions"]', label: "Corner buttons", description: "Expand, edit and settings, top right." },
      { selector: '[data-slot="button"]', label: "Buttons", description: "Message, add friend, and the rest." },
    ],
  },
];

/** Starting points for a profile's own stylesheet. Short, because a card is a
 * small thing and most of what people want from one is a colour and a corner. */
export const PROFILE_CSS_SNIPPET_GROUPS: CssSnippetGroup[] = [
  {
    label: "Whole page",
    snippets: [
      {
        key: "profile-page-background",
        label: "Page background",
        hint: "A picture or gradient behind your whole profile page.",
        code: `[data-slot="profile-page"] {
  background-image: linear-gradient(160deg, #1b1030, #2b1244 60%, #401a3a);
}

/* Turn the banner's blur down so it doesn't wash the above out. */
[data-slot="profile-page-backdrop"] {
  opacity: 0.08;
}`,
      },
      {
        key: "profile-page-columns",
        label: "Wider card column",
        hint: "Gives the card more of the page and the board less.",
        code: `[data-slot="profile-page-body"] {
  grid-template-columns: 460px 1fr;
}`,
      },
      {
        key: "profile-board-columns",
        label: "Board in one column",
        hint: "Stacks your widgets instead of pairing them.",
        code: `[data-slot="profile-board"] {
  grid-template-columns: 1fr;
}`,
      },
      {
        key: "profile-widget",
        label: "Widget styling",
        hint: "The cards on your board.",
        code: `[data-slot="profile-widget"] {
  border-radius: 1rem;
  background-color: color-mix(in oklab, var(--card) 65%, transparent);
  border-color: color-mix(in oklab, var(--primary) 35%, transparent);
}`,
      },
    ],
  },
  {
    label: "Whole card",
    snippets: [
      {
        key: "profile-colours",
        label: "Recolour everything",
        hint: "Sets the variables the card resolves through. Start here.",
        code: `/* The root is your card — these reach everything on it. */
:root {
  --card: oklch(0.18 0.03 300);
  --primary: oklch(0.78 0.16 330);
  --border: oklch(1 0 0 / 15%);
  --muted-foreground: oklch(0.75 0.02 300);
  --radius: 1rem;
}`,
      },
      {
        key: "profile-glass",
        label: "Glassy",
        hint: "A translucent card with a blur behind it.",
        code: `[data-slot="profile-card-inner"] {
  background-color: color-mix(in oklab, var(--card) 55%, transparent);
  backdrop-filter: blur(12px);
}`,
      },
      {
        key: "profile-glow",
        label: "Outer glow",
        hint: "A soft coloured halo around the card.",
        code: `[data-slot="profile-card"] {
  box-shadow: 0 0 32px color-mix(in oklab, var(--primary) 45%, transparent);
}`,
      },
    ],
  },
  {
    label: "Details",
    snippets: [
      {
        key: "profile-name-gradient",
        label: "Gradient name",
        hint: "Paints your display name with a gradient.",
        code: `[data-slot="profile-name"] {
  background-image: linear-gradient(90deg, #f0abfc, #7dd3fc);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}`,
      },
      {
        key: "profile-banner",
        label: "Taller banner",
        hint: "More of the picture, less of the card.",
        code: `[data-slot="profile-banner"] {
  height: 12rem;
  opacity: 1;
}`,
      },
      {
        key: "profile-avatar",
        label: "Round avatar",
        hint: "A circle instead of a squircle.",
        code: `[data-slot="avatar"],
[data-slot="avatar-image"],
[data-slot="avatar-fallback"] {
  border-radius: 9999px;
}`,
      },
      {
        key: "profile-bio",
        label: "Quoted bio",
        hint: "Sets your bio off with a rule down its side.",
        code: `[data-slot="profile-bio"] {
  border-left: 2px solid var(--primary);
  padding-left: 0.75rem;
  font-style: italic;
}`,
      },
    ],
  },
];
