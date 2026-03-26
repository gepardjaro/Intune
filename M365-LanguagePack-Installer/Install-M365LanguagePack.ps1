<#
.SYNOPSIS
    Microsoft 365 Language Pack Installer with WPF UI.
.DESCRIPTION
    Self-contained script that shows a professional WPF dialog for selecting
    M365 language packs, generates ODT XML configuration, and installs them.
    Designed to be called from PSADT 4.1.5 with a single line:
        & "$dirFiles\Install-M365LanguagePack.ps1"
.NOTES
    Requires: ODT setup.exe in the same directory as this script.
    Exit Codes:
        0    = Success
        1    = Prerequisites not met (M365 not installed, setup.exe missing)
        1602 = User cancelled
        Other = ODT setup.exe exit code
#>

#region ── Configuration ──────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'

$Script:LogFile = Join-Path $env:TEMP "M365LanguagePack_Install_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $entry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Message"
    Add-Content -Path $Script:LogFile -Value $entry -Force
    Write-Host $entry
}

# Language definitions: locale code → friendly name
$Script:Languages = [ordered]@{
    'af-za'       = 'Afrikaans'
    'ar-sa'       = 'Arabic'
    'bg-bg'       = 'Bulgarian'
    'ca-es'       = 'Catalan'
    'cs-cz'       = 'Czech'
    'cy-gb'       = 'Welsh'
    'da-dk'       = 'Danish'
    'de-de'       = 'German'
    'el-gr'       = 'Greek'
    'en-us'       = 'English (US)'
    'es-es'       = 'Spanish'
    'et-ee'       = 'Estonian'
    'eu-es'       = 'Basque'
    'fi-fi'       = 'Finnish'
    'fr-fr'       = 'French'
    'ga-ie'       = 'Irish'
    'gl-es'       = 'Galician'
    'he-il'       = 'Hebrew'
    'hi-in'       = 'Hindi'
    'hr-hr'       = 'Croatian'
    'hu-hu'       = 'Hungarian'
    'id-id'       = 'Indonesian'
    'it-it'       = 'Italian'
    'ja-jp'       = 'Japanese'
    'kk-kz'       = 'Kazakh'
    'ko-kr'       = 'Korean'
    'lt-lt'       = 'Lithuanian'
    'lv-lv'       = 'Latvian'
    'mk-mk'      = 'Macedonian'
    'ms-my'       = 'Malay'
    'mt-mt'       = 'Maltese'
    'nb-no'       = 'Norwegian Bokmål'
    'nl-nl'       = 'Dutch'
    'nn-no'       = 'Norwegian Nynorsk'
    'pl-pl'       = 'Polish'
    'pt-br'       = 'Portuguese (Brazil)'
    'pt-pt'       = 'Portuguese (Portugal)'
    'ro-ro'       = 'Romanian'
    'ru-ru'       = 'Russian'
    'sk-sk'       = 'Slovak'
    'sl-si'       = 'Slovenian'
    'sq-al'       = 'Albanian'
    'sr-latn-rs'  = 'Serbian (Latin)'
    'sv-se'       = 'Swedish'
    'th-th'       = 'Thai'
    'tr-tr'       = 'Turkish'
    'uk-ua'       = 'Ukrainian'
    'vi-vn'       = 'Vietnamese'
    'zh-cn'       = 'Chinese (Simplified)'
    'zh-tw'       = 'Chinese (Traditional)'
}
#endregion

#region ── Prerequisites ──────────────────────────────────────────────────────
Write-Log 'Starting M365 Language Pack Installer'

# Check M365 installation
$c2rPath = 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
if (-not (Test-Path $c2rPath)) {
    $msg = 'Microsoft 365 Apps is not installed on this device.'
    Write-Log $msg 'ERROR'
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'M365 Language Pack Installer', 'OK', 'Error') | Out-Null
    exit 1
}

