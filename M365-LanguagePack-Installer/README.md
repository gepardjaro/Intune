# M365 Language Pack Installer

A self-contained PowerShell script with a professional WPF UI that allows end users to select and install Microsoft 365 language packs. Designed to be triggered from PSADT 4.1.5 with a single line.

## Prerequisites

1. **PSADT 4.1.5** — your existing PSADT package
2. **Office Deployment Tool (ODT)** — download `setup.exe` from [Microsoft](https://www.microsoft.com/en-us/download/details.aspx?id=49117)
3. **Microsoft 365 Apps** must already be installed on the target device

## Setup

1. Copy `Install-M365LanguagePack.ps1` into your PSADT `Files/` folder
2. Copy ODT `setup.exe` into the same `Files/` folder
3. In your PSADT `Invoke-AppDeployToolkit.ps1`, add this one-liner to the **Installation** task:

```powershell
& "$dirFiles\Install-M365LanguagePack.ps1"
```

### Folder structure example

```
YourPSADTPackage/
├── Invoke-AppDeployToolkit.ps1       # Your PSADT entry point
├── AppDeployToolkit/                  # PSADT 4.1.5 module
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

**Important:** Deploy mode **must be Interactive** so the language selection UI is shown to the user.

## How It Works

1. **Prerequisite checks** — verifies M365 is installed and `setup.exe` is available
2. **Channel auto-detection** — reads the installed M365 update channel from registry
3. **Installed language detection** — identifies already-installed languages (shown greyed out)
4. **WPF UI** — displays a professional dialog with:
   - Search/filter box
   - Scrollable checkbox list of 50 languages
   - Select All / Deselect All
   - Install / Cancel buttons
5. **ODT XML generation** — creates configuration XML for selected languages
6. **Installation** — runs `setup.exe /configure` with the generated XML
7. **Registry marker** — writes installed languages to `HKLM:\SOFTWARE\M365LanguagePacks` for detection

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

The script includes 50 languages: Afrikaans, Albanian, Arabic, Basque, Bulgarian, Catalan, Chinese (Simplified), Chinese (Traditional), Croatian, Czech, Danish, Dutch, English (US), Estonian, Finnish, French, Galician, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Irish, Italian, Japanese, Kazakh, Korean, Latvian, Lithuanian, Macedonian, Malay, Maltese, Norwegian Bokmål, Norwegian Nynorsk, Polish, Portuguese (Brazil), Portuguese (Portugal), Romanian, Russian, Serbian (Latin), Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Welsh.
