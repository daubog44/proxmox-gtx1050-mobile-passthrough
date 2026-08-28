[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('MoonlightDefault', 'Fixed')]
    [string] $Mode = 'MoonlightDefault',
    [ValidateRange(1, 150)]
    [Nullable[int]] $BitrateMbps,
    [switch] $Show
)

<#
.SYNOPSIS
  Mostra o imposta il bitrate richiesto dal client Moonlight per l'utente Windows corrente.

.DESCRIPTION
  Moonlight salva il valore in kilobit al secondo nel profilo QSettings (registro HKCU).
  MoonlightDefault ricrea il calcolo predefinito di Moonlight per risoluzione, FPS e YUV 4:4:4
  correnti e riabilita autoadjustbitrate. Fixed conserva invece un valore scelto manualmente.

  "autoadjustbitrate" non reagisce al jitter di rete frame per frame: il client lo usa per
  aggiornare il valore predefinito quando l'utente cambia risoluzione o FPS. Il bitrate rimane
  comunque una richiesta al server, non una misura esatta dei byte passati sulla rete.

.EXAMPLE
  .\moonlight-windows-settings.ps1 -Show
  .\moonlight-windows-settings.ps1
  .\moonlight-windows-settings.ps1 -Mode Fixed -BitrateMbps 40
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$key = 'HKCU:\Software\Moonlight Game Streaming Project\Moonlight'
if (-not (Test-Path -LiteralPath $key)) {
    throw 'Il profilo Moonlight dell''utente corrente non esiste: avvia Moonlight almeno una volta.'
}

function Get-MoonlightDefaultBitrateKbps {
    param(
        [Parameter(Mandatory)] [int] $Width,
        [Parameter(Mandatory)] [int] $Height,
        [Parameter(Mandatory)] [int] $Fps,
        [Parameter(Mandatory)] [bool] $Yuv444
    )

    # Stessa tabella e stessa interpolazione di StreamingPreferences::getDefaultBitrate().
    $table = @(
        @{ Pixels = 640 * 360; Factor = 1 },
        @{ Pixels = 854 * 480; Factor = 2 },
        @{ Pixels = 1280 * 720; Factor = 5 },
        @{ Pixels = 1920 * 1080; Factor = 10 },
        @{ Pixels = 2560 * 1440; Factor = 20 },
        @{ Pixels = 3840 * 2160; Factor = 40 }
    )
    $pixels = $Width * $Height
    $resolutionFactor = [double]$table[-1].Factor

    for ($index = 0; $index -lt $table.Count; $index++) {
        if ($pixels -eq $table[$index].Pixels) {
            $resolutionFactor = $table[$index].Factor
            break
        }
        if ($pixels -lt $table[$index].Pixels) {
            if ($index -eq 0) {
                $resolutionFactor = $table[0].Factor
            }
            else {
                $previous = $table[$index - 1]
                $current = $table[$index]
                $ratio = ($pixels - $previous.Pixels) / [double]($current.Pixels - $previous.Pixels)
                $resolutionFactor = $previous.Factor + ($ratio * ($current.Factor - $previous.Factor))
            }
            break
        }
    }

    $frameRateFactor = if ($Fps -le 60) { $Fps / 30.0 } else { ([math]::Sqrt($Fps / 60.0) * 60.0) / 30.0 }
    if ($Yuv444) { $resolutionFactor *= 2 }
    return [int]([math]::Round($resolutionFactor * $frameRateFactor, [MidpointRounding]::AwayFromZero) * 1000)
}

function Get-MoonlightSettings {
    $settings = Get-ItemProperty -LiteralPath $key
    $defaultKbps = Get-MoonlightDefaultBitrateKbps -Width $settings.width -Height $settings.height -Fps $settings.fps -Yuv444 ([bool]$settings.yuv444)
    [pscustomobject]@{
        Resolution           = "$($settings.width)x$($settings.height)"
        FPS                  = $settings.fps
        RequestedMbps        = [math]::Round($settings.bitrate / 1000, 2)
        MoonlightDefaultMbps = [math]::Round($defaultKbps / 1000, 2)
        RateControl          = if ([bool]$settings.autoadjustbitrate) { 'MoonlightDefault' } else { 'Fixed' }
        VSync                = [bool]$settings.vsync
        HDR                  = [bool]$settings.hdr
        Yuv444               = [bool]$settings.yuv444
        AppliesOn            = 'Nuova connessione Moonlight dopo chiusura e riapertura del client'
    }
}

if ($Show) {
    Get-MoonlightSettings | Format-List
    exit 0
}

$current = Get-ItemProperty -LiteralPath $key
if ($Mode -eq 'MoonlightDefault') {
    if ($null -ne $BitrateMbps) {
        throw 'Con -Mode MoonlightDefault non specificare -BitrateMbps: viene calcolato dal profilo corrente.'
    }
    $targetKbps = Get-MoonlightDefaultBitrateKbps -Width $current.width -Height $current.height -Fps $current.fps -Yuv444 ([bool]$current.yuv444)
    $autoAdjust = 1
}
else {
    if ($null -eq $BitrateMbps) {
        throw 'Con -Mode Fixed specificare -BitrateMbps, per esempio -BitrateMbps 40.'
    }
    $targetKbps = $BitrateMbps * 1000
    $autoAdjust = 0
}

if ($PSCmdlet.ShouldProcess('Profilo Moonlight dell''utente corrente', "impostare $Mode a $([math]::Round($targetKbps / 1000, 2)) Mbps")) {
    Set-ItemProperty -LiteralPath $key -Name bitrate -Type DWord -Value $targetKbps
    Set-ItemProperty -LiteralPath $key -Name autoadjustbitrate -Type DWord -Value $autoAdjust
}

Get-MoonlightSettings | Format-List
Write-Host 'Chiudi completamente Moonlight e riaprilo prima del prossimo stream.' -ForegroundColor Yellow
