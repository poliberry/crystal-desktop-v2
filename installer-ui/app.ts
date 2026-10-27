import { formatBytes } from "../electron/installer/format";
import type { InstallerApi } from "../electron/installer/preload";
import type { InstallState, ResolvedPlan } from "../electron/installer/engine";

/**
 * The installer's wizard. Five steps — Welcome, Components, Location, Install, Finish — drawn into one page. It holds the
 * choices; everything that touches the computer is the main process's (electron/installer/main.ts), reached through
 * `window.installer`.
 */

declare global {
  interface Window {
    installer: InstallerApi;
  }
}

type Id = "crystal" | "studio";
type Step = "welcome" | "components" | "location" | "install" | "finish";
const STEPS: { id: Step; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "components", label: "Components" },
  { id: "location", label: "Location" },
  { id: "install", label: "Install" },
  { id: "finish", label: "Finish" },
];

const api = window.installer;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const S = {
  step: "welcome" as Step,
  info: null as Awaited<ReturnType<InstallerApi["info"]>> | null,
  plan: null as ResolvedPlan | null,
  planError: null as string | null,
  loading: true,
  selected: new Set<Id>(),
  base: "",
  shortcut: true,
  folderError: null as string | null,
  targets: {} as Record<Id, string>,
  inst: { phase: "idle", progress: 0, items: [], error: null } as InstallState,
  launch: new Set<Id>(),
};

/** Text from outside (the release, a folder name) is never put into the page as markup. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="#04130c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.6l3 3 6.6-7"/></svg>';
const ICON: Record<Id, string> = { crystal: "icon.png", studio: "icon-studio.png" };

/** Through pacman there is no folder to choose, so the Location step isn't one of the steps. */
const steps = () => (S.info?.aur ? STEPS.filter((s) => s.id !== "location") : STEPS);
const stepIndex = () => steps().findIndex((s) => s.id === S.step);
const available = () => (S.plan?.components ?? []).filter((c) => !c.unavailable);
const chosenBytes = () => (S.plan?.components ?? []).filter((c) => S.selected.has(c.id)).reduce((n, c) => n + c.size, 0);
const working = () => S.inst.phase === "working";

function go(step: Step): void {
  S.step = step;
  render();
}

/* ---- Chrome ---------------------------------------------------------------------------------------------------- */

function renderChrome(): void {
  $("steps").innerHTML = steps().map((s, i) => `<span class="step ${i < stepIndex() ? "done" : i === stepIndex() ? "current" : ""}"><span class="dot"></span>${i === stepIndex() ? esc(s.label) : ""}</span>`).join("");
}

function renderControls(): void {
  if (S.info?.platform === "darwin") return;
  $("controls").innerHTML = `
    <button type="button" id="min" aria-label="Minimise"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg></button>
    <button type="button" id="x" class="close" aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></button>`;
  $("min").onclick = () => void api.minimize();
  $("x").onclick = () => void api.quit();
}

/* ---- Pages ----------------------------------------------------------------------------------------------------- */

function renderWelcome(): string {
  const i = S.info;
  const ready = !!S.plan && !S.plan.unsupported && available().length > 0;
  const status = S.loading
    ? `<span class="status"><span class="spin"></span>Checking for the latest version…</span>`
    : S.planError
      ? `<span class="status err">${esc(S.planError)}</span><button class="btn outline" id="retry" type="button">Try again</button>`
      : S.plan?.unsupported
        ? `<span class="status err">${esc(S.plan.unsupported)}</span>`
        : `<span class="chip">${esc(i?.channelLabel ?? "")}${S.plan ? ` · v${esc(S.plan.version)}` : ""}</span>`;
  return `<section class="page welcome">
    <h1><span>Chat,</span><span>Play,</span><span class="grad">Create.</span></h1>
    <p>Choose what you'd like on this computer. We'll fetch the latest version and set it up.</p>
    <div class="row">
      <button class="btn primary lg" id="next" type="button" ${ready ? "" : "disabled"}>Get started</button>
      ${status}
    </div>
  </section>`;
}

