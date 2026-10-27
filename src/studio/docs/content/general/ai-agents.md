---
title: Working with AI agents
topic: general
kind: guide
section: Shipping
order: 40
summary: Every Studio project folder comes ready for AI coding agents: skills, instructions and an MCP server that knows Crystal's formats and SDKs.
---

Every project folder Studio makes, whatever kind it is, can be opened by an AI coding agent (Claude Code, Cursor, OpenCode, Codex, Gemini CLI, GitHub Copilot, or anything else that reads `AGENTS.md`) and it will know what it is looking at.

## What Studio adds

| File | Read by |
| --- | --- |
| `AGENTS.md` | Most agents: Codex, OpenCode, Cursor, Copilot, and others |
| `CLAUDE.md`, `GEMINI.md` | Claude Code and Gemini CLI (each just points at `AGENTS.md`) |
| `.claude/skills/` and `.agents/skills/` | Agent skills: one for working in a Studio project, one for what this project is made of |
| `.cursor/rules/`, `.github/copilot-instructions.md` | Cursor and GitHub Copilot |
| `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json`, `.gemini/settings.json` | Starts the MCP server in each tool |
| `.crystal/mcp/` | The MCP server itself, and the guides and file formats it reads. Studio's own: don't edit it |

The skills are written from the same limits the store enforces (how many layers, how long an animation can run, which colour tokens a theme can set), so an agent is told what the server will actually accept.

## The MCP server

It needs only Node 18, runs on your computer and makes no network requests. For most projects it **only reads**; the design tools below are the one exception. An agent can:

- `project_info`: what this project is, and which skill and guides to read first.
- `list_docs`, `read_doc`, `search_docs`: Studio's written guides.
- `sdk_reference`: the bot and extension SDKs, class by class.
- `format_source`: the source that defines the file formats and limits.
- `check_project`: look for unreadable files, a design that disagrees with its project file, and files a design uses that the project doesn't list.

## Letting an agent make things

Beyond reading, the server has tools that **change the design file**, only for the kinds they fit:

| Project | Tools |
| --- | --- |
| Avatar decoration, profile sticker | `add_node`, `set_node`, `remove_node`: shapes, stars, text, pictures, gradients |
| Nameplate, profile effect | the above, plus `add_effect` (sparkles, snow, embers, confetti, hearts…), `add_title`, `add_clip`, `animate`, `move_clip`, `add_clip_fx`, `set_transition`, `set_clip`, `set_timeline` (including an **intro**, `loopFrom`), `remove_clip`, `sample_design` |
| Lounge scene | `add_scene_object` (screen, seats, floor, props), `set_scene_dim`, `add_node`, `set_node` |
| Theme pack | `describe_theme`, `set_theme_colors` (including the second light/dark look), `remove_theme_variant` |

Every edit is run through the same rules the Marketplace uses, so an agent can't write something that would be refused. If a value was out of range it is changed to fit and the agent is told. `undo_last_change` puts the file back as it was (the last 20 changes are kept in `.crystal/mcp/backups`).

When the Studio window is next focused it picks the change up and reopens that project's editor. A project with **unsaved changes** in Studio is left exactly as it is, and your next save replaces the agent's change, so save or revert before asking an agent to edit a project that is open.

It does not run the store's own checks. Those run in the **Submit** panel, which is still how anything is sent for review.

## What an agent can't do

- It can't make pictures, fonts or sounds by writing text. Import them in Studio, then ask the agent to use them.
- It can't publish. Submitting is yours.
- Keep bot tokens and signing secrets in `.env`, never in a file an agent edits and you commit.

## Your files stay yours

Studio adds these files when a project is created, and to older projects the first time Studio sees them. It never changes one you wrote or edited: remove the first line of a file (the `crystal-studio:managed` marker) to take it over. A file you delete stays deleted. If you already have a `.mcp.json` (or another tool's config) Studio adds its server alongside yours and changes nothing else.

Commit them if you like: they help anyone who opens the project, and contain nothing private.