# Locate setup.exe
$setupExe = Join-Path $PSScriptRoot 'setup.exe'
if (-not (Test-Path $setupExe)) {
    $msg = "ODT setup.exe not found at: $setupExe`nPlace the Office Deployment Tool setup.exe in the same folder as this script."
    Write-Log $msg 'ERROR'
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($msg, 'M365 Language Pack Installer', 'OK', 'Error') | Out-Null
    exit 1
}
Write-Log "ODT setup.exe found: $setupExe"
#endregion

#region ── Detect Channel & Installed Languages ───────────────────────────────
$c2rConfig = Get-ItemProperty -Path $c2rPath -ErrorAction SilentlyContinue
$cdnUrl    = $c2rConfig.CDNBaseUrl

# Map CDN URL to channel name
$channelMap = @{
    '492350f6' = 'Current'
    '55336b82' = 'MonthlyEnterprise'
    '7ffbc6bf' = 'SemiAnnualPreview'
    '64256afe' = 'SemiAnnual'
    'b8f9b850' = 'BetaChannel'
    'ea4a2db7' = 'CurrentPreview'
}
$detectedChannel = 'Current'
foreach ($key in $channelMap.Keys) {
    if ($cdnUrl -and $cdnUrl -like "*$key*") {
        $detectedChannel = $channelMap[$key]
        break
    }
}
Write-Log "Detected M365 channel: $detectedChannel (CDN: $cdnUrl)"

# Get installed languages
$installedLangs = @()
$langConfig = $c2rConfig.'language packs'
if (-not $langConfig) {
    $langConfig = $c2rConfig.ClientCulture
}
if ($langConfig) {
    $installedLangs = $langConfig -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ }
}
# Also check the culture property
if ($c2rConfig.ClientCulture) {
    $clientCulture = $c2rConfig.ClientCulture.Trim().ToLower()
    if ($clientCulture -and $installedLangs -notcontains $clientCulture) {
        $installedLangs += $clientCulture
    }
}
Write-Log "Already installed languages: $($installedLangs -join ', ')"
#endregion

