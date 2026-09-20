# Spotter v0 local server. Run:  .\start.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$port = 8765
Write-Host "Spotter v0.6  http://localhost:$port"
Write-Host "LAN: http://<this-PC-IPv4>:$port  (server binds 0.0.0.0)"
Write-Host ""

function Have($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (Have "node") {
  npx --yes serve -l $port .
  exit $LASTEXITCODE
}

foreach ($py in @("python", "py", "python3")) {
  if (Have $py) {
    & $py -m http.server $port --bind 0.0.0.0
    exit $LASTEXITCODE
  }
}

Write-Host "Node and Python were not found. Starting a built-in PowerShell server."
Write-Host "Install Node LTS later:  winget install OpenJS.NodeJS.LTS"
Write-Host ""

$root = (Get-Location).Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://+:$port/")
try {
  $listener.Start()
} catch {
  Write-Host "Could not bind port $port. Is another server already running?"
  throw
}

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
}

Write-Host "Serving $root"
Write-Host "Open http://localhost:$port"
Write-Host "Ctrl+C to stop"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $ctx.Response.Close()
      continue
    }
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" })
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
}
