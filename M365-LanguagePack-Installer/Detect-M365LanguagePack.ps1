<#
.SYNOPSIS
    Intune detection script for M365 Language Pack Installer.
.DESCRIPTION
    Checks if the M365 Language Pack Installer has previously installed
    language packs by looking for the marker registry key.
    - If found: outputs "Installed" (Intune detects the app as installed)
    - If not found: exits silently (Intune treats as not installed)
#>

$regPath = 'HKLM:\SOFTWARE\M365LanguagePacks'

if (Test-Path $regPath) {
    $langs = (Get-ItemProperty -Path $regPath -Name 'InstalledLanguages' -ErrorAction SilentlyContinue).InstalledLanguages
    if ($langs) {
        Write-Output "Installed: $langs"
        exit 0
    }
}

exit 1
