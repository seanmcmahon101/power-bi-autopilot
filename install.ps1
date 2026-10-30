# Installs the skills as personal Claude Code skills, so they run as /init-pbi, /viz-it, /data-who, /audit-measures, /mcp-it.
#   powershell -ExecutionPolicy Bypass -File install.ps1          copy the skills (run again to update)
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Link    link instead of copy, for editing the skills in this repo
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Remove  remove them
param([switch]$Link, [switch]$Remove)
$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'skills'
$target = Join-Path $env:USERPROFILE '.claude\skills'
New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($skill in Get-ChildItem $source -Directory) {
    $dest = Join-Path $target $skill.Name
    if (Test-Path $dest) {
        $item = Get-Item $dest -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $item.Delete() }   # remove the link, not the files it points to
        else { Remove-Item $dest -Recurse -Force }
    }
    if ($Remove) { Write-Host "removed  $($skill.Name)"; continue }
    if ($Link) { New-Item -ItemType Junction -Path $dest -Target $skill.FullName | Out-Null; Write-Host "linked   $($skill.Name)" }
    else { Copy-Item $skill.FullName $dest -Recurse; Write-Host "copied   $($skill.Name)" }
}
if (-not $Remove) { Write-Host "`nDone. Start a new Claude Code session, open the folder with your Power BI files, and run /init-pbi." }