#region ── WPF Language Selection UI ──────────────────────────────────────────
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Microsoft 365 — Language Pack Installer"
        Width="540" Height="680"
        WindowStartupLocation="CenterScreen"
        ResizeMode="CanResizeWithGrip"
        Background="#F3F3F3"
        FontFamily="Segoe UI" FontSize="13">
    <Window.Resources>
        <Style x:Key="AccentButton" TargetType="Button">
            <Setter Property="Background" Value="#0078D4"/>
            <Setter Property="Foreground" Value="White"/>
            <Setter Property="FontSize" Value="13"/>
            <Setter Property="FontWeight" Value="SemiBold"/>
            <Setter Property="Padding" Value="20,8"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="border" Background="{TemplateBinding Background}"
                                CornerRadius="4" Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="border" Property="Background" Value="#106EBE"/>
                            </Trigger>
                            <Trigger Property="IsPressed" Value="True">
                                <Setter TargetName="border" Property="Background" Value="#005A9E"/>
                            </Trigger>
                            <Trigger Property="IsEnabled" Value="False">
                                <Setter TargetName="border" Property="Background" Value="#CCCCCC"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
        <Style x:Key="LinkButton" TargetType="Button">
            <Setter Property="Background" Value="Transparent"/>
            <Setter Property="Foreground" Value="#0078D4"/>
            <Setter Property="FontSize" Value="12"/>
            <Setter Property="Padding" Value="8,4"/>
            <Setter Property="BorderThickness" Value="0"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="Transparent" Padding="{TemplateBinding Padding}">
                            <TextBlock Text="{TemplateBinding Content}"
                                       Foreground="{TemplateBinding Foreground}"
                                       TextDecorations="Underline"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
        <Style x:Key="CancelButton" TargetType="Button">
            <Setter Property="Background" Value="#FFFFFF"/>
            <Setter Property="Foreground" Value="#323130"/>
            <Setter Property="FontSize" Value="13"/>
            <Setter Property="Padding" Value="20,8"/>
            <Setter Property="BorderBrush" Value="#8A8886"/>
            <Setter Property="BorderThickness" Value="1"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border x:Name="border" Background="{TemplateBinding Background}"
                                BorderBrush="{TemplateBinding BorderBrush}"
                                BorderThickness="{TemplateBinding BorderThickness}"
                                CornerRadius="4" Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsMouseOver" Value="True">
                                <Setter TargetName="border" Property="Background" Value="#F3F2F1"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>

    <Grid Margin="0">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- Header -->
        <Border Grid.Row="0" Background="#0078D4" Padding="20,16">
            <StackPanel>
                <TextBlock Text="Microsoft 365" Foreground="White" FontSize="22" FontWeight="Light"/>
                <TextBlock Text="Language Pack Installer" Foreground="#CCE4F7" FontSize="13" Margin="0,2,0,0"/>
            </StackPanel>
        </Border>

        <!-- Info Panel -->
        <Border Grid.Row="1" Background="#EBF3FB" Padding="16,10" BorderBrush="#B3D7F2" BorderThickness="0,0,0,1">
            <StackPanel>
                <TextBlock Name="txtChannel" Text="Update Channel: —" FontSize="12" Foreground="#323130"/>
                <TextBlock Name="txtInstalled" Text="Installed Languages: —" FontSize="12" Foreground="#605E5C" Margin="0,2,0,0"/>
            </StackPanel>
        </Border>

        <!-- Search Box -->
        <Border Grid.Row="2" Margin="16,12,16,0" BorderBrush="#8A8886" BorderThickness="1" CornerRadius="4" Background="White">
            <Grid>
                <TextBlock Name="txtSearchPlaceholder" Text="&#x1F50D; Search languages..."
                           Foreground="#A19F9D" Margin="10,8" IsHitTestVisible="False"/>
                <TextBox Name="txtSearch" Background="Transparent" BorderThickness="0"
                         Padding="8,6" FontSize="13" VerticalContentAlignment="Center"/>
            </Grid>
        </Border>

        <!-- Select All / Deselect All -->
        <StackPanel Grid.Row="3" Orientation="Horizontal" Margin="16,8,16,4">
            <Button Name="btnSelectAll" Content="Select All" Style="{StaticResource LinkButton}"/>
            <TextBlock Text=" | " Foreground="#A19F9D" VerticalAlignment="Center"/>
            <Button Name="btnDeselectAll" Content="Deselect All" Style="{StaticResource LinkButton}"/>
            <TextBlock Name="txtSelectedCount" Text="  (0 selected)" Foreground="#605E5C"
                       VerticalAlignment="Center" FontSize="12" Margin="8,0,0,0"/>
        </StackPanel>

        <!-- Language List -->
        <Border Grid.Row="4" Margin="16,0,16,0" BorderBrush="#E1DFDD" BorderThickness="1"
                CornerRadius="4" Background="White">
            <ScrollViewer VerticalScrollBarVisibility="Auto" Padding="4">
                <StackPanel Name="pnlLanguages"/>
            </ScrollViewer>
        </Border>

        <!-- Status Bar -->
        <TextBlock Grid.Row="5" Name="txtStatus" Text="" FontSize="11"
                   Foreground="#A4262C" Margin="16,6,16,0" TextWrapping="Wrap"/>

        <!-- Buttons -->
        <StackPanel Grid.Row="6" Orientation="Horizontal" HorizontalAlignment="Right" Margin="16,12,16,16">
            <Button Name="btnCancel" Content="Cancel" Style="{StaticResource CancelButton}" Margin="0,0,8,0"/>
            <Button Name="btnInstall" Content="Install Selected" Style="{StaticResource AccentButton}" IsEnabled="False"/>
        </StackPanel>
    </Grid>
</Window>
"@

