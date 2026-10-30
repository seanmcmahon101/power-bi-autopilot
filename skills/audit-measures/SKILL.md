---
name: audit-measures
description: Complete review of every DAX measure in a Power BI model - broken references, unused and duplicate measures, risky patterns, formats, descriptions, and a read of each measure's logic against its name - reported in plain English with severity, then offers to fix them. Use for /audit-measures, "check my measures", "review the DAX", "clean up the model", "what measures can I delete".
---

# /audit-measures: review every measure, then offer to fix

Load `pbi-core` first; `<core>` below means its folder, `../pbi-core` next to this skill. Read only until the user picks fixes in step 5.

## 1. Find the model

- Argument given: use it. Otherwise `node <core>/scripts/scan.js .` and pick the only model; ask if there are several.
- `.pbix`: the model is binary. With the powerbi-modeling MCP, open it in Desktop (`desktop.ps1 open`), connect to it by file name, and pull every measure with its expression, format string, display folder, description and table. Without the MCP, offer to convert it to `.pbip` first (`/viz-it` step 1 does that) or install the MCP (`/mcp-it`).
- Note which reports were scanned for usage (the lint prints them). Other reports may use this model too, especially a published one: "unused" only means unused in the reports found here.

## 2. Run the rule checks

```
node <this skill>/scripts/lint.js <target> --json <scratch>/measure-findings.json
```

It flags: broken references, empty measures, unbalanced brackets, unused, duplicates (same DAX), duplicate names, `/` instead of DIVIDE, IFERROR, CALCULATE + FILTER over a whole table, SUMX(FILTER), TODAY() (UTC in the service), hard-coded dates, time intelligence without a marked date table, missing or wrong format strings, missing descriptions, unqualified columns / qualified measures, very long measures, implicit measures in visuals, auto date/time.

For a `.pbix` read through the MCP, apply the same rules yourself to the measures you pulled.

## 3. Read every measure yourself

The rules catch patterns. Only reading catches a measure that gives the wrong answer. Go through every measure with `references/review-checklist.md` and note what the rules missed. Do not skip measures because the lint passed them.

## 4. Report

Write it for someone who doesn't read DAX:

1. **Verdict** in 2-3 sentences: how healthy the model is and the one thing to fix first.
2. **Scorecard:** measures reviewed, errors, warnings, notes; how many unused; how many have no description.
3. **Must fix (errors):** each with the measure name, what goes wrong for the reader in plain words ("this card shows blank because the table it reads was renamed"), and the proposed fix as the new DAX.
4. **Should fix (warnings)**, grouped by rule, the same way.
5. **Tidy-ups (notes)**, as one compact table.
6. **Unused measures:** a list, with the caveat about other reports.

Save it as `<Model name> - measure audit.md` next to the project, and show sections 1-3 in chat with the file path.

## 5. Ask, then fix

Ask with one question (AskUserQuestion) after the report:

- **Fix the errors and warnings** (recommended): every proposed change in sections 3-4
- **Let me pick**: then list fixes with numbers, the user answers with numbers
- **Just errors**
- **No changes**

Deleting unused measures is separate: ask about it on its own, listing the names. Never delete without that yes.

How to apply, by situation:

| Situation | How |
|---|---|
| `.pbip`, Desktop closed | Back up (`.pbi-backups/<timestamp>/`), edit the TMDL files. Keep tabs for indentation; multi-line DAX goes on the lines after `measure 'Name' =`, indented one tab deeper than the measure's properties. New measures need a `lineageTag: <new GUID>`. |
| `.pbip` or `.pbix` open in Desktop, MCP available | Back up, change measures through the MCP (`measure_operations`), then focus Desktop and press Ctrl+S so the files on disk match. |
| Model published in the service | Stop and warn (pbi-core, XMLA). Recommend fixing in the source .pbip/.pbix and republishing instead. |

## 6. Verify

- Re-run `lint.js`: every fixed finding should be gone and nothing new added.
- Re-run `node <core>/scripts/check.js <project>`: no visual may point at a renamed or deleted measure.
- If Desktop is available, open the file and screenshot the pages that use changed measures: no blank or error visuals. With the MCP, you can also run a DAX query (`EVALUATE ROW("x", [Measure])`) per changed measure to prove it returns a value.
- Report what changed (old DAX -> new DAX per measure), where the backup is, and anything you could not verify.
