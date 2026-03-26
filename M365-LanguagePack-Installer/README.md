# M365 Language Pack Installer

A self-contained PowerShell script with a professional WPF UI that allows end users to select and install Microsoft 365 language packs. Designed to be called from PSADT 4.1.5 using `Start-ADTProcessAsUser`.

## Prerequisites

1. **PSADT 4.1.5** — your existing PSADT package
2. **Office Deployment Tool (ODT)** — download `setup.exe` from [Microsoft](https://www.microsoft.com/en-us/download/details.aspx?id=49117)
3. **Microsoft 365 Apps** must already be installed on the target device

## Setup

1. Copy `Install-M365LanguagePack.ps1` into your PSADT `Files/` folder
2. Copy ODT `setup.exe` into the same `Files/` folder
3. In your PSADT `Invoke-AppDeployToolkit.ps1`, add these lines to the **Installation** task:

```powershell
## Show language selection UI as the logged-in user
$selectionsFile = Join-Path $envProgramData 'M365LanguagePacks\selections.json'
Start-ADTProcessAsUser -FilePath 'powershell.exe' -ArgumentList "-ExecutionPolicy Bypass -File `"$dirFiles\Install-M365LanguagePack.ps1`" -UIOnly -SelectionsFile `"$selectionsFile`""

## Install selected language packs as SYSTEM
Start-ADTProcess -FilePath 'powershell.exe' -ArgumentList "-ExecutionPolicy Bypass -File `"$dirFiles\Install-M365LanguagePack.ps1`" -InstallOnly -SelectionsFile `"$selectionsFile`""
```

### Why two calls?

Intune deploys Win32 apps as **SYSTEM** (Session 0), which has no desktop and cannot show UI.
- `Start-ADTProcessAsUser` runs the UI phase in the logged-in user's session so the WPF dialog is visible
- `Start-ADTProcess` runs the installation phase as SYSTEM, which has the permissions needed to install language packs via ODT

The selections are passed between phases via a JSON file in `%ProgramData%`.

### Folder structure example

```
YourPSADTPackage/
├── Invoke-AppDeployToolkit.ps1       # Your PSADT entry point
├── PSAppDeployToolkit/               # PSADT 4.1.5 module
├── Files/
│   ├── Install-M365LanguagePack.ps1  # This script
│   └── setup.exe                      # ODT from Microsoft
└── ...
```

## Intune Deployment Settings

| Setting | Value |
|---|---|
| Install command | `powershell.exe -ExecutionPolicy Bypass -File "Invoke-AppDeployToolkit.ps1" -DeploymentType "Install" -DeployMode "Interactive"` |
| Uninstall command | `powershell.exe -ExecutionPolicy Bypass -File "Invoke-AppDeployToolkit.ps1" -DeploymentType "Uninstall" -DeployMode "Silent"` |
| Install behavior | System |
| Device restart behavior | Determine behavior based on return codes |
| Detection rule | Use custom detection script: `Detect-M365LanguagePack.ps1` |

**Important:** Deploy mode **must be Interactive** so PSADT can bridge UI to the user's session.

## How It Works

### Phase 1: UI (runs as logged-in user)
1. Checks M365 is installed and auto-detects the update channel from registry
2. Identifies already-installed languages (shown greyed out in the UI)
3. Shows a professional WPF dialog with search/filter, multi-select checkboxes, Select All / Deselect All
4. Writes the user's language selections to a shared JSON file

### Phase 2: Installation (runs as SYSTEM)
5. Reads the selections JSON file
6. Generates ODT XML configuration with the detected channel and selected languages
7. Runs `setup.exe /configure` to install language packs
8. Writes a registry marker to `HKLM:\SOFTWARE\M365LanguagePacks` for Intune detection
9. Cleans up temporary files

## Script Parameters

| Parameter | Description |
|---|---|
| `-UIOnly` | Show the language selection UI and write selections to JSON. Do not install. |
| `-InstallOnly` | Read selections from JSON and install. Do not show UI. |
| `-SelectionsFile` | Path to the JSON file for passing selections between phases. Default: `%ProgramData%\M365LanguagePacks\selections.json` |
| *(no flags)* | Run both phases sequentially in one process (for standalone testing). |

## Standalone Testing

You can test the script directly (without PSADT) by running it with no flags:

```powershell
.\Install-M365LanguagePack.ps1
```

This runs both UI and installation in the current user context — useful for development and testing.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Prerequisites not met |
| 1602 | User cancelled |
| Other | ODT setup.exe exit code |

## Logs

Logs are written to `%TEMP%\M365LanguagePack_Install_<timestamp>.log`

## Supported Languages

The script includes 50 languages: Afrikaans, Albanian, Arabic, Basque, Bulgarian, Catalan, Chinese (Simplified), Chinese (Traditional), Croatian, Czech, Danish, Dutch, English (US), Estonian, Finnish, French, Galician, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Irish, Italian, Japanese, Kazakh, Korean, Latvian, Lithuanian, Macedonian, Malay, Maltese, Norwegian Bokmal, Norwegian Nynorsk, Polish, Portuguese (Brazil), Portuguese (Portugal), Romanian, Russian, Serbian (Latin), Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Welsh.
