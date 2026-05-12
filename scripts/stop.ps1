docker rm -f kanban-pm 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "Stopped." } else { Write-Host "Not running." }