function renderComponents(): string {
  const rows = (S.plan?.components ?? [])
    .map((c) => {
      const on = S.selected.has(c.id);
      const off = !!c.unavailable;
      return `<label class="option ${on && !off ? "on" : ""} ${off ? "off" : ""}">
        <img src="${ICON[c.id]}" alt="" draggable="false" />
        <div><h3>${esc(c.title)}${S.info?.installed[c.id] ? '<span class="tag">Installed · will update</span>' : c.id === "crystal" ? '<span class="tag">Recommended</span>' : ""}</h3><p>${esc(off ? (c.unavailable ?? "") : c.blurb)}</p></div>
        <div class="meta"><span class="box">${TICK.replace("#04130c", "#04130c")}</span><span>${off ? "" : esc(formatBytes(c.size))}</span></div>
        <input type="checkbox" data-id="${c.id}" ${on && !off ? "checked" : ""} ${off ? "disabled" : ""} />
      </label>`;
    })
    .join("");
  const shortcut =
    S.info && S.info.platform !== "darwin" && !S.info.aur
      ? `<label class="check ${S.shortcut ? "on" : ""}"><span class="box">${TICK}</span><input type="checkbox" id="shortcut" ${S.shortcut ? "checked" : ""} /><span>Add a shortcut to the desktop</span></label>`
      : "";
  const n = S.selected.size;
  return `<section class="page wizard"><div class="card">
    <header><h2>What would you like to install?</h2><p>You can add the other later by running Setup again.</p></header>
    <div class="body">${rows}${shortcut}</div>
    <footer>
      <span class="note">${n ? `<b>${n}</b> selected · ${esc(formatBytes(chosenBytes()))} to download` : "Choose at least one."}</span>
      <button class="btn ghost" id="back" type="button">Back</button>
      <button class="btn primary" id="next" type="button" ${n ? "" : "disabled"}>Next</button>
    </footer></div></section>`;
}

function pathLines(): string {
  return [...S.selected]
    .map((id) => {
      const c = S.plan?.components.find((x) => x.id === id);
      return `<div class="line"><img src="${ICON[id]}" alt="" /><span>${esc(c?.title ?? id)}</span><span class="path" title="${esc(S.targets[id] ?? "")}"><bdi>${esc(S.targets[id] ?? "")}</bdi></span></div>`;
    })
    .join("");
}

function renderLocation(): string {
  const mac = S.info?.platform === "darwin";
  return `<section class="page wizard"><div class="card">
    <header><h2>Where should it go?</h2><p>${mac ? "The apps are placed straight into this folder." : "Each app gets a folder of its own inside this one."}</p></header>
    <div class="body">
      <div class="field"><input class="input ${S.folderError ? "bad" : ""}" id="folder" spellcheck="false" value="${esc(S.base)}" aria-label="Install folder" /><button class="btn outline" id="browse" type="button">Browse…</button></div>
      <p class="hint ${S.folderError ? "err" : ""}" id="folder-hint">${esc(S.folderError ?? (mac ? "/Applications is where Mac apps usually live." : S.info?.aurMissing.length ? `This looks like Arch Linux, but installing from the AUR needs ${S.info.aurMissing.join(", ")}, so the apps are placed in this folder instead.` : "The default is private to your account, so no administrator password is needed."))}</p>
      <div class="summary" id="paths">${pathLines()}</div>
    </div>
    <footer>
      <button class="btn ghost" id="back" type="button">Back</button>
      <button class="btn primary" id="next" type="button" style="margin-left:auto">Next</button>
    </footer></div></section>`;
}

function itemRow(i: InstallState["items"][number]): string {
  const pct = i.size > 0 ? Math.min(100, Math.round((i.received / i.size) * 100)) : 0;
  const bar =
    i.status === "downloading"
      ? `<div class="progress"><i style="width:${pct}%"></i></div>`
      : i.status === "verifying" || i.status === "installing"
        ? `<div class="progress indet"><i></i></div>`
        : "";
  const sub = i.status === "downloading" ? `Downloading · ${esc(formatBytes(i.received))} of ${esc(formatBytes(i.size))}` : i.status === "failed" ? "Couldn't be installed" : esc(i.note);
  const state =
    i.status === "done" ? `<span class="tick">${TICK}</span>` : i.status === "failed" ? `<span class="cross">!</span>` : i.status === "waiting" ? `<span class="dotwait"></span>` : `<span class="spin"></span>`;
  return `<div class="item ${i.status}" data-item="${i.id}"><img src="${ICON[i.id]}" alt="" /><div><h3>${esc(i.title)}</h3><div class="sub">${sub}</div>${bar}</div><span class="state">${state}</span></div>`;
}

