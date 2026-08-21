# Publish dist\ to the gh-pages branch as a single orphan commit, so the
# generated 30-odd MB of spell data never accumulates in the repo's history.
#
#   powershell -ExecutionPolicy Bypass -File tools\deploy_pages.ps1 [remote]
param([string]$Remote = "origin")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

node tools\build.mjs --out dist
New-Item -ItemType File -Path dist\.nojekyll -Force | Out-Null   # Pages would otherwise skip data\

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("dis-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
try {
    Copy-Item dist $work -Recurse
    git -C $work init -q -b gh-pages
    git -C $work add -A
    git -C $work commit -qm "Build $(Get-Date -Format yyyy-MM-dd) from spells_us.txt"
    git -C $work push -qf (git remote get-url $Remote) gh-pages
    Write-Host "pushed dist\ to $Remote gh-pages"
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
