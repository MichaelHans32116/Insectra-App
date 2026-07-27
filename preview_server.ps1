# ============================================================
#  InsecTra - Design Preview static server (zero install)
#  Serves the prebuilt ./dist folder using only built-in
#  Windows PowerShell. No Node.js, no npm, no downloads.
#  Launched by Start_Design_Preview.bat.
# ============================================================
$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot 'dist'
if (-not (Test-Path $root)) {
    Write-Host ""
    Write-Host "  Could not find the 'dist' folder next to this script." -ForegroundColor Red
    Write-Host "  Re-download the project ZIP from GitHub (it should include 'dist')." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

# Pick the first free port so a second run never collides.
$port = $null
foreach ($candidate in 8080..8090) {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$candidate/")
    try {
        $listener.Start()
        $port = $candidate
        break
    } catch {
        $listener = $null
    }
}

if (-not $port) {
    Write-Host "  Could not open a local port (8080-8090 all busy)." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$url = "http://localhost:$port/"

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   InsecTra design preview is running" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   Open in browser:  $url" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Tip: press F12 in the browser, then click the" -ForegroundColor DarkGray
Write-Host "        phone icon, to preview it at phone size." -ForegroundColor DarkGray
Write-Host ""
Write-Host "   Keep this black window OPEN while previewing." -ForegroundColor Yellow
Write-Host "   Close it (or press Ctrl+C) when you are done." -ForegroundColor Yellow
Write-Host ""

Start-Process $url | Out-Null

# Minimal content types - enough for an Expo web export.
$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.otf'  = 'font/otf'
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response

        try {
            # Strip query string, decode %20 etc, normalise slashes.
            $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
            $relative = $relative -replace '/', '\'

            $full = Join-Path $root $relative

            # Never serve outside dist/.
            $rootFull = (Resolve-Path $root).ProviderPath
            $candidate = $null
            if (Test-Path $full) {
                $resolved = (Resolve-Path $full).ProviderPath
                if ($resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
                    if (Test-Path $resolved -PathType Container) {
                        $indexed = Join-Path $resolved 'index.html'
                        if (Test-Path $indexed) { $candidate = $indexed }
                    } else {
                        $candidate = $resolved
                    }
                }
            }

            # Expo Router uses client-side routes - fall back to index.html
            # so deep links and refreshes still render the app.
            if (-not $candidate) {
                $candidate = Join-Path $rootFull 'index.html'
            }

            $bytes = [System.IO.File]::ReadAllBytes($candidate)
            $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()

            $response.StatusCode = 200
            if ($mime.ContainsKey($extension)) {
                $response.ContentType = $mime[$extension]
            } else {
                $response.ContentType = 'application/octet-stream'
            }
            $response.Headers.Add('Cache-Control', 'no-store')
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $response.StatusCode = 500
        } finally {
            $response.OutputStream.Close()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
