#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('All', 'Microphone', 'Moonlight', 'KdeConnect', 'Show')]
    [string] $Module = 'All',
    [string] $ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\omarchy.env'),
    [switch] $InstallKey,
    [switch] $ConfigureKdeFirewall,
    [switch] $CloseMoonlight
)

<#
.SYNOPSIS
  Configura in modo riproducibile un PC Windows che usa Omarchy via Moonlight.

.DESCRIPTION
  Legge config\omarchy.env, che non e' versionato. Il modulo Microphone
  registra una chiave SSH ristretta (solo con -InstallKey) e crea il launcher
  Startup; Moonlight e KDE Connect restano moduli separati e opzionali.
  Lo script non contiene IP, password o nomi di dispositivo fissi.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-OmarchyConfig {
    param([Parameter(Mandatory)] [string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Configurazione mancante: $Path. Copia config\omarchy.env.example in config\omarchy.env e compilalo."
    }
    $values = @{}
    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') {
            throw "Riga non valida in ${Path}: $rawLine"
        }
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$Matches[1]] = $value
    }
    return $values
}

function Require-Setting {
    param([Parameter(Mandatory)] [hashtable] $Settings, [Parameter(Mandatory)] [string] $Name)
    if (-not $Settings.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace($Settings[$Name])) {
        throw "$Name mancante in $ConfigPath"
    }
    return [string]$Settings[$Name]
}

$settings = Read-OmarchyConfig -Path $ConfigPath
$vmAddress = Require-Setting -Settings $settings -Name 'OMARCHY_VM_ADDRESS'
$vmHost = Require-Setting -Settings $settings -Name 'OMARCHY_VM_HOST'
$user = Require-Setting -Settings $settings -Name 'OMARCHY_USER'
$port = [int](Require-Setting -Settings $settings -Name 'OMARCHY_RTP_PORT')
$device = Require-Setting -Settings $settings -Name 'OMARCHY_MIC_DEVICE'
$clientAddress = Require-Setting -Settings $settings -Name 'OMARCHY_CLIENT_ADDRESS'
if ($port -lt 1024 -or $port -gt 65535) { throw 'OMARCHY_RTP_PORT deve essere 1024-65535.' }

$microphone = Join-Path $PSScriptRoot 'voxtype-windows-mic-rtp.ps1'
$moonlight = Join-Path $PSScriptRoot 'moonlight-windows-settings.ps1'
$kdeConnect = Join-Path $PSScriptRoot 'kde-connect-windows-setup.ps1'

if ($Module -eq 'Show') {
    [pscustomobject]@{
        ConfigPath       = (Resolve-Path -LiteralPath $ConfigPath).Path
        VmHost           = $vmHost
        VmAddress        = $vmAddress
        ClientAddress    = $clientAddress
        RtpPort          = $port
        Microphone       = $device
        StartupLauncher  = (Join-Path ([Environment]::GetFolderPath('Startup')) 'Omarchy VoxType realtime microphone.cmd')
    } | Format-List
    exit 0
}

function Install-Microphone {
    if ($InstallKey) {
        & $microphone -InstallKey -VmHost $vmHost -User $user
    }
    & $microphone -InstallAutostart -VmAddress $vmAddress -VmHost $vmHost `
        -User $user -RtpPort $port -Device $device
}

function Install-Moonlight {
    if (-not (Test-Path -LiteralPath 'HKCU:\Software\Moonlight Game Streaming Project\Moonlight')) {
        Write-Warning 'Moonlight e installato ma non ancora inizializzato: aprilo una volta. Le preferenze verranno lasciate ai valori predefiniti.'
        return
    }
    if (-not $CloseMoonlight -and (Get-Process -Name Moonlight -ErrorAction SilentlyContinue)) {
        Write-Warning 'Moonlight e aperto: non forzo la chiusura di uno stream attivo. Salto solo le preferenze; microfono e chiave continuano a essere configurati.'
        return
    }
    if ($CloseMoonlight) { & $moonlight -CloseMoonlight }
    else { & $moonlight }
}

function Install-KdeConnect {
    if ($ConfigureKdeFirewall) { & $kdeConnect -ConfigureFirewall -PeerAddress $vmAddress }
    else { & $kdeConnect }
}

switch ($Module) {
    'Microphone' { Install-Microphone }
    'Moonlight' { Install-Moonlight }
    'KdeConnect' { Install-KdeConnect }
    'All' {
        Install-Moonlight
        Install-Microphone
        if ($ConfigureKdeFirewall) { Install-KdeConnect }
    }
}

Write-Host "Configurazione Windows completata: $Module" -ForegroundColor Green
