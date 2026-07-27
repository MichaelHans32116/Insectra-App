# ============================================================
#  InsecTra - Design Preview static server (zero install)
#  Serves BOTH design previews using only the PowerShell that
#  ships with Windows. No Node.js, no npm, no downloads.
#
#    /           menu page
#    /app        the mobile app UI  (from ./dist)
#    /website    the expert portal  (from ./expert-portal)
#
#  Launched by Start_Design_Preview.bat.
# ============================================================
$ErrorActionPreference = 'Stop'

$distRoot = Join-Path $PSScriptRoot 'dist'
$siteRoot = Join-Path $PSScriptRoot 'expert-portal'

if (-not (Test-Path $distRoot)) {
    Write-Host ""
    Write-Host "  Could not find the 'dist' folder next to this script." -ForegroundColor Red
    Write-Host "  Re-download the project ZIP from GitHub (it should include 'dist')." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
$hasSite = Test-Path (Join-Path $siteRoot 'index.html')

# Try to listen on every network address first, so a phone on the same
# Wi-Fi can open the preview too. Windows only allows that when the
# launcher is run as administrator, so fall back to localhost quietly.
$listener = $null
$port = $null
$lanEnabled = $false

foreach ($candidate in 8080..8090) {
    foreach ($prefix in @("http://+:$candidate/", "http://localhost:$candidate/")) {
        $attempt = New-Object System.Net.HttpListener
        $attempt.Prefixes.Add($prefix)
        try {
            $attempt.Start()
            $listener = $attempt
            $port = $candidate
            $lanEnabled = $prefix.StartsWith('http://+')
            break
        } catch {
            $attempt = $null
        }
    }
    if ($listener) { break }
}

if (-not $listener) {
    Write-Host "  Could not open a local port (8080-8090 all busy)." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$url = "http://localhost:$port/"

$lanIp = $null
if ($lanEnabled) {
    try {
        $lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -First 1).IPAddress
    } catch { $lanIp = $null }
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host "   InsecTra design preview is running" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   On this PC:   $url" -ForegroundColor Cyan
if ($lanIp) {
    Write-Host "   On your PHONE (same Wi-Fi):  http://${lanIp}:$port/" -ForegroundColor Cyan
} else {
    Write-Host "   Phone viewing: right-click the .bat and pick" -ForegroundColor DarkGray
    Write-Host "     'Run as administrator' to enable it." -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "   Keep this black window OPEN while previewing." -ForegroundColor Yellow
Write-Host "   Close it (or press Ctrl+C) when you are done." -ForegroundColor Yellow
Write-Host ""

Start-Process $url | Out-Null

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

$siteCard = if ($hasSite) {
    '<a class="card" href="/website/"><div class="ico">&#127760;</div><h2>Expert Portal website</h2><p>The web dashboard experts open in a browser.</p></a>'
} else {
    '<div class="card disabled"><div class="ico">&#127760;</div><h2>Expert Portal website</h2><p>Not included in this download.</p></div>'
}

$menuHtml = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>InsecTra - Design Preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; flex-direction:column;
         align-items:center; justify-content:center; gap:28px; padding:32px;
         font-family:'Segoe UI',system-ui,sans-serif; background:#f4f7f4; color:#14281d; }
  h1 { margin:0; font-size:26px; }
  .sub { margin:0; color:#5c6f63; font-size:15px; text-align:center; max-width:34rem; }
  .grid { display:flex; flex-wrap:wrap; gap:20px; justify-content:center; }
  .card { width:250px; padding:26px 22px; border-radius:16px; background:#fff;
          border:1px solid #dbe5dd; text-decoration:none; color:inherit;
          box-shadow:0 2px 10px rgba(20,40,29,.06); transition:.15s; }
  .card:hover { transform:translateY(-3px); border-color:#2f7d4f;
                box-shadow:0 8px 20px rgba(20,40,29,.12); }
  .card.disabled { opacity:.5; }
  .ico { font-size:34px; margin-bottom:10px; }
  h2 { margin:0 0 6px; font-size:17px; }
  .card p { margin:0; font-size:13px; color:#5c6f63; line-height:1.45; }
  .tip { font-size:12.5px; color:#7b8b81; text-align:center; max-width:32rem; line-height:1.5; }
</style>
</head>
<body>
  <h1>InsecTra &mdash; Design Preview</h1>
  <p class="sub">UI only. Nothing here talks to a real backend, so nothing you
     click can break anything.</p>
  <div class="grid">
    <a class="card" href="/app"><div class="ico">&#128241;</div>
      <h2>Mobile app</h2><p>Every screen of the farmer app.</p></a>
    $siteCard
  </div>
  <p class="tip">Tip: press <strong>F12</strong>, then click the little phone icon,
     to preview the mobile app at phone size.</p>
</body>
</html>
"@

function Resolve-Under {
    param([string]$Root, [string]$Relative, [string]$FallbackFile)

    $rootFull = (Resolve-Path $Root).ProviderPath
    if (-not [string]::IsNullOrWhiteSpace($Relative)) {
        $joined = Join-Path $Root ($Relative -replace '/', '\')
        if (Test-Path $joined) {
            $resolved = (Resolve-Path $joined).ProviderPath
            # Never serve anything outside the folder we intend to expose.
            if ($resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
                if (Test-Path $resolved -PathType Container) {
                    $indexed = Join-Path $resolved 'index.html'
                    if (Test-Path $indexed) { return $indexed }
                } else {
                    return $resolved
                }
            }
        }
    }
    return (Join-Path $rootFull $FallbackFile)
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response

        try {
            $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).Trim('/')
            $file = $null
            $body = $null

            if ($path -eq '') {
                $body = [System.Text.Encoding]::UTF8.GetBytes($menuHtml)
                $response.ContentType = 'text/html; charset=utf-8'
            }
            elseif ($path -eq 'website' -or $path.StartsWith('website/')) {
                if ($hasSite) {
                    $rest = $path.Substring([Math]::Min(8, $path.Length))
                    $file = Resolve-Under -Root $siteRoot -Relative $rest -FallbackFile 'index.html'
                } else {
                    $file = Join-Path $distRoot 'index.html'
                }
            }
            elseif ($path -eq 'app') {
                $file = Join-Path $distRoot 'index.html'
            }
            else {
                # Everything else is an app asset (/_expo/..., /assets/...) or an
                # Expo Router route, which the app resolves client-side.
                $file = Resolve-Under -Root $distRoot -Relative $path -FallbackFile 'index.html'
            }

            if (-not $body) {
                $body = [System.IO.File]::ReadAllBytes($file)
                $extension = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
                if ($mime.ContainsKey($extension)) {
                    $response.ContentType = $mime[$extension]
                } else {
                    $response.ContentType = 'application/octet-stream'
                }
            }

            $response.StatusCode = 200
            $response.Headers.Add('Cache-Control', 'no-store')
            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)
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
