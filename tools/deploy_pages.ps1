# Publish dist\ to the gh-pages branch as a single orphan commit, so the
# generated fifty-odd MB of spell data never accumulates in the repo's history.
#
#   powershell -ExecutionPolicy Bypass -File tools\deploy_pages.ps1 [remote]
param([string]$Remote = "origin")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Refresh the item database first. A failure here is not fatal: the build falls
# back to whatever vendor\items.txt is already on disk, or to no item tags at all.
node tools\fetch_items.mjs
if ($LASTEXITCODE -ne 0) { Write-Warning "item fetch failed - building with the item data already on disk" }

# $ErrorActionPreference only governs cmdlets. A native exe that fails just sets
# $LASTEXITCODE and the script carries on, so without these checks a build that
# died halfway would publish whatever stale dist\ was left on disk.
node tools\build.mjs --out dist
if ($LASTEXITCODE -ne 0) { throw "build failed - not publishing" }
New-Item -ItemType File -Path dist\.nojekyll -Force | Out-Null   # Pages would otherwise skip data\

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("dis-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
try {
    Copy-Item dist $work -Recurse
    git -C $work init -q -b gh-pages
    git -C $work add -A
    git -C $work commit -qm "Build $(Get-Date -Format yyyy-MM-dd) from spells_us.txt"
    if ($LASTEXITCODE -ne 0) { throw "git commit failed - nothing to publish" }
    git -C $work push -qf (git remote get-url $Remote) gh-pages
    if ($LASTEXITCODE -ne 0) { throw "git push to $Remote gh-pages failed" }
    Write-Host "pushed dist\ to $Remote gh-pages"
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
