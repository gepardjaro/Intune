import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { exec } from "child_process";
import fs from "fs";
import { promisify } from "util";
import https from "https";
import http from "http";
import AdmZip from "adm-zip";

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);

// Platform-independent download using http/https module with redirect support
const downloadFile = (url: string, dest: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
      } else if (response.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
      }
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
};

// Helper function for wrapping
async function wrapApp(appName: string, version: string) {
  const sourceFolder = path.join(process.cwd(), "src_packager", "PSADT");
  const setupFile = "Invoke-AppDeployToolkit.ps1";
  const outputFolder = path.join(process.cwd(), "output");
  const utilPath = path.join(process.cwd(), "intunewinapputil", "IntuneWinAppUtil.exe");

  console.log(`Starting wrap for ${appName}...`);
  
  // 1. Verify requirements & Auto-download util if missing
  if (!fs.existsSync(utilPath)) {
    console.log("IntuneWinAppUtil.exe missing, attempting to download...");
    const utilDir = path.dirname(utilPath);
    if (!fs.existsSync(utilDir)) fs.mkdirSync(utilDir, { recursive: true });
    
    // Download from Microsoft GitHub
    const downloadUrl = "https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool/raw/master/IntuneWinAppUtil.exe";
    const command = `pwsh -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${utilPath}'"`;
    try {
      await execAsync(command);
    } catch (downloadErr) {
      await execAsync(`powershell -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${utilPath}'"`);
    }
  }

  if (!fs.existsSync(sourceFolder)) fs.mkdirSync(sourceFolder, { recursive: true });
  const setupFilePath = path.join(sourceFolder, setupFile);
  if (!fs.existsSync(setupFilePath)) {
    await promisify(fs.writeFile)(setupFilePath, "# PSADT Entry Point\nWrite-Output 'Starting deployment...'", "utf-8");
  }

  if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

  let stdout = "";
  const tryCommand = async (shell: string) => {
    const cmd = `${shell} -Command "& '${utilPath}' -c '${sourceFolder}' -s '${setupFile}' -o '${outputFolder}' -q"`;
    console.log(`Executing: ${cmd}`);
    return await execAsync(cmd);
  };

  try {
    const result = await tryCommand("pwsh");
    stdout = result.stdout;
  } catch (e) {
    try {
      const result = await tryCommand("powershell");
      stdout = result.stdout;
    } catch (e2) {
      throw new Error(`Packaging failed. Ensure PowerShell is available. Error: ${e2.message}`);
    }
  }

  const expectedFileName = `${setupFile.replace('.ps1', '')}.intunewin`;
  const expectedPath = path.join(outputFolder, expectedFileName);
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (fs.existsSync(expectedPath)) {
    return { fileName: expectedFileName, fullPath: expectedPath, stdout };
  } else {
    const files = fs.readdirSync(outputFolder);
    const intunewinFiles = files.filter(f => f.endsWith('.intunewin'));
    if (intunewinFiles.length > 0) {
      return { fileName: intunewinFiles[0], fullPath: path.join(outputFolder, intunewinFiles[0]), stdout };
    } else {
      throw new Error("IntuneWinAppUtil finished but no .intunewin file was found in the output folder.");
    }
  }
}

