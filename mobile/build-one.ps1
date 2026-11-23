# Rebuild a single variant:
#   .\build-one.ps1 -Variant rider -Out Zippzo-Rider.apk
# Pass -ApiBase http://192.168.1.100:8001/api only for an on-device staging build.
param(
  [string]$Variant = 'shopper',
  [string]$Out = 'Zippzo-Shopper.apk',
  [string]$ApiBase = 'https://zippzo-wms-ha2c.onrender.com/api'
)
$ErrorActionPreference = 'Continue'
$mobile = 'C:\Users\jayan\Downloads\WEBPROJECTS\zippzo-v1\mobile'
$apks = Join-Path $mobile 'apks'
$localPropsBak = 'C:\Users\jayan\AppData\Local\Temp\opencode\local.properties.bak'

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path (Join-Path $apks 'build-one.log') -Value $line
}

Log "=== rebuild $Variant ==="

Get-Process java -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*antigravity*' } |
  ForEach-Object { Log "killing java $($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Get-Process -Name 'GradleDaemon' -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

if (Test-Path (Join-Path $mobile 'android')) {
  Remove-Item -Recurse -Force (Join-Path $mobile 'android') -ErrorAction SilentlyContinue
}

$env:EXPO_PUBLIC_APP_VARIANT = $Variant
$env:EXPO_PUBLIC_API_BASE = $ApiBase
Log "API base: $ApiBase"

Push-Location $mobile
npx expo prebuild --platform android --non-interactive --clean 2>&1 | ForEach-Object { Log "  prebuild: $_" }
$pre = $LASTEXITCODE
Pop-Location
if ($pre -ne 0) { Log "!! prebuild failed"; exit 1 }

if (Test-Path $localPropsBak) { Copy-Item $localPropsBak (Join-Path $mobile 'android\local.properties') -Force }
else {
  $sdk = $env:ANDROID_HOME
  if (-not $sdk -and (Test-Path 'C:\Users\jayan\AppData\Local\Android\Sdk')) {
    $sdk = 'C:\Users\jayan\AppData\Local\Android\Sdk'
  }
  if ($sdk) {
    $forward = $sdk -replace '\\', '/'
    "sdk.dir=$forward" | Set-Content -Path (Join-Path $mobile 'android\local.properties') -Encoding ascii
    Log "local.properties -> $sdk"
  }
}

Push-Location (Join-Path $mobile 'android')
.\gradlew assembleRelease --no-daemon 2>&1 | ForEach-Object { Log "  gradle: $_" }
$g = $LASTEXITCODE
Pop-Location
if ($g -ne 0) { Log "!! gradle failed"; exit 1 }

Copy-Item (Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk') (Join-Path $apks $Out) -Force
Log "OK $Out"
