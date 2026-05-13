Set-Location $PSScriptRoot
Write-Host "Working in: $PSScriptRoot"

# Init repo if not already
if (-not (Test-Path ".git")) {
    git init
    Write-Host "Git initialized."
} else {
    Write-Host "Git already initialized."
}

# Add remote if not set
$remotes = & git remote
if ($remotes -notcontains "origin") {
    & git remote add origin https://github.com/oussanhh/igamane.git
    Write-Host "Remote added."
} else {
    Write-Host "Remote already set."
    & git remote -v
}

# Configure user if not set (required for commit)
$userName = & git config user.name
if (-not $userName) {
    & git config user.email "user@example.com"
    & git config user.name "oussanhh"
}

# Stage all files
& git add -A
Write-Host "Files staged:"
& git status --short

# Commit
$commitOut = & git commit -m "Initial commit" 2>&1
Write-Host "Commit: $commitOut"

# Push
& git branch -M main
$pushOut = & git push -u origin main 2>&1
Write-Host "Push result: $pushOut"

Write-Host "Done."
