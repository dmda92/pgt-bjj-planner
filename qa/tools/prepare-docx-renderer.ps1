# QA-local Writer engine only. No desktop installation, associations or user profile.
$ErrorActionPreference = 'Stop'
$qaRepoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$qaToolsRoot = Join-Path $qaRepoRoot '.qa/tools'
$qaDownloadDir = Join-Path $qaToolsRoot 'lo'
$qaExtractDir = Join-Path $qaToolsRoot 'lo-extracted'
$qaPackage = Join-Path $qaDownloadDir 'LibreOffice_26.2.6.3_Win_x86-64.msi'
$qaSource = 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.6.3/win/x86_64/LibreOffice_26.2.6.3_Win_x86-64.msi'
$qaExpected = 'F9877032FD908BEB9C0DDF06DF4AF5C2E85F419C42E14876C4CCE5AAE5FB2660'
New-Item -ItemType Directory -Path $qaDownloadDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $qaPackage)) {
    & curl.exe --fail --silent --show-error --max-time 600 --output $qaPackage $qaSource
    if ($LASTEXITCODE -ne 0) { throw 'Official LibreOffice download failed' }
}
$qaHash = (Get-FileHash -LiteralPath $qaPackage -Algorithm SHA256).Hash
$qaSignature = Get-AuthenticodeSignature -LiteralPath $qaPackage
if ($qaHash -ne $qaExpected -or $qaSignature.Status -ne 'Valid' -or $qaSignature.SignerCertificate.Subject -notmatch 'CN=The Document Foundation') {
    throw 'LibreOffice hash or publisher verification failed; package will not execute'
}
$qaExecutable = Join-Path $qaExtractDir 'program/soffice.exe'
if (-not (Test-Path -LiteralPath $qaExecutable)) {
    $qaLog = Join-Path $qaDownloadDir 'extraction.log'
    $qaProcess = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/a',('"'+$qaPackage+'"'),'/qn',('TARGETDIR="'+$qaExtractDir+'"'),'/L*v',('"'+$qaLog+'"')) -WindowStyle Hidden -PassThru -Wait
    if ($qaProcess.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $qaExecutable)) { throw 'QA-local administrative extraction failed' }
}
$qaProvenance = [pscustomobject]@{
    Version = '26.2.6.3'
    Source = $qaSource
    SHA256 = $qaHash
    AuthenticodeStatus = $qaSignature.Status.ToString()
    Signer = 'The Document Foundation'
    Mode = 'Administrative extraction /a /qn only; no desktop install'
    Executable = $qaExecutable
}
$qaProvenance | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaDownloadDir 'provenance.json') -Encoding UTF8
$qaProvenance | ConvertTo-Json
