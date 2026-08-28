[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateRange(1, 150)]
    [int] $BitrateMbps = 40,
    [switch] $EnableAutoAdjust,
    [switch] $Show
)

<#
.SYNOPSIS
  Mostra o imposta il bitrate richiesto dal client Moonlight per l'utente Windows corrente.

.DESCRIPTION
  Moonlight salva il valore in kilobit al secondo nel proprio profilo QSettings
  (registro HKCU). Per default questo script richiede 40 Mbps fissi; il valore
  viene negoziato al prossimo stream. Non misura il traffico reale sulla rete e
  non modifica Sunshine, Proxmox o la GPU.

.EXAMPLE
  .\moonlight-windows-settings.ps1 -Show
  .\moonlight-windows-settings.ps1 -BitrateMbps 40
  .\moonlight-windows-settings.ps1 -BitrateMbps 40 -EnableAutoAdjust
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$key = 'HKCU:\Software\Moonlight Game Streaming Project\Moonlight'
if (-not (Test-Path -LiteralPath $key)) {
    throw 'Il profilo Moonlight dell''utente corrente non esiste: avvia Moonlight almeno una volta.'
}

function Show-MoonlightSettings {
    $settings = Get-ItemProperty -LiteralPath $key
    [pscustomobject]@{
        Resolution       = "$($settings.width)x$($settings.height)"
        FPS              = $settings.fps
        RequestedMbps    = [math]::Round($settings.bitrate / 1000, 2)
        AutoAdjust       = [bool]$settings.autoadjustbitrate
        VSync            = [bool]$settings.vsync
        HDR              = [bool]$settings.hdr
        Yuv444           = [bool]$settings.yuv444
        AppliesOn        = 'Nuova connessione Moonlight dopo chiusura e riapertura del client'
    }
}

if ($Show) {
    Show-MoonlightSettings | Format-List
    exit 0
}

$targetKbps = $BitrateMbps * 1000
if ($PSCmdlet.ShouldProcess('Profilo Moonlight dell''utente corrente', "richiedere $BitrateMbps Mbps")) {
    Set-ItemProperty -LiteralPath $key -Name bitrate -Type DWord -Value $targetKbps
    Set-ItemProperty -LiteralPath $key -Name autoadjustbitrate -Type DWord -Value ([int]$EnableAutoAdjust)
}

Show-MoonlightSettings | Format-List
Write-Host 'Chiudi completamente Moonlight e riaprilo prima del prossimo stream.' -ForegroundColor Yellow
