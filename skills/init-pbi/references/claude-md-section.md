# Template: the `## Power BI` section of CLAUDE.md

Fill the angle brackets; delete lines that don't apply. Aim for 15-40 lines.

```markdown
## Power BI

<One sentence: what these reports are for and who reads them.>

| Project | What it is | Status |
|---|---|---|
| <Budget.pbip> | <monthly budget vs actual, finance team> | <published to workspace "Finance" / local only> |
| <Sales Dashboard.pbix> | <...> | <not yet converted to .pbip> |

- Data: <SQL Server sql01, database Finance; refreshed daily 06:00 in the service>
- Skills: `/data-who` explains a report, `/viz-it` builds pages, `/audit-measures` reviews the DAX. Run `node <pbi-core>/scripts/scan.js . --detail` for the current tables and measures.
- Edit model files with Desktop closed, or through the Power BI MCP with the file open, then Ctrl+S.

### Glossary
- <Sales>: <invoiced value in GBP, excluding intercompany>
- <Backlog>: <...>

### Never
- <Do not edit the published "Finance" model in the service: it is the master and is republished from Budget.pbip.>
- <Page "Board pack" belongs to the CFO's office: read only.>

### House style
- <Canvas 1920x1080, colours #1F3864 / #C00000, font Segoe UI> (or: neutral default from /viz-it)
```