function renderInstall(): string {
  const p = S.inst;
  if (p.phase === "idle") {
    const names = [...S.selected].map((id) => S.plan?.components.find((c) => c.id === id)?.title ?? id).join(" and ");
    return `<section class="page wizard"><div class="card">
      <header><h2>Ready to install</h2><p>${esc(names)} — ${esc(formatBytes(chosenBytes()))} to download.</p></header>
      <div class="body"><div class="summary">${pathLines()}</div>
      <p class="hint">${S.info?.aur ? "Each app is built from its package in the Arch User Repository and installed with pacman, so pacman keeps it up to date. You'll be asked for your administrator password once." : S.info?.platform === "win32" ? "Setup runs in the background for each app, then adds it to your Start menu." : S.info?.platform === "darwin" ? "Each download is checked before it is placed in the folder." : "Each download is checked before it is placed, and added to your applications menu."}</p></div>
      <footer><button class="btn ghost" id="back" type="button">Back</button><button class="btn primary" id="install" type="button" style="margin-left:auto">Install</button></footer>
    </div></section>`;
  }
  const failed = p.phase === "failed";
  const cancelled = p.phase === "cancelled";
  const title = failed ? "Something went wrong" : cancelled ? "Installation cancelled" : "Installing…";
  const pct = Math.round(p.progress * 100);
  return `<section class="page wizard"><div class="card">
    <header><h2>${title}</h2><p>${failed || cancelled ? (p.items.some((i) => i.status === "done") ? "What finished is installed. The rest isn't." : "Nothing was installed.") : "This takes a minute or two. You can leave this window open and carry on."}</p></header>
    <div class="body">
      ${failed || cancelled ? "" : `<div class="big"><b id="pct">${pct}%</b><span>${esc(formatBytes(chosenBytes()))}</span></div><div class="progress" id="overall"><i style="width:${pct}%"></i></div>`}
      ${p.items.map(itemRow).join("")}
      ${failed && p.error ? `<div class="banner" role="alert">${esc(p.error)}</div>` : ""}
    </div>
    <footer>
      ${failed ? `<button class="btn ghost" id="releases" type="button">Open the releases page</button>` : ""}
      ${working() ? `<button class="btn outline" id="cancel" type="button" style="margin-left:auto">Cancel</button>` : `<button class="btn ghost" id="back" type="button" style="margin-left:auto">Back</button><button class="btn primary" id="install" type="button">${failed ? "Try again" : "Install"}</button>`}
    </footer></div></section>`;
}

function renderFinish(): string {
  const done = S.inst.items.filter((i) => i.status === "done");
  const checks = done
    .map((i) => `<label class="check ${S.launch.has(i.id) ? "on" : ""}"><span class="box">${TICK}</span><input type="checkbox" data-launch="${i.id}" ${S.launch.has(i.id) ? "checked" : ""} /><img src="${ICON[i.id]}" alt="" width="22" height="22" style="border-radius:6px" /><span>Open ${esc(i.title)}</span></label>`)
    .join("");
  return `<section class="page wizard finish"><div class="card">
    <header><div class="badge"><svg viewBox="0 0 16 16" fill="none" stroke="#04130c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8.6l3 3 6.6-7"/></svg></div><h2>You're all set</h2><p>${done.length === 1 ? `${esc(done[0].title)} is installed.` : "Everything you chose is installed."}</p></header>
    <div class="body" style="align-items:center">${checks}</div>
    <footer><button class="btn primary lg" id="finish" type="button">Finish</button></footer>
  </div></section>`;
}

/* ---- Wiring ---------------------------------------------------------------------------------------------------- */

let shownStep: Step | null = null;

function render(): void {
  renderChrome();
  const page = $("page");
  page.innerHTML = { welcome: renderWelcome, components: renderComponents, location: renderLocation, install: renderInstall, finish: renderFinish }[S.step]();
  // The entrance animation is for arriving at a step. A redraw of the same step (a checkbox, a status change) must not
  // replay it, or the card flickers.
  if (shownStep === S.step) page.firstElementChild?.classList.add("still");
  shownStep = S.step;
  const on = (id: string, fn: () => void) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  on("retry", () => void loadPlan());
  on("back", () => go(({ components: "welcome", location: "components", install: S.info?.aur ? "components" : "location" } as Record<string, Step>)[S.step] ?? "welcome"));
  on("releases", () => void api.openReleases());
  on("cancel", () => void api.cancel());
  on("install", () => void startInstall());
  on("finish", () => {
    if (S.launch.size) void api.launch([...S.launch], S.base);
    setTimeout(() => void api.quit(), 350);
  });
  on("next", () => {
    if (S.step === "welcome") go("components");
    else if (S.step === "components") go(S.info?.aur ? "install" : "location");
    else if (S.step === "location") void leaveLocation();
  });

  page.querySelectorAll<HTMLInputElement>("input[data-id]").forEach((el) =>
    el.addEventListener("change", () => {
      const id = el.dataset.id as Id;
      if (el.checked) S.selected.add(id);
      else S.selected.delete(id);
      render();
      document.querySelector<HTMLInputElement>(`input[data-id="${id}"]`)?.focus();
    }),
  );
  document.getElementById("shortcut")?.addEventListener("change", (e) => {
    S.shortcut = (e.target as HTMLInputElement).checked;
    render();
    document.getElementById("shortcut")?.focus();
  });
  page.querySelectorAll<HTMLInputElement>("input[data-launch]").forEach((el) =>
    el.addEventListener("change", () => {
      const id = el.dataset.launch as Id;
      if (el.checked) S.launch.add(id);
      else S.launch.delete(id);
      render();
      document.querySelector<HTMLInputElement>(`input[data-launch="${id}"]`)?.focus();
    }),
  );

  const folder = document.getElementById("folder") as HTMLInputElement | null;
  if (folder) {
    folder.addEventListener("input", () => {
      S.base = folder.value;
      S.folderError = null;
      folder.classList.remove("bad");
      const hint = $("folder-hint");
      hint.classList.remove("err");
      void refreshTargets();
    });
    on("browse", async () => {
      const picked = await api.chooseFolder(S.base);
      if (picked) {
        S.base = picked;
        S.folderError = null;
        await refreshTargets();
        render();
      }
    });
  }
}

