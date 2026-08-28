[CmdletBinding(SupportsShouldProcess)]
param(
    [switch] $ConfigureFirewall,
    [string] $PairDeviceId,
    [switch] $Show
)

<#
.SYNOPSIS
  Prepara KDE Connect su Windows per appunti bidirezionali con Omarchy.

.DESCRIPTION
  Verifica che KDE Connect sia installato e il demone sia in esecuzione. Con
  -ConfigureFirewall aggiunge, in modo idempotente, due regole in ingresso per
  kdeconnectd (TCP e UDP 1714-1764) limitate alla LAN 192.168.0.0/24. Il comando
  si rilancia come amministratore e richiede l'approvazione UAC.

  Il pairing non viene aggirato: ogni nuovo computer possiede una propria chiave
  e Omarchy deve accettare manualmente la richiesta. Dopo che -Show elenca il
  dispositivo, usare -PairDeviceId <ID> e accettare la richiesta nel guest.

.EXAMPLE
  .\kde-connect-windows-setup.ps1 -Show
  .\kde-connect-windows-setup.ps1 -ConfigureFirewall
  .\kde-connect-windows-setup.ps1 -PairDeviceId <ID-mostrato-da-Show>
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:ProgramFiles 'KDE Connect\bin'
$daemon = Join-Path $installRoot 'kdeconnectd.exe'
$cli = Join-Path $installRoot 'kdeconnect-cli.exe'
$subnet = '192.168.0.0/24'
$rules = @(
    @{ Name = 'KDE Connect - TCP inbound LAN'; Protocol = 'TCP' },
    @{ Name = 'KDE Connect - UDP inbound LAN'; Protocol = 'UDP' }
)

if (-not (Test-Path -LiteralPath $daemon) -or -not (Test-Path -LiteralPath $cli)) {
    throw 'KDE Connect non e installato per tutti gli utenti. Installalo da https://kdeconnect.kde.org/download.html e riprova.'
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-KdeConnectCli {
    param([Parameter(Mandatory)] [string] $Arguments)

    # kdeconnect-cli scrive "0 dispositivi" su stderr: cmd lo raccoglie senza
    # trasformare un normale stato vuoto in un errore PowerShell terminante.
    $command = '"{0}" {1} 2>&1' -f $cli, $Arguments
    return (& $env:ComSpec /d /c $command | Out-String).Trim()
}

function Get-KdeConnectStatus {
    $running = @(Get-Process -Name 'kdeconnectd' -ErrorAction SilentlyContinue).Count -gt 0
    $existingRules = @($rules | ForEach-Object {
        Get-NetFirewallRule -DisplayName $_.Name -ErrorAction SilentlyContinue
    }).Count
    [pscustomobject]@{
        DaemonRunning = $running
        FirewallRules = "$existingRules/$($rules.Count) per $subnet"
        NetworkProfile = (Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'NoTraffic' } | ForEach-Object { "$($_.InterfaceAlias):$($_.NetworkCategory)" }) -join ', '
        Devices = Invoke-KdeConnectCli '--list-devices'
        NextStep = 'Quando Omarchy appare, invia pairing e accettalo anche nel guest; poi abilita Clipboard su entrambi.'
    }
}

if ($ConfigureFirewall -and -not (Test-IsAdministrator)) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ConfigureFirewall"
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments
    Write-Host 'Richiesta UAC aperta: approvala per installare le regole firewall KDE Connect.' -ForegroundColor Yellow
    exit 0
}

if ($ConfigureFirewall) {
    foreach ($rule in $rules) {
        $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
        if ($null -eq $existing) {
            if ($PSCmdlet.ShouldProcess($rule.Name, "consentire $($rule.Protocol) 1714-1764 dalla LAN $subnet")) {
                New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol $rule.Protocol -LocalPort '1714-1764' -RemoteAddress $subnet -Profile Any -Program $daemon | Out-Null
            }
        }
    }
}

if (-not (Get-Process -Name 'kdeconnectd' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $daemon
    Start-Sleep -Seconds 2
}

[void](Invoke-KdeConnectCli '--refresh')
if ($PairDeviceId) {
    Invoke-KdeConnectCli "--pair --device $PairDeviceId"
    Write-Host 'Richiesta inviata: accettala in KDE Connect su Omarchy.' -ForegroundColor Yellow
}

Get-KdeConnectStatus | Format-List