# Parse XAML
$window = [System.Windows.Markup.XamlReader]::Parse($xaml)

# Find controls
$txtChannel       = $window.FindName('txtChannel')
$txtInstalled     = $window.FindName('txtInstalled')
$txtSearch         = $window.FindName('txtSearch')
$txtSearchPlaceholder = $window.FindName('txtSearchPlaceholder')
$btnSelectAll     = $window.FindName('btnSelectAll')
$btnDeselectAll   = $window.FindName('btnDeselectAll')
$txtSelectedCount = $window.FindName('txtSelectedCount')
$pnlLanguages     = $window.FindName('pnlLanguages')
$txtStatus        = $window.FindName('txtStatus')
$btnCancel        = $window.FindName('btnCancel')
$btnInstall       = $window.FindName('btnInstall')

# Populate info
$channelDisplay = $detectedChannel -creplace '([a-z])([A-Z])', '$1 $2'
$txtChannel.Text  = "Update Channel: $channelDisplay"
$txtInstalled.Text = "Installed Languages: $($installedLangs.Count) ($($installedLangs -join ', '))"

# Track checkboxes
$Script:Checkboxes = @{}
$Script:UserCancelled = $true

# Build language checkboxes
foreach ($locale in $Script:Languages.Keys) {
    $friendlyName = $Script:Languages[$locale]
    $isInstalled  = $installedLangs -contains $locale

    $cb = New-Object System.Windows.Controls.CheckBox
    $cb.Margin  = [System.Windows.Thickness]::new(8, 4, 8, 4)
    $cb.Tag     = $locale
    $cb.FontSize = 13

    if ($isInstalled) {
        $cb.Content   = "$friendlyName ($locale) — Installed"
        $cb.IsChecked = $true
        $cb.IsEnabled = $false
        $cb.Foreground = [System.Windows.Media.Brushes]::Gray
    }
    else {
        $cb.Content = "$friendlyName ($locale)"
    }

    # Update selected count on check/uncheck
    $cb.Add_Checked({
        $count = ($Script:Checkboxes.Values | Where-Object { $_.IsEnabled -and $_.IsChecked }) | Measure-Object | Select-Object -ExpandProperty Count
        $txtSelectedCount.Text = "  ($count selected)"
        $btnInstall.IsEnabled = ($count -gt 0)
    })
    $cb.Add_Unchecked({
        $count = ($Script:Checkboxes.Values | Where-Object { $_.IsEnabled -and $_.IsChecked }) | Measure-Object | Select-Object -ExpandProperty Count
        $txtSelectedCount.Text = "  ($count selected)"
        $btnInstall.IsEnabled = ($count -gt 0)
    })

    $pnlLanguages.Children.Add($cb) | Out-Null
    $Script:Checkboxes[$locale] = $cb
}

# Search/filter
$txtSearch.Add_TextChanged({
    $filter = $txtSearch.Text.Trim().ToLower()
    $txtSearchPlaceholder.Visibility = if ($filter) { 'Collapsed' } else { 'Visible' }
    foreach ($locale in $Script:Checkboxes.Keys) {
        $cb = $Script:Checkboxes[$locale]
        $name = $Script:Languages[$locale].ToLower()
        if (-not $filter -or $name -like "*$filter*" -or $locale -like "*$filter*") {
            $cb.Visibility = 'Visible'
        }
        else {
            $cb.Visibility = 'Collapsed'
        }
    }
})

# Select All (only enabled/visible)
$btnSelectAll.Add_Click({
    foreach ($cb in $Script:Checkboxes.Values) {
        if ($cb.IsEnabled -and $cb.Visibility -eq 'Visible') {
            $cb.IsChecked = $true
        }
    }
})

# Deselect All (only enabled)
$btnDeselectAll.Add_Click({
    foreach ($cb in $Script:Checkboxes.Values) {
        if ($cb.IsEnabled) {
            $cb.IsChecked = $false
        }
    }
})

