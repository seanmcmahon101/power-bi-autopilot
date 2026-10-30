---
name: mcp-it
description: Install Microsoft's Power BI Modeling MCP server for Claude Code, available in every project, so Claude can read and edit semantic models live in Power BI Desktop or the Power BI service. Use when the user runs /mcp-it, asks to install or fix the Power BI MCP, or when /init-pbi finds it missing.
---

# /mcp-it: install the Power BI Modeling MCP

The [Power BI Modeling MCP](https://github.com/microsoft/powerbi-modeling-mcp) lets Claude connect to a model open in Power BI Desktop (or published in the service) and list, create and change tables, measures, relationships and partitions, and run DAX queries. This skill installs it once for the user, for all projects (user scope).

Load `pbi-core` first; `<pbi-core>` below means its folder, `../pbi-core` next to this skill. Work through the steps; show the user one short line per step.

## 1. Already there?

Run `claude mcp list` (the `claude` CLI; on Windows it is usually `%USERPROFILE%\.local\bin\claude.exe`). Look for a server whose command mentions `powerbi-modeling-mcp`.

- Listed and `✔ Connected`: say so and stop. Optional check: with a file open in Desktop, call its `connection_operations` tool to list local instances.
- Listed but failing: show the error line, remove it with `claude mcp remove <name> --scope <its scope>`, and carry on to step 2.
- Not listed: step 2.

Also check whether this session already has `mcp__powerbi-modeling__*` tools (search the deferred tools for "powerbi-modeling"). If it does, the server works: stop.

## 2. Prerequisites

| Check | Command | If missing |
|---|---|---|
| Windows | (Power BI Desktop is Windows-only, and the server is built for it) | Say so and stop. |
| Node.js 18+ (gives `npx`) | `node --version` | Ask the user before installing anything: "Node.js is needed to run the MCP. Install it with `winget install OpenJS.NodeJS.LTS`?" On yes, run it, then open a new shell so `npx` is on PATH. |
| Power BI Desktop | `powershell -NoProfile -ExecutionPolicy Bypass -File <pbi-core>/scripts/desktop.ps1 find` | Not needed for the install itself. Tell the user where to get it (Microsoft Store, https://aka.ms/pbidesktopstore) if they want to work on local files. |

## 3. The licence (the user's decision)

The server refuses every call until its EULA is accepted. Accepting a licence is the user's call, not yours. Show the link and ask:

> The Power BI Modeling MCP is Microsoft software with its own licence: https://github.com/microsoft/powerbi-modeling-mcp/blob/main/EULA.txt. Do you accept it? If yes I'll set it up to start without asking each time.

- **Yes:** install with `--accepteula` (step 4).
- **No or not sure:** install without it. The first time the server is used, it asks; nothing works until the user accepts.

## 4. Install (user scope = every project)

Native Windows needs the `cmd /c` wrapper around `npx`:

```
claude mcp add powerbi-modeling --scope user -- cmd /c npx -y @microsoft/powerbi-modeling-mcp@latest --start --accepteula
```

Leave out `--accepteula` if the user did not accept in step 3. On macOS/Linux/WSL drop `cmd /c`; note that Desktop itself only runs on Windows.

Flags worth knowing (add after `--start` only if the user asks):

- `--readonly`: no writes at all. Good for someone who only wants `/data-who` and `/audit-measures` to read.
- default (read-write): the server asks for confirmation once per model before its first edit.
- `--authmode serviceprincipal`: for automation accounts instead of the user's own sign-in to the service.

## 5. Verify

1. `claude mcp list` should show `powerbi-modeling ... ✔ Connected`. The first start downloads the package and can take a minute; run it again if it says connecting.
2. MCP servers load when a session starts, so the tools appear in **new** sessions, not this one. Tell the user: "Installed. Start a new Claude session (or run /mcp and reconnect) to use it."
3. If the user has a file open in Desktop now, offer to test it in the next session: "Connect to '<file name>' in Power BI Desktop" should return the model's tables.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npx` not found | Node.js missing or the shell predates the install: open a new terminal, or install Node (step 2). |
| `✘ Failed to connect` right after adding | First run still downloading: wait, check again. Otherwise run the same `npx` command by hand to see its error. |
| Tools present but every call fails with a EULA message | Not accepted. Ask the user (step 3); on yes call the server's `accept_eula` tool once. |
| Connects to Desktop but finds no model | The file must be open in Desktop and fully loaded. The server looks for the Desktop instance by file name. |
| `session ID cannot be found` against the service | Disconnect, then connect again (reconnecting without disconnecting reuses the stale session). |
| Corporate machine blocks `npx` downloads | Alternative: the VS Code extension "Power BI Authoring MCP" ships the same server as `extension\server\powerbi-modeling-mcp.exe`; register that exe instead: `claude mcp add powerbi-modeling --scope user -- "<path>\powerbi-modeling-mcp.exe" --start`. |