/** Whether two states would draw the same page, apart from the numbers in it. */
function sameShape(a: InstallState, b: InstallState): boolean {
  return a.phase === b.phase && a.error === b.error && a.items.length === b.items.length && a.items.every((x, i) => x.id === b.items[i].id && x.status === b.items[i].status && x.note === b.items[i].note);
}

/** Updates the install page's percentages, byte counts and bar widths without touching anything else. */
function patchInstall(): void {
  const pct = Math.round(S.inst.progress * 100);
  const total = document.getElementById("pct");
  if (total) total.textContent = `${pct}%`;
  const bar = document.querySelector<HTMLElement>("#overall > i");
  if (bar) bar.style.width = `${pct}%`;
  for (const i of S.inst.items) {
    const row = document.querySelector(`[data-item="${i.id}"]`);
    if (!row || i.status !== "downloading") continue;
    const sub = row.querySelector(".sub");
    if (sub) sub.textContent = `Downloading · ${formatBytes(i.received)} of ${formatBytes(i.size)}`;
    const fill = row.querySelector<HTMLElement>(".progress > i");
    if (fill) fill.style.width = `${i.size > 0 ? Math.min(100, Math.round((i.received / i.size) * 100)) : 0}%`;
  }
}

async function refreshTargets(): Promise<void> {
  if (!S.base.trim()) return;
  S.targets = await api.targets(S.base);
  const el = document.getElementById("paths");
  if (el) el.innerHTML = pathLines();
}

async function leaveLocation(): Promise<void> {
  const r = await api.checkFolder(S.base);
  if (!r.ok) {
    S.folderError = r.reason;
    render();
    return;
  }
  S.folderError = null;
  await refreshTargets();
  go("install");
}

async function startInstall(): Promise<void> {
  S.launch = new Set(S.selected);
  // The state events drive the page from here; this resolves when the whole run has finished.
  void api
    .start({ components: [...S.selected], base: S.base, desktopShortcut: S.shortcut })
    .catch((e: unknown) => {
      S.inst = { ...S.inst, phase: "failed", error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e) };
      render();
    });
}

async function loadPlan(): Promise<void> {
  S.loading = true;
  S.planError = null;
  render();
  try {
    S.plan = await api.plan();
    S.selected = new Set(available().map((c) => c.id));
  } catch (e) {
    S.plan = null;
    S.planError = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e);
  }
  S.loading = false;
  if (S.step === "welcome") render();
}

async function main(): Promise<void> {
  S.info = await api.info();
  document.documentElement.dataset.platform = S.info.platform;
  $("title").textContent = S.info.channel === "stable" ? "Crystal Setup" : `Crystal ${S.info.channelLabel} Setup`;
  document.title = $("title").textContent!;
  S.base = S.info.defaultBase;
  S.targets = await api.targets(S.base);
  renderControls();
  api.onState((s) => {
    const before = S.inst;
    S.inst = s;
    if (s.phase === "done") S.step = "finish";
    if (S.step !== "install" && S.step !== "finish") return;
    // Progress arrives many times a second. When only the numbers moved, change the numbers in place: rebuilding the page
    // for each one restarted the bar from zero and made the card flicker. Anything that changes what is on the page — a
    // row finishing, an error — is a redraw.
    if (S.step === "install" && sameShape(before, s)) patchInstall();
    else render();
  });
  await loadPlan();
}

void main();