// Helper function for Intune import using IntuneWin32App module
async function importToIntune(params: {
  filePath: string;
  appName: string;
  appId: string;
  version: string;
  publisher: string;
  description: string;
  category: string;
  iconPath?: string;
  installCommand?: string;
  uninstallCommand?: string;
  developer?: string;
  owner?: string;
  notes?: string;
  informationUrl?: string;
  privacyUrl?: string;
  minOS?: string;
  maxInstallationTime?: number;
  allowAvailableUninstall?: boolean;
  installBehavior?: string;
  deviceRestartBehavior?: string;
  checkArchitecture?: boolean;
  architectures?: string[];
  credentials: {
    clientId?: string;
    clientSecret?: string;
    tenantId?: string;
  };
}) {
  const { filePath, appName, appId, version, publisher, description, category, iconPath, installCommand, uninstallCommand, developer, owner, notes, informationUrl, privacyUrl, minOS, maxInstallationTime, allowAvailableUninstall, installBehavior, deviceRestartBehavior, checkArchitecture, architectures, credentials } = params;
  
  // Azure AD Credentials from request or environment
  const clientId = credentials.clientId || process.env.INTUNE_CLIENT_ID;
  const clientSecret = credentials.clientSecret || process.env.INTUNE_CLIENT_SECRET;
  const tenantId = credentials.tenantId || process.env.INTUNE_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error("Missing Azure AD credentials. Please provide Client ID, Client Secret, and Tenant ID in Step 1 or environment variables.");
  }

  const escapePS = (str: string | undefined) => (str || '').replace(/'/g, "''");
  const safeInstallCmd = escapePS(installCommand || 'powershell.exe -ExecutionPolicy Bypass -File Invoke-AppDeployToolkit.ps1');
  const safeUninstallCmd = escapePS(uninstallCommand || 'powershell.exe -ExecutionPolicy Bypass -File Invoke-AppDeployToolkit.ps1 -DeploymentType Uninstall');

  const psScript = `
    $ErrorActionPreference = 'Stop'
    
    try {
      # Check if IntuneWin32App module is installed
      if (-not (Get-Module -ListAvailable -Name IntuneWin32App)) {
        Write-Host "Installing IntuneWin32App module..."
        Install-Module -Name IntuneWin32App -Force -Scope CurrentUser -AllowClobber
      }
      # Import-Module IntuneWin32App
      if (-not (Get-Module -Name IntuneWin32App)) {
        Import-Module IntuneWin32App
      }

      # Authenticate with Microsoft Graph
      Write-Host "Connecting to Microsoft Graph..."
      
      $TID = $env:IMPORT_TENANT_ID
      $CID = $env:IMPORT_CLIENT_ID
      $Secret = $env:IMPORT_CLIENT_SECRET

      if (-not $TID -or -not $CID -or -not $Secret) {
          throw "Missing credentials in environment variables."
      }

      # Try Connect-MSIntuneGraph (from IntuneWin32App)
      # We pass the secret as a plain string. If the cmdlet expects a SecureString, 
      # we will catch the error and try with a SecureString.
      try {
          $global:graphAuth = Connect-MSIntuneGraph -TenantID $TID -ClientID $CID -ClientSecret $Secret -ErrorAction Stop
      } catch {
          Write-Host "First auth attempt failed, trying with SecureString..."
          $SecureSecret = ConvertTo-SecureString $Secret -AsPlainText -Force
          $global:graphAuth = Connect-MSIntuneGraph -TenantID $TID -ClientID $CID -ClientSecret $SecureSecret -ErrorAction Stop
      }
      
      $authToken = $global:graphAuth.Authorization
      if (-not $authToken) {
          # Fallback if the module sets a global variable instead of returning
          if ($global:authToken) { $authToken = $global:authToken }
          elseif ($global:MSGraphToken) { $authToken = $global:MSGraphToken }
      }

      # Import the application using Add-IntuneWin32App
      Write-Host "Importing ${appName} v${version} to Intune..."
      $RestartBehaviorMap = @{
        "DetermineByReturnCode" = "basedOnReturnCode"
        "ForceReboot" = "force"
        "SuppressReboot" = "suppress"
        "AppInstallMayForceReboot" = "allow"
      }
      $MappedRestartBehavior = $RestartBehaviorMap['${escapePS(deviceRestartBehavior || 'DetermineByReturnCode')}']
      if (-not $MappedRestartBehavior) { $MappedRestartBehavior = "basedOnReturnCode" }

      $AddParams = @{
        FilePath            = '${escapePS(filePath)}'
        DisplayName         = '${escapePS(appName)}'
        Description         = '${escapePS(description || 'FILL THE DESCRIPTION')}'
        Publisher           = '${escapePS(publisher)}'
        AppVersion          = '${escapePS(version)}'
        InstallCommandLine  = '${safeInstallCmd}'
        UninstallCommandLine = '${safeUninstallCmd}'
        InstallExperience   = '${escapePS((installBehavior || 'system').toLowerCase())}'
        RestartBehavior     = $MappedRestartBehavior
        MaximumInstallationTimeInMinutes = ${maxInstallationTime || 60}
        AllowAvailableUninstall = ${allowAvailableUninstall ? '$true' : '$false'}
      }
      
      # Add a detection rule. Use a script if provided, otherwise default to explorer.exe existence.
      Write-Host "Adding detection rule..."
      $DetectionScript = @'
# ---------------------------------------------------------
# DEFINE THE ACTUAL PAYLOAD (Independent of PS Version)
# ---------------------------------------------------------
$scriptPayload = {
$AppId = '${escapePS(appId)}'
$checkApp = get-wingetpackage -Id "$AppId"
if ($checkApp.Count -gt 0) {
    $availableUpdate = @($checkApp | Where-Object { $_.IsUpdateAvailable })
    # Match against the ID property of the objects
    if ($availableUpdate.Count -gt 0) {
        $packageObject = $availableUpdate[0]
        $localID = $packageObject.Id
        Write-Output "Update found for $localID. Update required"
        exit 1
    }
    else {
        Write-Output "$AppId is installed and up to date"
        exit 0
    }

}
else {
    Write-Output "$AppId is not installed"
    exit 1
}
}
# ---------------------------------------------------------
# PS7 CHECK AND EXECUTION ROUTING
# ---------------------------------------------------------
if ($PSVersionTable.PSVersion.Major -lt 7) {

    $pwshPath = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    # Launch pwsh and pass the commands directly
    Write-Host "Running in PS5.1. Launching commands in PowerShell 7..."
    & $pwshPath -NoProfile -ExecutionPolicy Bypass -Command $scriptPayload

    if ( $LASTEXITCODE -eq 1 ) {
        Write-Output "Installation failed or update is required"
        exit 1
    }
    else {
        Write-Output "Application is installed and up to date"
        exit 0
    }
}
else {
    # We are already running in PS7 natively, so just run the payload!
    Write-Host "Already running in PowerShell 7. Executing payload..."
    & $scriptPayload
}
'@
      $DetectionScriptPath = Join-Path $env:TEMP "DetectionScript_$([Guid]::NewGuid()).ps1"
      $DetectionScript | Out-File -FilePath $DetectionScriptPath -Encoding UTF8
      $DetectionRule = New-IntuneWin32AppDetectionRuleScript -ScriptFile $DetectionScriptPath -EnforceSignatureCheck $false -RunAs32Bit $false
      $AddParams.DetectionRule = $DetectionRule

      # Add requirement rule
      ${(() => {
        if (checkArchitecture && architectures && architectures.length > 0) {
          const hasX86 = architectures.includes('x86');
          const hasX64 = architectures.includes('x64');
          const hasARM64 = architectures.includes('ARM64');
          let archValue = 'x64';
          if (hasARM64 && (hasX86 || hasX64)) archValue = 'AllWithARM64';
          else if (hasX86 && hasX64) archValue = 'x64x86';
          else if (hasARM64) archValue = 'arm64';
          else if (hasX64) archValue = 'x64';
          else if (hasX86) archValue = 'x86';
          return `$archValue = '${archValue}'`;
        }
        return `$archValue = 'AllWithARM64'`;
      })()}
      $MinOSMap = @{
        "Windows 10 1607" = "W10_1607"
        "Windows 10 1703" = "W10_1703"
        "Windows 10 1709" = "W10_1709"
        "Windows 10 1803" = "W10_1803"
        "Windows 10 1809" = "W10_1809"
        "Windows 10 1903" = "W10_1903"
        "Windows 10 1909" = "W10_1909"
        "Windows 10 2004" = "W10_2004"
        "Windows 10 20H2" = "W10_20H2"
        "Windows 10 21H1" = "W10_21H1"
        "Windows 10 21H2" = "W10_21H2"
        "Windows 10 22H2" = "W10_22H2"
        "Windows 11 21H2" = "W11_21H2"
        "Windows 11 22H2" = "W11_22H2"
        "Windows 11 23H2" = "W11_23H2"
        "Windows 11 24H2" = "W11_24H2"
      }
      $MappedMinOS = $MinOSMap['${escapePS(minOS || 'Windows 10 20H2')}']
      if (-not $MappedMinOS) { $MappedMinOS = "W10_20H2" }
      $RequirementRule = New-IntuneWin32AppRequirementRule -Architecture $archValue -MinimumSupportedWindowsRelease $MappedMinOS
      $AddParams.RequirementRule = $RequirementRule

      # NOTE: The IntuneWin32App module currently has a bug where it passes the literal string path
      # to the Graph API instead of converting it to a base64 Edm.Binary string, causing a ModelValidationFailure.
      # We are temporarily disabling the icon upload to ensure the app imports successfully.
      # if ("${iconPath}" -ne "undefined" -and "${iconPath}" -ne "" -and (Test-Path "${iconPath}")) {
      #   $AddParams.Icon = "${iconPath}"
      # }

      # Execute the upload
      $warnMsg = $null
      $CreatedApp = Add-IntuneWin32App @AddParams -WarningVariable warnMsg
      
      if ($warnMsg -and $warnMsg -match "An error occurred") {
          throw "Intune upload failed: $warnMsg"
      }
      
      # Now update the app details and upload the icon manually using Graph API
      Write-Host "Updating additional app details for ${appName}..."
      $AppId = $CreatedApp.id
      if (-not $AppId) {
          Write-Host "Searching for newly created app by name..."
          $searchUri = "deviceAppManagement/mobileApps?${'`'}$filter=displayName eq '${escapePS(appName)}'"
          
          $searchResult = Invoke-RestMethod -Uri "https://graph.microsoft.com/beta/$searchUri" -Method GET -Headers @{Authorization = $authToken}
          
          if ($searchResult -and $searchResult.value) {
              $latestApp = $searchResult.value | Sort-Object createdDateTime -Descending | Select-Object -First 1
              if ($latestApp) {
                  $AppId = $latestApp.id
                  $CreatedApp = $latestApp
              }
          }
      }

      if (-not $AppId) {
          Write-Host "Could not retrieve App ID. Additional details and icon upload skipped."
      } else {
          # GET the application first to retrieve its exact @odata.type
          $appUri = "deviceAppManagement/mobileApps/$AppId"
          $appReq = Invoke-RestMethod -Uri "https://graph.microsoft.com/beta/$appUri" -Method GET -Headers @{Authorization = $authToken}
          
          $AppType = $appReq.'@odata.type'
          if (-not $AppType) { $AppType = "#microsoft.graph.win32LobApp" }
          
          Write-Host "Detected app type: $AppType"

          $patchPayload = @{
              "@odata.type" = $AppType
          }
          
          if ('${escapePS(developer)}' -ne '' -and '${escapePS(developer)}' -ne 'undefined') { $patchPayload.developer = '${escapePS(developer)}' }
          if ('${escapePS(owner)}' -ne '' -and '${escapePS(owner)}' -ne 'undefined') { $patchPayload.owner = '${escapePS(owner)}' }
          if ('${escapePS(notes)}' -ne '' -and '${escapePS(notes)}' -ne 'undefined') { $patchPayload.notes = '${escapePS(notes)}' }
          
          $infoUrl = '${escapePS(informationUrl)}'
          if ($infoUrl -ne '' -and $infoUrl -ne 'undefined') { 
              if (-not ($infoUrl.StartsWith("http://") -or $infoUrl.StartsWith("https://"))) {
                  $infoUrl = "https://" + $infoUrl
              }
              $patchPayload.informationUrl = $infoUrl 
          }
          
          $privUrl = '${escapePS(privacyUrl)}'
          if ($privUrl -ne '' -and $privUrl -ne 'undefined') { 
              if (-not ($privUrl.StartsWith("http://") -or $privUrl.StartsWith("https://"))) {
                  $privUrl = "https://" + $privUrl
              }
              $patchPayload.privacyUrl = $privUrl 
          }
          
          $minOsMap = @{
              "Windows 10 1607" = @{ key = "v10_1607"; release = "1607" }
              "Windows 10 1703" = @{ key = "v10_1703"; release = "1703" }
              "Windows 10 1709" = @{ key = "v10_1709"; release = "1709" }
              "Windows 10 1803" = @{ key = "v10_1803"; release = "1803" }
              "Windows 10 1809" = @{ key = "v10_1809"; release = "1809" }
              "Windows 10 1903" = @{ key = "v10_1903"; release = "1903" }
              "Windows 10 1909" = @{ key = "v10_1909"; release = "1909" }
              "Windows 10 2004" = @{ key = "v10_2004"; release = "2004" }
              "Windows 10 20H2" = @{ key = "v10_2H20"; release = "2H20" }
              "Windows 10 21H1" = @{ key = "v10_21H1"; release = "21H1" }
              "Windows 10 21H2" = @{ key = "v10_21H1"; release = "Windows10_21H2" }
              "Windows 10 22H2" = @{ key = "v10_21H1"; release = "Windows10_22H2" }
              "Windows 11 21H2" = @{ key = "v10_21H1"; release = "Windows11_21H2" }
              "Windows 11 22H2" = @{ key = "v10_21H1"; release = "Windows11_22H2" }
              "Windows 11 23H2" = @{ key = "v10_21H1"; release = "Windows11_23H2" }
              "Windows 11 24H2" = @{ key = "v10_21H1"; release = "Windows11_24H2" }
          }
          $minOsObj = $minOsMap['${escapePS(minOS)}']
          if (-not $minOsObj) { $minOsObj = @{ key = "v10_1607"; release = "1607" } }
          
          $patchPayload.minimumSupportedWindowsRelease = $minOsObj.release

          if ('${escapePS(iconPath)}' -ne 'undefined' -and '${escapePS(iconPath)}' -ne '' -and (Test-Path '${escapePS(iconPath)}')) {
              $ext = [System.IO.Path]::GetExtension('${escapePS(iconPath)}').ToLower()
              $mimeType = "image/png"
              if ($ext -eq ".jpg" -or $ext -eq ".jpeg") { $mimeType = "image/jpeg" }
              elseif ($ext -eq ".ico") { $mimeType = "image/x-icon" }

              $imageBytes = [System.IO.File]::ReadAllBytes('${escapePS(iconPath)}')
              $base64String = [System.Convert]::ToBase64String($imageBytes)

              $patchPayload.largeIcon = @{
                  "@odata.type" = "#microsoft.graph.mimeContent"
                  type          = $mimeType
                  value         = $base64String
              }
          }

          $payloadJson = $patchPayload | ConvertTo-Json -Depth 10 -Compress

          $absoluteUri = "https://graph.microsoft.com/beta/$appUri"
          
          try {
              if ($authToken) {
                  Invoke-RestMethod -Uri $absoluteUri -Method PATCH -Headers @{Authorization = $authToken} -Body $payloadJson -ContentType "application/json" | Out-Null
                  Write-Host "App details and icon updated successfully!"
              } else {
                  Write-Host "Could not find a suitable command to update the app. Auth token is missing."
              }
          } catch {
              $errResponse = $_.ErrorDetails.Message
              if (-not $errResponse -and $_.Exception.Response) {
                  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                  $errResponse = $reader.ReadToEnd()
              }
              if (-not $errResponse) {
                  $errResponse = $_.Exception.Message
              }
              Write-Host "Failed to update app details: $errResponse"
              Write-Host "Payload was: $payloadJson"
          }

          if ('${escapePS(category)}' -ne '' -and '${escapePS(category)}' -ne 'undefined') {
              $catName = '${escapePS(category)}'
              Write-Host "Processing category: $catName"
              $catUri = "deviceAppManagement/mobileAppCategories?${'`'}$filter=displayName eq '$([uri]::EscapeDataString($catName))'"
              $catRes = Invoke-RestMethod -Uri "https://graph.microsoft.com/beta/$catUri" -Method GET -Headers @{Authorization = $authToken}
              
              $catId = $null
              if ($catRes.value.Count -gt 0) {
                  $catId = $catRes.value[0].id
              } else {
                  Write-Host "Category '$catName' not found in tenant. Skipping assignment."
              }

              if ($catId) {
                  $catAssignPayload = @{
                      "@odata.id" = "https://graph.microsoft.com/beta/deviceAppManagement/mobileAppCategories/$catId"
                  } | ConvertTo-Json -Depth 10
                  try {
                      Invoke-RestMethod -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/categories/${'`'}$ref" -Method POST -Headers @{Authorization = $authToken; "Content-Type" = "application/json"} -Body $catAssignPayload | Out-Null
                      Write-Host "Successfully assigned category '$catName' to the app."
                  } catch {
                      Write-Host "Failed to assign category: $_"
                  }
              }
          }
      }

      Write-Host "Import completed successfully."
    } catch {
      Write-Error $_.Exception.Message
      exit 1
    }
  `;

  const scriptPath = path.join(process.cwd(), "temp_import.ps1");
  fs.writeFileSync(scriptPath, psScript, "utf-8");

  try {
    console.log(`Executing Intune import script for ${appName}...`);
    const result = await execAsync(`pwsh -File "${scriptPath}"`, {
      env: {
        ...process.env,
        IMPORT_TENANT_ID: tenantId,
        IMPORT_CLIENT_ID: clientId,
        IMPORT_CLIENT_SECRET: clientSecret
      }
    });
    console.log("Intune import script output:\n", result.stdout);
    return result.stdout;
  } catch (error: any) {
    console.error("Intune import script failed:", error.message);
    if (error.stdout) console.error("Stdout:", error.stdout);
    if (error.stderr) console.error("Stderr:", error.stderr);
    const fullOutput = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(fullOutput || error.message);
  } finally {
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  const localIconsDir = path.join(process.cwd(), "src_packager", "icons", "icons-main", "icons");
  app.use("/icons", express.static(localIconsDir));

  // API: Get Server Info
  app.get("/api/info", (req, res) => {
    res.json({ 
      platform: process.platform,
      hasApiKey: !!process.env.GEMINI_API_KEY
    });
  });

  // API: Search Apps using Find-WinGetPackage or winget.exe
  app.get("/api/search", async (req, res) => {
    const { query } = req.query;
    if (!query) return res.json([]);

    try {
      // On Windows, we try direct winget search first as it's most reliable
      // On Linux, we use the PowerShell module (which we try to install)
      const isWindows = process.platform === 'win32';
      
      let results: any[] = [];
      let stdout = "";

      if (isWindows) {
        try {
          // Run winget through PowerShell to get clean output (no VT escape codes)
          console.log(`Executing direct winget search for: ${query}`);
          const escapedQuery = query.replace(/'/g, "''");
          let wingetResult;
          try {
            wingetResult = await execAsync(
              `powershell.exe -NoProfile -Command "winget search '${escapedQuery}' --accept-source-agreements 2>$null | Out-String -Width 500"`
            );
          } catch (e) {
            console.warn("Winget search via powershell failed, trying cmd...");
            wingetResult = await execAsync(`winget search "${query}" --accept-source-agreements`);
          }

          const stdout = wingetResult.stdout;
          console.log(`Winget search output for "${query}":`, stdout);
          const lines = stdout.split('\n').filter(l => l.trim() !== "");
          
          if (lines.length > 0) {
            // Find the separator line (------) which always comes after the header
            const sepIndex = lines.findIndex(l => /^[-\s]+$/.test(l.trim()) && l.includes('---'));
            if (sepIndex > 0 && lines.length > sepIndex + 1) {
              const headerLine = lines[sepIndex - 1];
              console.log(`Header line: "${headerLine}"`);

              // Try column-position parsing using the header
              const idMatch = headerLine.match(/\bId\b/);
              const versionMatch = headerLine.match(/\bVersion\b/);
              const sourceMatch = headerLine.match(/\bSource\b/);

              const idCol = idMatch ? idMatch.index! : -1;
              const versionCol = versionMatch ? versionMatch.index! : -1;
              const sourceCol = sourceMatch ? sourceMatch.index! : -1;

              const dataLines = lines.slice(sepIndex + 1);
              console.log(`Parsing ${dataLines.length} data lines, idCol=${idCol}, versionCol=${versionCol}, sourceCol=${sourceCol}`);

              if (idCol > 0 && versionCol > 0) {
                // Fixed-width column parsing
                results = dataLines.map(line => {
                  if (line.length < versionCol) return null;
                  const name = line.substring(0, idCol).trim();
                  const id = line.substring(idCol, versionCol).trim();
                  const version = sourceCol > 0
                    ? line.substring(versionCol, sourceCol).trim().split(/\s+/)[0]
                    : line.substring(versionCol).trim().split(/\s+/)[0];
                  const source = sourceCol > 0 && line.length > sourceCol
                    ? line.substring(sourceCol).trim() : 'winget';
                  if (!name || !id) return null;
                  return { Name: name, Id: id, Version: version || "Unknown", Source: source || 'winget' };
                }).filter(Boolean);
              } else {
                // Fallback: split by 2+ whitespace
                results = dataLines.map(line => {
                  const parts = line.split(/\s{2,}/);
                  if (parts.length >= 3) {
                    return {
                      Name: parts[0].trim(),
                      Id: parts[1].trim(),
                      Version: parts[2].trim(),
                      Source: parts.length >= 4 ? parts[parts.length - 1].trim() : 'winget'
                    };
                  }
                  return null;
                }).filter(Boolean);
              }
              console.log(`Found ${results.length} results via direct winget search`);
            }
          }
        } catch (e) {
          console.warn("Direct winget search failed:", e.message);
        }
      }

      // If direct winget failed or we are on Linux, try PowerShell module
      if (results.length === 0) {
        const command = `pwsh -NoProfile -Command "
          $ErrorActionPreference = 'SilentlyContinue'
          try {
              Import-Module Microsoft.WinGet.Client -ErrorAction SilentlyContinue
              $psResults = Find-WinGetPackage -Name '${query}' -Source winget -ErrorAction SilentlyContinue
              if ($psResults) {
                  $psResults | Select-Object Name, Id, Version, Source | ConvertTo-Json -Compress
              } else {
                  '[]'
              }
          } catch {
              '[]'
          }
        "`;

        try {
          const result = await execAsync(command);
          stdout = result.stdout;
        } catch (e) {
          try {
            const result = await execAsync(command.replace('pwsh', 'powershell'));
            stdout = result.stdout;
          } catch (e2) {
            console.error("PowerShell search failed:", e2.message);
          }
        }

        if (stdout && stdout.trim() !== "" && stdout.trim() !== "[]") {
          try {
            const parsed = JSON.parse(stdout);
            results = Array.isArray(parsed) ? parsed : [parsed];
          } catch (parseErr) {
            console.error("Failed to parse PowerShell output:", stdout);
          }
        }
      }

      const formattedResults = results.map((app: any) => {
        const id = app.Id || "unknown";
        // Derive moniker from ID (e.g. Google.Chrome -> chrome)
        const moniker = id.split('.').pop()?.toLowerCase() || "unknown";
        // Derive publisher from ID (e.g. Microsoft.PowerToys -> Microsoft)
        const publisher = id.includes('.') ? id.split('.')[0] : (app.Name || "Unknown").split(' ')[0];

        return {
          name: app.Name || "Unknown",
          id: id,
          version: app.Version || "0.0.0",
          moniker: moniker,
          publisher: publisher,
          source: app.Source || 'winget'
        };
      });

      res.json(formattedResults);
    } catch (error) {
      console.error("Search API error:", error);
      res.json([]);
    }
  });

  // Reusable function to inject scripts and placeholders into a PSADT template
  function injectPsadtScripts(content: string): string {
    let result = content;

    // Inject app detail placeholders into $adtSession block (matches any existing value)
    result = result.replace(/AppVendor = '[^']*'/, "AppVendor = '__APPVENDOR__'");
    result = result.replace(/AppName = '[^']*'/, "AppName = '__APPNAME__'");
    result = result.replace(/AppVersion = '[^']*'/, "AppVersion = '__APPVERSION__'");
    result = result.replace(/AppScriptDate = '[^']*'/, "AppScriptDate = '__APPSCRIPTDATE__'");
    result = result.replace(/AppScriptAuthor = '[^']*'/, "AppScriptAuthor = '__APPSCRIPTAUTHOR__'");

    // Inject Pre-Installation tasks (NuGet, PS7, WinGet module) — only if not already injected
    if (result.includes("    ## <Perform Pre-Installation tasks here>") && !result.includes("Install-PackageProvider -Name NuGet")) {
      const preInstallTasks = `    ## <Perform Pre-Installation tasks here>
    if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction Ignore)) {
        Write-Host "Installing NuGet provider..."
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers | Out-Null
    }

    $pwshPath = "$env:ProgramW6432\\PowerShell\\7\\pwsh.exe"
    # 1. Check if PowerShell 7 is installed machine-wide
    if (-not (Test-Path $pwshPath)) {
        Write-Host "PowerShell 7 not found. Installing silently for SYSTEM (Machine-wide)..."
        $JBNWingetAppID = "Microsoft.Powershell"
        #Help SYSTEM find winget.exe folder
        Set-Location -Path ("$env:ProgramW6432\\WindowsApps\\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe")
        #Update software with winget.exe
        .\\winget.exe install --id $JBNWingetAppID --silent --accept-package-agreements --accept-source-agreements
        $code = $LASTEXITCODE
        Write-Output "winget exit code: $code"
        # 0 = success, -1978335189 = already installed (0x8A150019)
        if ($code -ne 0 -and $code -ne -1978335189) {
            if (-not (Test-Path $pwshPath)) {
                Write-Error "PowerShell 7 installation failed with exit code $code."
                exit $code
            }
            Write-Host "winget returned $code but PS7 exists at $pwshPath, continuing..."
        }
        if (-not (Test-Path $pwshPath)) {
            Write-Error "PowerShell 7 installation failed. pwsh.exe not found."
            exit 1
        }
        Write-Host "PowerShell 7 installed successfully!"
    }
    $moduleName = "Microsoft.WinGet.Client"

    if (-not (Get-Module -ListAvailable -Name $moduleName)) {
        Write-Host "'$moduleName' not found. Installing..."
        # Install the WinGet module securely and silently for All Users
        Install-Module -Name $moduleName -Force -AcceptLicense -Scope AllUsers -AllowClobber
        Write-Host "WinGet module installed successfully!"
    }

    Import-Module $moduleName -ErrorAction Stop`;
      result = result.replace("    ## <Perform Pre-Installation tasks here>", preInstallTasks);
    }

    // Inject Installation tasks — only if not already injected
    if (result.includes("    ## <Perform Installation tasks here>") && !result.includes("Install-WinGetPackage")) {
      const installTasks = `    ## <Perform Installation tasks here>
    # ---------------------------------------------------------
    # DEFINE THE ACTUAL PAYLOAD (Independent of PS Version)
    # ---------------------------------------------------------
    $scriptPayload = {
        $moduleName = "Microsoft.WinGet.Client"
        Import-Module $moduleName -ErrorAction Stop
        $AppId = '__APPID__'
        try {
            Install-WinGetPackage -Id $AppId -Mode Silent -Force -Confirm -ErrorAction SilentlyContinue
            Write-Host "Successfully installed $AppId." -ForegroundColor Green
        }
        catch {
            Write-Host "Failed to install $AppId. Error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    # ---------------------------------------------------------
    # PS7 CHECK AND EXECUTION ROUTING
    # ---------------------------------------------------------
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        $pwshPath = "$env:ProgramW6432\\PowerShell\\7\\pwsh.exe"
        Write-Host "Running in PS5.1. Launching commands in PowerShell 7..."
        & $pwshPath -NoProfile -ExecutionPolicy Bypass -Command $scriptPayload
        if ( $LASTEXITCODE -eq 1 ) {
            Write-Output "Installation failed"
            exit 1
        }
        else {
            Write-Output "Installation successful"
        }
    }
    else {
        Write-Host "Already running in PowerShell 7. Executing payload..."
        & $scriptPayload
    }`;
      result = result.replace("    ## <Perform Installation tasks here>", installTasks);
    }

    // Inject Uninstallation tasks — only if not already injected
    if (result.includes("    ## <Perform Uninstallation tasks here>") && !result.includes("Uninstall-WinGetPackage")) {
      const uninstallTasks = `    ## <Perform Uninstallation tasks here>
    # ---------------------------------------------------------
    # DEFINE THE ACTUAL PAYLOAD (Independent of PS Version)
    # ---------------------------------------------------------
    $scriptPayload = {
        $moduleName = "Microsoft.WinGet.Client"
        Import-Module $moduleName -ErrorAction Stop
        $AppId = '__APPID__'
        try {
            Uninstall-WinGetPackage -Id $AppId -Force -Confirm -Mode Silent -ErrorAction Stop
            Write-Host "Successfully uninstalled $AppId." -ForegroundColor Green
        }
        catch {
            Write-Host "Failed to uninstall $AppId. Error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    # ---------------------------------------------------------
    # PS7 CHECK AND EXECUTION ROUTING
    # ---------------------------------------------------------
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        $pwshPath = "$env:ProgramW6432\\PowerShell\\7\\pwsh.exe"
        Write-Host "Running in PS5.1. Launching commands in PowerShell 7..."
        & $pwshPath -NoProfile -ExecutionPolicy Bypass -Command $scriptPayload
        if ( $LASTEXITCODE -eq 1 ) {
            Write-Output "Uninstallation failed"
            exit 1
        }
        else {
            Write-Output "Uninstallation successful"
        }
    }
    else {
        Write-Host "Already running in PowerShell 7. Executing payload..."
        & $scriptPayload
    }`;
      result = result.replace("    ## <Perform Uninstallation tasks here>", uninstallTasks);
    }

    return result;
  }

  // Function to setup PSADT automatically
  let psadtSetupPromise: Promise<void> | null = null;
  async function setupPsadt() {
    if (psadtSetupPromise) return psadtSetupPromise;
    
    psadtSetupPromise = (async () => {
      const psadtUrl = "https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/download/4.1.8/PSAppDeployToolkit_Template_v4.zip";
      const targetDir = path.join(process.cwd(), "src_packager", "PSADT");
      const zipPath = path.join(process.cwd(), "PSAppDeployToolkit_Template_v4.zip");
      const markerFile = path.join(targetDir, "Invoke-AppDeployToolkit.ps1");
      const psadtModuleDir = path.join(targetDir, "PSAppDeployToolkit");

      if (fs.existsSync(markerFile) && fs.existsSync(psadtModuleDir)) {
        console.log("PSADT already setup, skipping automatic download.");
        return;
      }

      try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        console.log("Automatically downloading PSADT 4.1.8...");
        await downloadFile(psadtUrl, zipPath);

        console.log("Extracting PSADT 4.1.8...");
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(targetDir, true);

        if (fs.existsSync(markerFile)) {
          const psadtContent = fs.readFileSync(markerFile, "utf-8");
          const injectedContent = injectPsadtScripts(psadtContent);
          fs.writeFileSync(markerFile, injectedContent, "utf-8");
          console.log("Injected scripts and placeholders into PSADT template.");
        }

        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        console.log("PSADT 4.1.8 automatic setup complete.");
      } catch (error) {
        console.error("PSADT automatic setup failed:", error);
        throw error; // Rethrow to handle in API
      } finally {
        psadtSetupPromise = null;
      }
    })();
    return psadtSetupPromise;
  }

  // Function to setup Icons automatically
  let iconsSetupPromise: Promise<void> | null = null;
  async function setupIcons() {
    if (iconsSetupPromise) return iconsSetupPromise;
    
    iconsSetupPromise = (async () => {
      const iconsUrl = "https://github.com/aaronparker/icons/archive/refs/heads/main.zip";
      const targetDir = path.join(process.cwd(), "src_packager", "icons");
      const zipPath = path.join(process.cwd(), "icons-main.zip");
      // GitHub zip usually extracts to a folder like {repo}-{branch}
      const markerFile = path.join(targetDir, "icons-main", "icons");

      if (fs.existsSync(markerFile)) {
        console.log("Icons repository already setup, skipping download.");
        return;
      }

      try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        console.log("Downloading Icons repository...");
        await downloadFile(iconsUrl, zipPath);

        console.log("Extracting Icons...");
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(targetDir, true);

        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        console.log("Icons repository setup complete.");
      } catch (error) {
        console.error("Icons setup failed:", error);
      } finally {
        iconsSetupPromise = null;
      }
    })();
    return iconsSetupPromise;
  }

  // API: Download and Setup PSADT 4.1.8
  app.post("/api/psadt/setup", async (req, res) => {
    try {
      await setupPsadt();
      res.json({ success: true, message: "PSADT 4.1.8 setup complete" });
    } catch (error) {
      res.status(500).json({ error: "Failed to setup PSADT 4.1.8: " + error.message });
    }
  });

  // API: Update PSADT Template
  app.post("/api/psadt/template", async (req, res) => {
    const { content } = req.body;
    const templatePath = path.join(process.cwd(), "src_packager", "PSADT", "Invoke-AppDeployToolkit.ps1");
    try {
      const injectedContent = injectPsadtScripts(content);
      await promisify(fs.writeFile)(templatePath, injectedContent, "utf-8");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save template" });
    }
  });

  // API: Open .ps1 in external editor
  app.post("/api/psadt/open-editor", async (req, res) => {
    const { editor, content } = req.body;
    const templatePath = path.join(process.cwd(), "src_packager", "PSADT", "Invoke-AppDeployToolkit.ps1");
    try {
      // Save current content before opening
      if (content) {
        fs.writeFileSync(templatePath, content, "utf-8");
      }
      const editors: Record<string, string> = {
        'vscode': `code "${templatePath}"`,
        'antigravity': `antigravity "${templatePath}"`,
        'ise': `powershell_ise.exe -File "${templatePath}"`
      };
      const cmd = editors[editor];
      if (!cmd) {
        return res.status(400).json({ error: "Unknown editor" });
      }
      exec(cmd, (error) => {
        if (error) {
          console.error(`Failed to open editor: ${error.message}`);
          return res.status(500).json({ error: `Failed to open ${editor}: ${error.message}` });
        }
        res.json({ success: true });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Reload .ps1 from disk (after external editing)
  app.get("/api/psadt/reload", async (req, res) => {
    const templatePath = path.join(process.cwd(), "src_packager", "PSADT", "Invoke-AppDeployToolkit.ps1");
    try {
      if (fs.existsSync(templatePath)) {
        let content = fs.readFileSync(templatePath, "utf-8");

        // Replace placeholders with current app values so the user sees real data
        const { appId, appName, publisher, version, scriptAuthor } = req.query;
        const escapePs = (val: string) => (val || '').replace(/'/g, "''");
        content = content
          .replace(/__APPID__/g, escapePs(String(appId || '')))
          .replace(/__APPNAME__/g, escapePs(String(appName || '')))
          .replace(/__APPVENDOR__/g, escapePs(String(publisher || '')))
          .replace(/__APPVERSION__/g, escapePs(String(version || '')))
          .replace(/__APPSCRIPTDATE__/g, new Date().toISOString().split('T')[0])
          .replace(/__APPSCRIPTAUTHOR__/g, escapePs(String(scriptAuthor || 'Automacanie')));

        res.json({ content });
      } else {
        res.status(404).json({ error: "Template file not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Wrap Application using IntuneWinAppUtil
  app.post("/api/wrap", async (req, res) => {
    const { appName, version } = req.body;
    try {
      const result = await wrapApp(appName, version);
      res.json({ 
        success: true, 
        message: `Successfully wrapped ${appName} v${version}`,
        output: result.stdout,
        fileName: result.fileName,
        fullPath: result.fullPath
      });
    } catch (error) {
      console.error("Wrapping failed:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // API: Download Icon to source folder
  app.post("/api/icon/download", async (req, res) => {
    const { url, appName } = req.body;
    if (!url && !appName) return res.status(400).json({ error: "URL or AppName is required" });

    const sourceFolder = path.join(process.cwd(), "src_packager", "PSADT");
    if (!fs.existsSync(sourceFolder)) fs.mkdirSync(sourceFolder, { recursive: true });

    const iconPath = path.join(sourceFolder, "AppIcon.png");
    
    try {
      // 1. Try to find in local icons repository first
      const localIconsDir = path.join(process.cwd(), "src_packager", "icons", "icons-main", "icons");
      if (fs.existsSync(localIconsDir)) {
        const possibleNames = [
          `${appName}.png`,
          `${appName.replace(/ /g, '%20')}.png`,
          `${appName.replace(/ /g, ' ')}.png`
        ];
        
        for (const name of possibleNames) {
          const localPath = path.join(localIconsDir, name);
          if (fs.existsSync(localPath)) {
            console.log(`Found local icon: ${localPath}`);
            fs.copyFileSync(localPath, iconPath);
            return res.json({ success: true, path: iconPath, method: 'local' });
          }
        }
      }

      // 2. Fallback to download if local not found or URL provided
      if (url) {
        console.log(`Downloading icon from ${url} to ${iconPath}`);
        await downloadFile(url, iconPath);
        return res.json({ success: true, path: iconPath, method: 'download' });
      }
      
      res.status(404).json({ error: "Icon not found locally and no URL provided" });
    } catch (error) {
      console.error("Icon download failed:", error);
      res.status(500).json({ error: "Failed to download icon: " + error.message });
    }
  });

  // API: List local icons
  app.get("/api/icons/list", async (req, res) => {
    const localIconsDir = path.join(process.cwd(), "src_packager", "icons", "icons-main", "Icons");
    try {
      if (fs.existsSync(localIconsDir)) {
        const files = await promisify(fs.readdir)(localIconsDir);
        const iconFiles = files.filter(f => f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.ico'));
        res.json(iconFiles);
      } else {
        res.json([]);
      }
    } catch (error) {
      console.error("Failed to list icons:", error);
      res.status(500).json({ error: "Failed to list icons" });
    }
  });

  // API: Download and Setup Icons repository
  app.post("/api/icons/setup", async (req, res) => {
    try {
      await setupIcons();
      res.json({ success: true, message: "Icons repository setup complete" });
    } catch (error) {
      res.status(500).json({ error: "Failed to setup Icons repository: " + error.message });
    }
  });

  // API: Fetch Intune app categories from tenant
  app.post("/api/intune/categories", async (req, res) => {
    const { azure } = req.body;
    if (!azure?.tenantId || !azure?.clientId || !azure?.clientSecret) {
      return res.status(400).json({ error: "Azure credentials are required." });
    }

    const psScript = `
$ErrorActionPreference = 'Stop'
if (-not (Get-Module -ListAvailable -Name IntuneWin32App)) {
    Install-Module -Name IntuneWin32App -Force -Scope CurrentUser -AllowClobber
}
if (-not (Get-Module -Name IntuneWin32App)) {
    Import-Module IntuneWin32App
}

$TID = $env:IMPORT_TENANT_ID
$CID = $env:IMPORT_CLIENT_ID
$Secret = $env:IMPORT_CLIENT_SECRET

try {
    $global:graphAuth = Connect-MSIntuneGraph -TenantID $TID -ClientID $CID -ClientSecret $Secret -ErrorAction Stop
} catch {
    $SecureSecret = ConvertTo-SecureString $Secret -AsPlainText -Force
    $global:graphAuth = Connect-MSIntuneGraph -TenantID $TID -ClientID $CID -ClientSecret $SecureSecret -ErrorAction Stop
}

$authToken = $global:graphAuth.Authorization
if (-not $authToken) {
    if ($global:authToken) { $authToken = $global:authToken }
    elseif ($global:MSGraphToken) { $authToken = $global:MSGraphToken }
}

$catRes = Invoke-RestMethod -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileAppCategories" -Method GET -Headers @{Authorization = $authToken}
$catRes.value | Select-Object id, displayName | ConvertTo-Json -Compress
`;

    const scriptPath = path.join(process.cwd(), "temp_categories.ps1");
    fs.writeFileSync(scriptPath, psScript, "utf-8");

    try {
      const result = await execAsync(`pwsh -File "${scriptPath}"`, {
        env: {
          ...process.env,
          IMPORT_TENANT_ID: azure.tenantId,
          IMPORT_CLIENT_ID: azure.clientId,
          IMPORT_CLIENT_SECRET: azure.clientSecret
        }
      });
      const categories = JSON.parse(result.stdout.trim() || '[]');
      res.json(Array.isArray(categories) ? categories : [categories]);
    } catch (error: any) {
      console.error("Failed to fetch categories:", error.message);
      res.status(500).json({ error: error.message });
    } finally {
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    }
  });

  // API: Full Import to Intune (Real backend call using IntuneWin32App module)
  app.post("/api/intune/import", async (req, res) => {
    const { appName, appId, version, publisher, category, description, iconUrl, azure, installCommand, uninstallCommand, developer, owner, notes, informationUrl, privacyUrl, minOS, maxInstallationTime, allowAvailableUninstall, installBehavior, deviceRestartBehavior, showWelcome = true, showProgress = true, checkArchitecture = false, architectures = [], scriptAuthor = '', scriptContent = '' } = req.body;
    
    try {
      console.log(`Starting Intune import for ${appName} v${version}...`);
      console.log(`Script content received: ${scriptContent ? `${scriptContent.length} chars` : 'NONE (will rebuild from template)'}`);

      // 1. Write the user's edited script content to the PSADT template
      const templatePath = path.join(process.cwd(), "src_packager", "PSADT", "Invoke-AppDeployToolkit.ps1");
      if (!fs.existsSync(templatePath)) {
        throw new Error("PSADT template not found. Please run Setup PSADT first.");
      }

      const escapePs = (val: string) => (val || '').replace(/'/g, "''");
      // Save the original template so we can restore it after wrapping
      const originalTemplateOnDisk = fs.readFileSync(templatePath, "utf-8");
      let finalTemplate: string;
      if (scriptContent) {
        // Use the user's edited script directly — all manual changes are preserved
        // Replace the default script author with the user's configured value
        finalTemplate = scriptContent;
        if (scriptAuthor) {
          finalTemplate = finalTemplate.replace(/AppScriptAuthor = '[^']*'/, `AppScriptAuthor = '${escapePs(scriptAuthor)}'`);
        }
      } else {
        // Fallback: rebuild from template on disk (legacy behavior)
        const rawTemplate = fs.readFileSync(templatePath, "utf-8");
        const originalTemplate = injectPsadtScripts(rawTemplate);
        finalTemplate = originalTemplate
          .replace(/__APPID__/g, escapePs(appId))
          .replace(/__APPNAME__/g, escapePs(appName))
          .replace(/__APPVENDOR__/g, escapePs(publisher))
          .replace(/__APPVERSION__/g, escapePs(version))
          .replace(/__APPSCRIPTDATE__/g, new Date().toISOString().split('T')[0])
          .replace(/__APPSCRIPTAUTHOR__/g, escapePs(scriptAuthor || 'Automacanie'));

        if (!showWelcome) {
          finalTemplate = finalTemplate.replace(/^(\s*)Show-ADTInstallationWelcome\b/gm, '$1#Show-ADTInstallationWelcome');
        }
        if (!showProgress) {
          finalTemplate = finalTemplate.replace(/^(\s*)Show-ADTInstallationProgress\b/gm, '$1#Show-ADTInstallationProgress');
        }
      }
      fs.writeFileSync(templatePath, finalTemplate, "utf-8");
      console.log(`Replaced all placeholders with app data for '${appName}' in PSADT template.`);

      // Copy PSADT folder to PSADT_<appId> as a backup before wrapping
      const psadtFolder = path.join(process.cwd(), "src_packager", "PSADT");
      const safeAppId = (appId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
      const backupFolder = path.join(process.cwd(), "src_packager", `PSADT_${safeAppId}`);
      try {
        if (fs.existsSync(backupFolder)) {
          fs.rmSync(backupFolder, { recursive: true });
        }
        fs.cpSync(psadtFolder, backupFolder, { recursive: true });
        console.log(`Copied PSADT folder to ${backupFolder}`);
      } catch (copyErr: any) {
        console.warn(`Failed to copy PSADT folder: ${copyErr.message}`);
      }

      // 2. Run actual wrapping, then restore original template (with __APPID__ placeholder)
      let wrapResult;
      try {
        wrapResult = await wrapApp(appName, version);
        console.log("Wrapping successful for import process.");
      } finally {
        // Always restore the original template, even on failure
        fs.writeFileSync(templatePath, originalTemplateOnDisk, "utf-8");
        console.log("Restored original PSADT template after wrapping.");
      }

      // 2. Resolve icon path if it's a local icon
      let localIconPath: string | undefined;
      if (iconUrl && iconUrl.startsWith('/icons/')) {
        const iconName = iconUrl.replace('/icons/', '');
        localIconPath = path.join(process.cwd(), "src_packager", "icons", "icons-main", "icons", iconName);
      } else if (iconUrl && iconUrl.startsWith('http')) {
        // If it's a remote URL, we already downloaded it to PSADT folder in /api/icon/download
        // But for Intune import, we might want to point to the specific file
        localIconPath = path.join(process.cwd(), "src_packager", "PSADT", "AppIcon.png");
      }

      // 3. Perform real import using IntuneWin32App module
      const importOutput = await importToIntune({
        filePath: wrapResult.fullPath,
        appName,
        appId,
        version,
        publisher,
        description,
        category,
        iconPath: localIconPath,
        installCommand,
        uninstallCommand,
        developer,
        owner,
        notes,
        informationUrl,
        privacyUrl,
        minOS,
        maxInstallationTime,
        allowAvailableUninstall,
        installBehavior,
        deviceRestartBehavior,
        checkArchitecture,
        architectures,
        credentials: azure || {}
      });

      // 4. Ensure output directory exists for manifest
      const outputFolder = path.join(process.cwd(), "output");
      if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

      // 5. Create an import manifest for record keeping
      const manifest = {
        displayName: appName,
        description: description,
        publisher: publisher,
        developer: publisher,
        version: version,
        category: category,
        iconUrl: iconUrl,
        intunewinFileName: wrapResult.fileName,
        importTime: new Date().toISOString(),
        status: "Imported via IntuneWin32App",
        psOutput: importOutput
      };

      const manifestPath = path.join(outputFolder, `${appName}_import_manifest.json`);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      res.json({ 
        success: true, 
        message: `Successfully imported ${appName} to Intune using IntuneWin32App module.`,
        manifestPath,
        intunewin: wrapResult.fileName,
        output: importOutput
      });
    } catch (error) {
      console.error("Intune import failed:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API: Get PSADT Template
  app.get("/api/psadt/template", async (req, res) => {
    const templatePath = path.join(process.cwd(), "src_packager", "PSADT", "Invoke-AppDeployToolkit.ps1");
    try {
      if (fs.existsSync(templatePath)) {
        const rawContent = await readFileAsync(templatePath, "utf-8");
        let injectedContent = injectPsadtScripts(rawContent);

        // Replace placeholders with actual app data if provided via query params
        const { appId, appName, publisher, version, scriptAuthor: qScriptAuthor } = req.query;
        if (appId || appName || publisher || version) {
          const escapePs = (val: string) => (val || '').replace(/'/g, "''");
          injectedContent = injectedContent
            .replace(/__APPID__/g, escapePs(String(appId || '')))
            .replace(/__APPNAME__/g, escapePs(String(appName || '')))
            .replace(/__APPVENDOR__/g, escapePs(String(publisher || '')))
            .replace(/__APPVERSION__/g, escapePs(String(version || '')))
            .replace(/__APPSCRIPTDATE__/g, new Date().toISOString().split('T')[0])
            .replace(/__APPSCRIPTAUTHOR__/g, escapePs(String(qScriptAuthor || 'Automacanie')));
        }

        res.json({ content: injectedContent });
      } else {
        res.status(404).json({ error: "Template not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to read template" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Trigger automatic setup on startup
    setupPsadt();
    setupIcons();
  });
}

startServer();
