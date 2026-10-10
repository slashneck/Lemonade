# Builds everything for a GitHub release into .\dist:
#   LemonadeSetup-<version>.exe              the installer, with Lemonade inside
#   Lemonade-<version>-win-x64.zip           the program alone, which the auto updater downloads
#   Lemonade-<version>-win-x64.zip.sha256    its checksum, which the updater verifies
#   Lemonade-<version>-source.zip            the source code without build output
#
# Needs Node.js 20 or newer and the .NET 8 SDK. The version comes from package.json.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Zip entries always use forward slashes, whatever the .NET version behind PowerShell does by default.
function New-Zip([string]$Folder, [string]$Destination, [string]$Prefix = '') {
    $archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem $Folder -Recurse -File) {
            $name = $Prefix + $file.FullName.Substring($Folder.Length + 1).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally {
        $archive.Dispose()
    }
}

$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
Write-Host "Building Lemonade $version"

# 1. Packages, the word list and the art
if (-not (Test-Path 'node_modules')) {
    npm ci
    if ($LASTEXITCODE) { throw 'Installing the packages failed' }
}
npm run lexicon
if ($LASTEXITCODE) { throw 'Building the word list failed' }
npm run art
if ($LASTEXITCODE) { throw 'Drawing the art failed' }

# 2. The program
$dist = Join-Path $PSScriptRoot 'dist'
$work = Join-Path $PSScriptRoot 'build'
foreach ($dir in $dist, $work) { if (Test-Path $dir) { Remove-Item $dir -Recurse -Force } }
npx electron-builder --win dir --publish never
if ($LASTEXITCODE) { throw 'Building Lemonade failed' }
$app = Join-Path $work 'electron\win-unpacked'
Copy-Item 'LICENSE', 'THIRD-PARTY-NOTICES.md' $app

# 3. The file list. Updates and uninstalling only ever touch the files named here.
$files = Get-ChildItem $app -Recurse -File | ForEach-Object { $_.FullName.Substring($app.Length + 1) } | Sort-Object
[IO.File]::WriteAllLines((Join-Path $app 'lemonade-files.txt'), [string[]]$files, (New-Object Text.UTF8Encoding $false))

# 4. Zip and checksum
New-Item -ItemType Directory $dist | Out-Null
$zipName = "Lemonade-$version-win-x64.zip"
$zip = Join-Path $dist $zipName
New-Zip $app $zip
$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zip.sha256", "$sha  $zipName`n")

# 5. Setup
$setupOut = Join-Path $work 'setup'
dotnet build 'setup\Lemonade.Setup.csproj' -c Release "-p:Version=$version" "-p:PayloadZip=$zip" -o $setupOut --nologo
if ($LASTEXITCODE) { throw 'Building the setup failed' }
Move-Item (Join-Path $setupOut 'LemonadeSetup.exe') (Join-Path $dist "LemonadeSetup-$version.exe")

# 6. Source code, without build output
$source = Join-Path $work "Lemonade-$version-source"
New-Item -ItemType Directory $source | Out-Null
Copy-Item '.gitignore', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'build-release.ps1', 'package.json', 'package-lock.json' $source
foreach ($dir in 'src', 'tools', 'setup', 'assets', 'docs') {
    robocopy $dir (Join-Path $source $dir) /E /XD bin obj node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $dir failed" }
}
$global:LASTEXITCODE = 0
New-Zip $source (Join-Path $dist "Lemonade-$version-source.zip") "Lemonade-$version-source/"
Remove-Item $work -Recurse -Force

Write-Host ''
Write-Host "Done. Release files are in $dist"
Get-ChildItem $dist | Format-Table Name, @{ Name = 'MB'; Expression = { [math]::Round($_.Length / 1MB, 1) } } -AutoSize
