# 打 debug APK。本机 JAVA_HOME 指向 JDK 8，Android Gradle 需要 Android Studio 自带的 JDK 17。
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Jdk {
    $candidates = @(
        "E:\SunJun\develop-software\Andriod Studio\v-2024-1-1\Android Studio\jbr",
        "$env:ProgramFiles\Android\Android Studio\jbr",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
    )
    foreach ($jdkHome in $candidates) {
        $java = Join-Path $jdkHome "bin\java.exe"
        if (Test-Path $java) { return $jdkHome }
    }
    return $null
}

function Find-Sdk {
    $candidates = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        "E:\SunJun\develop-software\Andriod Studio\Sdk",
        "$env:LOCALAPPDATA\Android\Sdk"
    )
    foreach ($dir in $candidates) {
        if ($dir -and (Test-Path (Join-Path $dir "platform-tools"))) { return $dir }
    }
    return $null
}

$jdk = Find-Jdk
if (-not $jdk) { throw "找不到 JDK 17。请确认 Android Studio 已安装。" }
$sdk = Find-Sdk
if (-not $sdk) { throw "找不到 Android SDK。请在 Android Studio 里装好 Android SDK。" }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$jdk\bin;$sdk\platform-tools;" + $env:Path

$sdkDir = ($sdk -replace '\\', '/')
Set-Content -Encoding ascii -Path "android\local.properties" -Value "sdk.dir=$sdkDir"

npm run apk:sync
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& ".\android\gradlew.bat" -p android assembleDebug
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path "apk" | Out-Null
$version = (Get-Content -Raw -Encoding UTF8 "package.json" | ConvertFrom-Json).version
$apkName = "video-h5_$version.apk"
Copy-Item "android\app\build\outputs\apk\debug\app-debug.apk" "apk\$apkName" -Force
Write-Host "APK: $root\apk\$apkName"
