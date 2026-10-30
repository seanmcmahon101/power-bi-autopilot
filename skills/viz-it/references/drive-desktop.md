# Driving Power BI Desktop

`<core>` = the pbi-core skill folder. `desktop.ps1` = `powershell -NoProfile -ExecutionPolicy Bypass -File <core>/scripts/desktop.ps1`.

Use the computer-use tools for clicks and screenshots (request access to "Power BI Desktop"; add "File Explorer" only if a Windows file dialog needs it). Take a screenshot after every click that changes the screen. Menus and dialogs move between Desktop releases: look, then click; never click from memory.

## Open, focus, close

- Open: `desktop.ps1 open -Path "<file>"`. It waits for the window (large models can take minutes).
- Bring to front, maximised: `desktop.ps1 focus -Match "<file name>"`. Do this before every screenshot session; Desktop windows hide behind others.
- Close: `desktop.ps1 close -Match "<file name>"`. If Desktop asks to save: **Save** if the user or you made changes in Desktop that are not on disk yet; **Don't save** if you just wrote files from outside (saving would overwrite them).
- Never start Desktop from the Start menu or by app name for a specific file: that opens an empty window.

Dialogs at start-up: a sign-in prompt is the user's account, so ask them to sign in or cancel it themselves. "What's new" splash screens and tips: close them.

## Save as .pbip (convert a .pbix)

1. **Check the folder depth first.** A project nests files ~87 characters below `<folder>\<name>`, and Windows stops at 260 unless long paths are enabled. `scan.js` prints a WARNING on the .pbix when the folder is too deep (common under OneDrive and Temp). Then pick a short folder (e.g. `C:\Users\<you>\pbi\<name>`), create it, and tell the user the project lives there. Saving too deep fails silently: Desktop writes empty folders and the title bar turns to "Untitled".
2. Back up the .pbix to `.pbi-backups/<timestamp>/`.
3. `desktop.ps1 open -Path "<file>.pbix"`, then focus.
4. File > **Save as**. Desktop shows a "Save a copy" page with a Recent list of folders (the file's own folder is usually first) and **Browse this device**. Click the target folder in Recent if it's there, else Browse this device.
5. In the Windows save dialog: open **Save as type**, pick *Power BI project files (\*.pbip)*, check the folder in the address bar and the file name, then **Save**. To change folder, click the address bar and type the folder path; don't type a full path into File name (autocomplete can swallow it). Never press Escape in this dialog: it closes it.
6. Wait ~8 seconds. Success = the title bar reads `<name> · Last saved: Today at <time> (Power BI Project)`. If Desktop offers to upgrade the report format, accept.
7. Verify: `node <core>/scripts/scan.js "<folder>"` must show a project with `report PBIR` and a `TMDL` model (Desktop 2.15x does both by default). If the report is `PBIR-Legacy` or the model is `model.bim`, do "Turn on PBIR" below.
8. Tell the user: "Your report is now a Power BI project (`<name>.pbip` plus two folders) in `<folder>`. Open the .pbip from now on; the .pbix is your untouched old copy."

## Turn on PBIR (and TMDL)

1. File > Options and settings > Options > Preview features.
2. Tick "Store reports using enhanced metadata format (PBIR)". If listed, also tick "Store semantic model using TMDL format". OK.
3. Desktop may ask to restart: do it, reopen the .pbip.
4. Make any small change Desktop can save (or File > Save), accept the upgrade prompt, save. Re-scan to confirm.

These are Desktop preferences for this user, not file changes; mention to the user that you turned them on.

## Reload after writing files

- Desktop has the project open: after the build, wait ~5 seconds and screenshot. A red bar appears under the ribbon: "This project's files were changed externally" with an **Apply external changes** button. Click it. If Desktop holds unsaved edits it first asks "Overwrite your unsaved edits": confirm with **Apply external changes** (safe because you saved in Desktop before building). The canvas goes black for a few seconds, then reloads on the same page.
- No prompt within ~10 seconds, or the model (TMDL) changed: close Desktop (Don't save) and `desktop.ps1 open` the .pbip again.
- Pages generated with new names break the in-place reload ("ActivePageName not found"); the library keeps names stable, so this only happens with hand-written pages.

## When Desktop reports problems

On open, Desktop lists every invalid file in one dialog. Click **Copy details**, read the clipboard (computer-use clipboard read, or `powershell -Command Get-Clipboard`), and fix each file named. Typical causes: a field name that is not in the model (check.js catches these), a property not allowed by the visual's schema, a page or visual name that doesn't match its folder.

A visual with a grey X or "Can't display this visual": click it and hover the warning icon (or the "See details" link) to read the reason.

## Moving between pages

Generated pages have tabs at the top right (page navigator); Desktop also shows page tabs along the bottom. Click the tab, wait for visuals to finish loading (spinners gone), then screenshot.
