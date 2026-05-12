$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Image = "kanban-pm"
$Container = "kanban-pm"

docker build -t $Image $Root
docker rm -f $Container 2>$null
docker run -d `
  --name $Container `
  -p 8000:8000 `
  -v "${Root}/data:/app/data" `
  --env-file "${Root}/.env" `
  $Image

Write-Host "Running at http://localhost:8000"
