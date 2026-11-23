param(
  [int]$Port = 4321,
  [switch]$NoWindow
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bundle = Join-Path $root "scratch\sidecar-dist\server-bundle.cjs"
$ffmpeg = Join-Path $root "scratch\sidecar-dist\bin\ffmpeg.exe"
$ffprobe = Join-Path $root "scratch\sidecar-dist\bin\ffprobe.exe"
$frontendDist = Join-Path $root "frontend\dist"
$statusUrl = "http://127.0.0.1:$Port/api/status"
$appUrl = "http://127.0.0.1:$Port/"

function Test-ServerReady {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $statusUrl -TimeoutSec 2
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path $bundle) -or -not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
  Write-Host "Compilando bundle do sidecar..."
  & npm --prefix $root run build:sidecar
  if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o sidecar." }
}

if (-not (Test-Path (Join-Path $frontendDist "index.html"))) {
  Write-Host "Compilando frontend React..."
  & npx --yes pnpm --dir (Join-Path $root "frontend") build
  if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o frontend." }
}

$nodeExe = (Get-Command node -ErrorAction Stop).Source
$serverProc = $null

if (-not (Test-ServerReady)) {
  $args = @(
    $bundle,
    "--port", "$Port",
    "--bind", "0.0.0.0",
    "--allow-loopback",
    "--ffmpeg-path", $ffmpeg,
    "--ffprobe-path", $ffprobe,
    "--frontend-dist", $frontendDist
  )
  $serverProc = Start-Process -FilePath $nodeExe -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru

  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-ServerReady)) {
    if ($serverProc.HasExited) {
      throw "O servidor Node encerrou inesperadamente (exit code $($serverProc.ExitCode))."
    }
    if ((Get-Date) -gt $deadline) {
      throw "Tempo esgotado aguardando $statusUrl responder."
    }
    Start-Sleep -Milliseconds 150
  }
}

if (-not $NoWindow) {
  $browser = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$appUrl", "--window-size=1280,820"
  } else {
    Start-Process $appUrl
  }
}

Write-Host "Stream to My TV ativo em $appUrl (servidor Node assinado: $nodeExe)"