# Cancel
$btnCancel.Add_Click({
    $Script:UserCancelled = $true
    $window.Close()
})

# Install
$btnInstall.Add_Click({
    $Script:UserCancelled = $false
    $window.Close()
})

# Show dialog
Write-Log 'Showing language selection UI'
$window.ShowDialog() | Out-Null

if ($Script:UserCancelled) {
    Write-Log 'User cancelled language selection' 'WARN'
    exit 1602
}
#endregion

#region ── Collect Selections & Generate XML ──────────────────────────────────
$selectedLocales = @()
foreach ($locale in $Script:Checkboxes.Keys) {
    $cb = $Script:Checkboxes[$locale]
    if ($cb.IsEnabled -and $cb.IsChecked) {
        $selectedLocales += $locale
    }
}

if ($selectedLocales.Count -eq 0) {
    Write-Log 'No new languages selected' 'WARN'
    [System.Windows.MessageBox]::Show(
        'No new languages were selected for installation.',
        'M365 Language Pack Installer', 'OK', 'Information'
    ) | Out-Null
    exit 0
}

Write-Log "Selected languages for installation: $($selectedLocales -join ', ')"

# Build ODT XML
$langElements = ($selectedLocales | ForEach-Object { "      <Language ID=`"$_`" />" }) -join "`n"

$xmlContent = @"
<Configuration>
  <Add Channel="$detectedChannel">
    <Product ID="LanguagePack">
$langElements
    </Product>
  </Add>
  <Display Level="None" AcceptEULA="TRUE" />
</Configuration>
"@

$xmlPath = Join-Path $env:TEMP "M365LangPack_config_$(Get-Date -Format 'yyyyMMddHHmmss').xml"
$xmlContent | Out-File -FilePath $xmlPath -Encoding UTF8 -Force
Write-Log "Generated ODT XML config: $xmlPath"
Write-Log "XML content:`n$xmlContent"
#endregion

#region ── Install Language Packs ─────────────────────────────────────────────
Write-Log "Starting ODT setup.exe /configure `"$xmlPath`""

try {
    $process = Start-Process -FilePath $setupExe -ArgumentList "/configure `"$xmlPath`"" `
        -Wait -PassThru -WindowStyle Hidden
    $exitCode = $process.ExitCode
    Write-Log "ODT setup.exe completed with exit code: $exitCode"
}
catch {
    Write-Log "Failed to run ODT setup.exe: $_" 'ERROR'
    $exitCode = 1
}
finally {
    # Clean up temp XML
    if (Test-Path $xmlPath) {
        Remove-Item -Path $xmlPath -Force -ErrorAction SilentlyContinue
        Write-Log 'Cleaned up temporary XML config'
    }
}

if ($exitCode -eq 0) {
    # Write marker registry key for detection
    $regPath = 'HKLM:\SOFTWARE\M365LanguagePacks'
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }

    # Append newly installed languages to any previously recorded ones
    $existingLangs = @()
    $prevValue = (Get-ItemProperty -Path $regPath -Name 'InstalledLanguages' -ErrorAction SilentlyContinue).InstalledLanguages
    if ($prevValue) {
        $existingLangs = $prevValue -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }
    $allLangs = ($existingLangs + $selectedLocales) | Sort-Object -Unique
    Set-ItemProperty -Path $regPath -Name 'InstalledLanguages' -Value ($allLangs -join ',') -Force
    Set-ItemProperty -Path $regPath -Name 'LastInstallDate' -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Force
    Set-ItemProperty -Path $regPath -Name 'LastInstallLog' -Value $Script:LogFile -Force

    Write-Log "Successfully installed language packs: $($selectedLocales -join ', ')"
    Write-Log "Registry marker written to $regPath"
}
else {
    Write-Log "Language pack installation failed with exit code $exitCode" 'ERROR'
}

exit $exitCode
#endregion
