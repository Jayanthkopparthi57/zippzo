# Rebuild all three Zippzo APK variants with the redesigned UI.
# Each variant needs its own prebuild (package name differs), so this runs
# strictly sequentially: prebuild -> gradle assembleRelease -> copy APK.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\jayan\Downloads\WEBPROJECTS\zippzo-v1'
$mobile = Join-Path $root 'mobile'
$apks = Join-Path $mobile 'apks'
$localPropsBak = 'C:\Users\jayan\AppData\Local\Temp\opencode\local.properties.bak'
$apiBase = 'http://192.168.1.100:8001/api'

New-Item -ItemType Directory -Force -Path $apks | Out-Null

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path (Join-Path $apks 'build.log') -Value $line
}

function Stop-JavaLocks {
  Get-Process java -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like '*antigravity*' } |
    ForEach-Object { Log "killing java $($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Get-Process -Name 'GradleDaemon' -ErrorAction SilentlyContinue |
    ForEach-Object { Log "killing gradle daemon $($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

$variants = @(
  @{ Key = 'shopper'; Out = 'Zippzo-Shopper.apk' },
  @{ Key = 'rider';   Out = 'Zippzo-Rider.apk' },
  @{ Key = 'operations'; Out = 'Zippzo-WMS-DS.apk' }
)

Log '=== build run start ==='

foreach ($v in $variants) {
  $key = $v.Key
  Log "--- $key : prebuild ---"

  Stop-JavaLocks

  if (Test-Path (Join-Path $mobile 'android')) {
    Remove-Item -Recurse -Force (Join-Path $mobile 'android') -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }

  $env:EXPO_PUBLIC_APP_VARIANT = $key
  $env:EXPO_PUBLIC_API_BASE = $apiBase

  Push-Location $mobile
  npx expo prebuild --platform android --non-interactive --clean 2>&1 |
    ForEach-Object { Log "  prebuild: $_" }
  $prebuildExit = $LASTEXITCODE
  Pop-Location

  if ($prebuildExit -ne 0) { Log "!! $key prebuild failed ($prebuildExit)"; continue }

  # Expo regenerates android/ which drops local.properties (SDK path).
  if (Test-Path $localPropsBak) {
    Copy-Item $localPropsBak (Join-Path $mobile 'android\local.properties') -Force
    Log '  local.properties restored'
  } else {
    Log '  !! local.properties backup missing'
  }

  Log "--- $key : assembleRelease ---"
  Push-Location (Join-Path $mobile 'android')
  .\gradlew assembleRelease --no-daemon 2>&1 | ForEach-Object { Log "  gradle: $_" }
  $gradleExit = $LASTEXITCODE
  Pop-Location

  if ($gradleExit -ne 0) { Log "!! $key gradle failed ($gradleExit)"; continue }

  $built = Join-Path $mobile 'android\app\build\outputs\apk\release\app-release.apk'
  if (Test-Path $built) {
    Copy-Item $built (Join-Path $apks $v.Out) -Force
    $size = [math]::Round((Get-Item (Join-Path $apks $v.Out)).Length / 1MB, 1)
    Log "OK $key -> $($v.Out) (${size} MB)"
  } else {
    Log "!! $key APK not found at $built"
  }
}

Log '=== build run end ==='
