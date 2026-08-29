[CmdletBinding(SupportsShouldProcess)]
param(
    [switch] $ConfigureFirewall,
    [string] $PairDeviceId,
    [string] $PeerAddress,
    [string] $AllowedSubnet,
    [switch] $Show
)

<#
.SYNOPSIS
  Prepara KDE Connect su Windows per appunti bidirezionali con Omarchy.

.DESCRIPTION
  Verifica che KDE Connect sia installato e il demone sia in esecuzione. Con
  -ConfigureFirewall aggiunge, in modo idempotente, due regole in ingresso per
  kdeconnectd (TCP e UDP 1714-1764). La subnet viene dedotta dalla route IPv4
  predefinita, oppure dalla route verso -PeerAddress; -AllowedSubnet la imposta
  esplicitamente. Il comando si rilancia come amministratore e richiede UAC.

  Il pairing non viene aggirato: ogni nuovo computer possiede una propria chiave
  e Omarchy deve accettare manualmente la richiesta. Dopo che -Show elenca il
  dispositivo, usare -PairDeviceId <ID> e accettare la richiesta nel guest.

.EXAMPLE
  .\kde-connect-windows-setup.ps1 -Show
  .\kde-connect-windows-setup.ps1 -ConfigureFirewall
  .\kde-connect-windows-setup.ps1 -ConfigureFirewall -PeerAddress <ip-vm>
  .\kde-connect-windows-setup.ps1 -ConfigureFirewall -AllowedSubnet <subnet-lan>
  .\kde-connect-windows-setup.ps1 -PairDeviceId <ID-mostrato-da-Show>
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:ProgramFiles 'KDE Connect\bin'
$daemon = Join-Path $installRoot 'kdeconnectd.exe'
$cli = Join-Path $installRoot 'kdeconnect-cli.exe'
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

function ConvertTo-Ipv4NetworkCidr {
    param(
        [Parameter(Mandatory)] [System.Net.IPAddress] $Address,
        [Parameter(Mandatory)] [ValidateRange(1, 30)] [int] $PrefixLength
    )

    $octets = $Address.GetAddressBytes()
    $network = [byte[]]::new(4)
    $remainingBits = $PrefixLength
    for ($index = 0; $index -lt 4; $index++) {
        $bitsInOctet = [Math]::Min([Math]::Max($remainingBits, 0), 8)
        $mask = if ($bitsInOctet -eq 0) { 0 } else { (0xFF -shl (8 - $bitsInOctet)) -band 0xFF }
        $network[$index] = [byte]($octets[$index] -band $mask)
        $remainingBits -= $bitsInOctet
    }
    return ('{0}/{1}' -f ($network -join '.'), $PrefixLength)
}

function Get-LocalKdeConnectSubnet {
    $route = $null
    $source = 'route IPv4 predefinita'

    if ($PeerAddress) {
        $address = [System.Net.IPAddress]::Parse($PeerAddress)
        if ($address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
            throw '-PeerAddress deve essere un indirizzo IPv4.'
        }
        $route = @(Find-NetRoute -RemoteIPAddress $PeerAddress -ErrorAction Stop | Select-Object -First 1)
        $source = "route verso $PeerAddress"
    }
    if ($null -eq $route -or $route.Count -eq 0) {
        $route = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
            Sort-Object -Property RouteMetric, InterfaceMetric |
            Select-Object -First 1)
    }
    if ($route.Count -eq 0) {
        throw 'Non e stata trovata una route IPv4 utilizzabile. Specifica -AllowedSubnet in formato CIDR.'
    }

    $interfaceIndex = $route[0].InterfaceIndex
    $address = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $interfaceIndex -ErrorAction Stop |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.PrefixLength -ge 1 -and $_.PrefixLength -le 30 -and
            -not $_.SkipAsSource
        } |
        Select-Object -First 1)
    if ($address.Count -eq 0) {
        throw 'La route scelta non ha un indirizzo IPv4 locale adatto. Specifica -AllowedSubnet in formato CIDR.'
    }

    $adapter = Get-NetAdapter -InterfaceIndex $interfaceIndex -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Cidr = ConvertTo-Ipv4NetworkCidr -Address ([System.Net.IPAddress]::Parse($address[0].IPAddress)) -PrefixLength $address[0].PrefixLength
        Source = $source
        InterfaceAlias = if ($adapter) { $adapter.Name } else { "ifIndex $interfaceIndex" }
    }
}

$subnetContext = if ($AllowedSubnet) {
    [pscustomobject]@{ Cidr = $AllowedSubnet; Source = 'parametro -AllowedSubnet'; InterfaceAlias = 'esplicito' }
}
else {
    Get-LocalKdeConnectSubnet
}
$subnet = $subnetContext.Cidr

function Get-KdeConnectStatus {
    $running = @(Get-Process -Name 'kdeconnectd' -ErrorAction SilentlyContinue).Count -gt 0
    $existingRules = @($rules | ForEach-Object {
        Get-NetFirewallRule -DisplayName $_.Name -ErrorAction SilentlyContinue
    }).Count
    [pscustomobject]@{
        DaemonRunning = $running
        FirewallRules = "$existingRules/$($rules.Count) per $subnet"
        SubnetSource = "$($subnetContext.Source) ($($subnetContext.InterfaceAlias))"
        NetworkProfile = (Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'NoTraffic' } | ForEach-Object { "$($_.InterfaceAlias):$($_.NetworkCategory)" }) -join ', '
        Devices = Invoke-KdeConnectCli '--list-devices'
        NextStep = 'Quando Omarchy appare, invia pairing e accettalo anche nel guest; poi abilita Clipboard su entrambi.'
    }
}

if ($ConfigureFirewall -and -not (Test-IsAdministrator)) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ConfigureFirewall"
    if ($PeerAddress) {
        $arguments += " -PeerAddress `"$PeerAddress`""
    }
    if ($AllowedSubnet) {
        $arguments += " -AllowedSubnet `"$AllowedSubnet`""
    }
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
        elseif ($PSCmdlet.ShouldProcess($rule.Name, "aggiornare la rete remota consentita a $subnet")) {
            $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $subnet
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
