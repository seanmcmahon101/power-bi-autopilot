# Power BI Desktop window control for Claude: find the install, open a file, bring it to the front, close it.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File desktop.ps1 find
#   ... desktop.ps1 status
#   ... desktop.ps1 open  -Path "C:\work\Sales.pbix"      (waits until the window is up, prints its pid)
#   ... desktop.ps1 focus -Match "Sales"                   (restore + maximise + foreground)
#   ... desktop.ps1 close -Match "Sales"                   (asks the window to close; Desktop may show a save prompt)
param(
    [Parameter(Position = 0, Mandatory)][ValidateSet('find', 'status', 'open', 'focus', 'close')][string]$Action,
    [string]$Path,
    [string]$Match,
    [int]$TimeoutSec = 180
)
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PbiWin {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@

function Get-PbiWindows {
    @(Get-Process PBIDesktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } |
        ForEach-Object { [pscustomobject]@{ pid = $_.Id; title = $_.MainWindowTitle; handle = $_.MainWindowHandle } })
}
function Find-Window([string]$m) {
    $w = Get-PbiWindows | Where-Object { $_.title -like "*$m*" } | Select-Object -First 1
    if (-not $w) { throw "No Power BI Desktop window title contains '$m'. Open windows: $((Get-PbiWindows).title -join ' | ')" }
    $w
}

switch ($Action) {
    'find' {
        $store = Get-AppxPackage -Name Microsoft.MicrosoftPowerBIDesktop -ErrorAction SilentlyContinue
        $msi = @("$env:ProgramFiles\Microsoft Power BI Desktop\bin\PBIDesktop.exe", "${env:ProgramFiles(x86)}\Microsoft Power BI Desktop\bin\PBIDesktop.exe") |
            Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($store) { [pscustomobject]@{ installed = $true; kind = 'Microsoft Store'; version = $store.Version } | ConvertTo-Json }
        elseif ($msi) { [pscustomobject]@{ installed = $true; kind = 'Installer (MSI)'; version = (Get-Item $msi).VersionInfo.ProductVersion; exe = $msi } | ConvertTo-Json }
        else { [pscustomobject]@{ installed = $false; get = 'https://aka.ms/pbidesktopstore' } | ConvertTo-Json }
    }
    'status' { ConvertTo-Json -InputObject @(Get-PbiWindows | Select-Object pid, title) }
    'open' {
        if (-not (Test-Path $Path)) { throw "File not found: $Path" }
        $name = [IO.Path]::GetFileNameWithoutExtension($Path)
        $already = Get-PbiWindows | Where-Object { $_.title -like "$name*" }
        if ($already) { "already open: pid $($already[0].pid)"; break }
        Start-Process -FilePath $Path
        $deadline = (Get-Date).AddSeconds($TimeoutSec)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 3
            $w = Get-PbiWindows | Where-Object { $_.title -like "$name*" }
            if ($w) { "opened: pid $($w[0].pid), title '$($w[0].title)'"; break }
        }
        if (-not $w) { throw "Desktop did not show a window for '$name' within $TimeoutSec s (it may still be loading, or a sign-in / upgrade dialog is waiting)" }
    }
    'focus' {
        $w = Find-Window $Match
        [PbiWin]::ShowWindow($w.handle, 9) | Out-Null   # restore
        [PbiWin]::ShowWindow($w.handle, 3) | Out-Null   # maximise, so screenshots are the same size every time
        [PbiWin]::BringWindowToTop($w.handle) | Out-Null
        [PbiWin]::SetForegroundWindow($w.handle) | Out-Null
        "focused: pid $($w.pid), title '$($w.title)'"
    }
    'close' {
        $w = Find-Window $Match
        (Get-Process -Id $w.pid).CloseMainWindow() | Out-Null
        "close requested: pid $($w.pid). If Desktop asks to save, answer it in the window."
    }
}
