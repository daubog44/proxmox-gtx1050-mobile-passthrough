#requires -Version 5.1
[CmdletBinding()]
param(
    [string] $VmHost,
    [string] $User,
    [string] $Device,
    [ValidateSet(8000, 16000, 24000, 48000)]
    [int] $SampleRate = 16000,
    [switch] $ListDevices,
    [switch] $TestInput,
    [switch] $TestTone,
    [switch] $TestTunnel,
    [ValidateRange(1, 60)]
    [int] $TestSeconds = 8,
    [switch] $InstallKey,
    [switch] $Watch,
    [switch] $InstallAutostart,
    [string] $DeviceBase64,
    [string] $KeyPath = (Join-Path $env:USERPROFILE '.ssh\voxtype-omarchy_ed25519')
    ,[System.Net.IPAddress] $VmAddress
)

<##
.SYNOPSIS
  Invia il microfono Windows a VoxType nella VM Omarchy attraverso SSH cifrato.

.DESCRIPTION
  FFmpeg acquisisce un microfono DirectShow a 16 kHz mono. Lo script copia i
  byte PCM direttamente allo stdin di SSH; sul guest la chiave dedicata puo'
  eseguire solo voxtype-remote-mic-receive, che lo pubblica come
  voxtype_remote_mic.monitor in PipeWire. Non viene aperta nessuna porta UDP.

  Eseguire una prima volta -InstallKey -VmHost <nome-o-IP>: crea una chiave locale dedicata e
  chiede la password SSH solo per registrarne la parte pubblica nel guest.
  Per ogni PC aggiuntivo, copiare questo file e ripetere -InstallKey.

  -InstallAutostart richiede -VmAddress: crea un launcher per-utente nella
  cartella Startup che attende uno stream Moonlight attivo. Riconosce sia il
  canale TCP verso quell'IP sia i socket UDP posseduti da Moonlight (usati dal
  flusso video/audio): solo allora crea il tunnel e lo interrompe alla fine
  dello stream. L'indirizzo resta un parametro esplicito del launcher, non e'
  codificato nello script.

.EXAMPLE
  .\voxtype-windows-mic-tunnel.ps1 -ListDevices
  .\voxtype-windows-mic-tunnel.ps1 -TestInput -TestSeconds 8
  .\voxtype-windows-mic-tunnel.ps1 -TestTone -TestSeconds 8
  .\voxtype-windows-mic-tunnel.ps1 -TestTunnel -TestSeconds 12
  .\voxtype-windows-mic-tunnel.ps1 -InstallKey -VmHost <host-vm> -User <utente-vm>
  .\voxtype-windows-mic-tunnel.ps1 -InstallAutostart -VmHost <host-vm> -VmAddress <ip-vm> -User <utente-vm>
  .\voxtype-windows-mic-tunnel.ps1
  .\voxtype-windows-mic-tunnel.ps1 -Device 'Microphone (USB Audio Device)'
##>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
    param([Parameter(Mandatory)] [string] $Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name non trovato. Installa FFmpeg e OpenSSH Client, poi riprova."
    }
    return $command.Source
}

function Get-DirectShowAudioDevices {
    param([Parameter(Mandatory)] [string] $Ffmpeg)
    # ffmpeg intentionally exits non-zero after its DirectShow listing. On
    # Windows PowerShell 5.1 stderr would otherwise become a terminating error
    # because the script globally uses ErrorActionPreference=Stop.
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    return @($output | ForEach-Object {
        if ($_ -match '^\[dshow[^\]]*\] "(.+)" \(audio\)$') { $Matches[1] }
    })
}

function Add-Argument {
    param(
        [Parameter(Mandatory)] [System.Diagnostics.ProcessStartInfo] $Info,
        [Parameter(Mandatory)] [string] $Value
    )
    $quoted = '"' + ($Value -replace '(\\*)"', '$1$1\\"') + '"'
    if ($Info.Arguments) { $Info.Arguments += ' ' }
    $Info.Arguments += $quoted
}

function Test-MoonlightConnection {
    param([Parameter(Mandatory)] [System.Net.IPAddress] $Address)
    $moonlightPids = @(Get-Process -Name 'Moonlight' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if ($moonlightPids.Count -eq 0) { return $false }
    $remoteAddress = $Address.IPAddressToString
    $tcpStream = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
        Where-Object { $_.RemoteAddress -eq $remoteAddress -and $_.OwningProcess -in $moonlightPids } |
        Select-Object -First 1
    if ($null -ne $tcpStream) { return $true }

    # Moonlight's actual streaming data is normally UDP. Windows does not
    # expose a remote address for UDP endpoints, but an endpoint owned by the
    # Moonlight process is sufficient here: the tunnel is only active while
    # Moonlight has opened its streaming transport.
    return $null -ne (Get-NetUDPEndpoint -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $moonlightPids } |
        Select-Object -First 1)
}

function Quote-TaskArgument {
    param([Parameter(Mandatory)] [string] $Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

$ffmpeg = Require-Command 'ffmpeg'
$ssh = Require-Command 'ssh'
$devices = @(Get-DirectShowAudioDevices -Ffmpeg $ffmpeg)

if ($DeviceBase64) {
    try {
        $Device = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DeviceBase64))
    }
    catch {
        throw '-DeviceBase64 non contiene un nome dispositivo valido.'
    }
}

if ($ListDevices) {
    if ($devices.Count -eq 0) { throw 'FFmpeg non ha trovato dispositivi audio DirectShow.' }
    $devices | ForEach-Object { Write-Output $_ }
    exit 0
}

function Test-MicrophoneInput {
    $ffmpegInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $ffmpegInfo.FileName = $ffmpeg
    $ffmpegInfo.UseShellExecute = $false
    $ffmpegInfo.RedirectStandardOutput = $true
    $ffmpegInfo.RedirectStandardError = $true
    foreach ($argument in @('-hide_banner', '-nostdin', '-f', 'dshow', '-i', "audio=$Device", '-t', "$TestSeconds", '-ac', '1', '-ar', "$SampleRate", '-f', 's16le', '-')) {
        Add-Argument -Info $ffmpegInfo -Value $argument
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $ffmpegInfo
    [void] $process.Start()
    $peak = 0
    $samples = 0L
    $buffer = [byte[]]::new(65536)
    while (($read = $process.StandardOutput.BaseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        for ($offset = 0; $offset -lt ($read - 1); $offset += 2) {
            $amplitude = [Math]::Abs([int][BitConverter]::ToInt16($buffer, $offset))
            if ($amplitude -gt $peak) { $peak = $amplitude }
            $samples++
        }
    }
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "FFmpeg non ha acquisito il microfono: $stderr" }
    $peakDbfs = if ($peak -eq 0) { '-inf' } else { [Math]::Round(20 * [Math]::Log10($peak / 32767.0), 1) }
    Write-Host "Campioni: $samples; picco: $peak ($peakDbfs dBFS)." -ForegroundColor Cyan
    if ($peak -lt 100) { Write-Warning 'FFmpeg riceve silenzio o un segnale quasi nullo dal microfono Windows.' }
}

if ($InstallKey) {
    if (-not $VmHost) { throw '-InstallKey richiede -VmHost.' }
    if (-not $User) { throw '-InstallKey richiede -User.' }
    $sshKeygen = Require-Command 'ssh-keygen'
    $keyDirectory = Split-Path -Parent $KeyPath
    if (-not (Test-Path -LiteralPath $KeyPath)) {
        New-Item -ItemType Directory -Force -Path $keyDirectory | Out-Null
        & $sshKeygen -t ed25519 -f $KeyPath -N '' -C 'voxtype-windows-mic-tunnel'
        if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen non ha creato la chiave del tunnel.' }
    }
    $publicKey = (Get-Content -LiteralPath "$KeyPath.pub" -Raw).Trim()
    $remoteKey = "restrict,command=`"/home/$User/.local/bin/voxtype-remote-mic-receive`" $publicKey"
    $encodedAuthorizedKey = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteKey))
    $remoteCommand = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; line=`$(printf %s '$encodedAuthorizedKey' | base64 -d); grep -qxF `"`$line`" ~/.ssh/authorized_keys || printf '%s\n' `"`$line`" >> ~/.ssh/authorized_keys"
    Write-Host 'Inserisci la password SSH della VM una sola volta per autorizzare questa chiave dedicata.' -ForegroundColor Yellow
    & $ssh -tt "$User@$VmHost" $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw 'La chiave del tunnel non e stata autorizzata nella VM.' }
    Write-Host "Chiave installata: il tunnel potra usare soltanto il ricevitore microfono nella VM." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path -LiteralPath $KeyPath)) {
    throw "Chiave mancante: esegui prima .\$($MyInvocation.MyCommand.Name) -InstallKey"
}
if (-not $Device) {
    if ($devices.Count -eq 1) {
        $Device = $devices[0]
    }
    else {
        throw "Specifica -Device. Elenco: .\$($MyInvocation.MyCommand.Name) -ListDevices"
    }
}
if (-not $DeviceBase64 -and $Device -notin $devices) {
    throw "Dispositivo DirectShow non trovato: $Device. Verifica con -ListDevices."
}
if ($TestInput) {
    Test-MicrophoneInput
    exit 0
}
if (-not $VmHost) { throw '-VmHost e obbligatorio per il tunnel SSH.' }
if (-not $User) { throw '-User e obbligatorio per il tunnel SSH.' }

function Start-MicrophoneTunnel {
    param([scriptblock] $KeepRunning)

    $sshInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $sshInfo.FileName = $ssh
    $sshInfo.UseShellExecute = $false
    $sshInfo.RedirectStandardInput = $true
    foreach ($argument in @('-T', '-i', $KeyPath, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', "$User@$VmHost")) {
        Add-Argument -Info $sshInfo -Value $argument
    }

    $ffmpegInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $ffmpegInfo.FileName = $ffmpeg
    $ffmpegInfo.UseShellExecute = $false
    $ffmpegInfo.RedirectStandardOutput = $true
    $ffmpegArguments = if ($TestTone) {
        @('-hide_banner', '-nostdin', '-f', 'lavfi', '-i', "sine=frequency=1000:sample_rate=$SampleRate", '-t', "$TestSeconds", '-ac', '1', '-ar', "$SampleRate", '-f', 's16le', '-')
    }
    else {
        $arguments = @('-hide_banner', '-nostdin', '-f', 'dshow', '-i', "audio=$Device")
        if ($TestTunnel) { $arguments += @('-t', "$TestSeconds") }
        $arguments + @('-ac', '1', '-ar', "$SampleRate", '-f', 's16le', '-')
    }
    foreach ($argument in $ffmpegArguments) {
        Add-Argument -Info $ffmpegInfo -Value $argument
    }

    $sshProcess = [System.Diagnostics.Process]::new()
    $sshProcess.StartInfo = $sshInfo
    $ffmpegProcess = [System.Diagnostics.Process]::new()
    $ffmpegProcess.StartInfo = $ffmpegInfo
    $sshStarted = $false
    $ffmpegStarted = $false
    $sourceDescription = if ($TestTone) { 'tono diagnostico 1 kHz' } else { $Device }
    Write-Host "Tunnel attivo: $sourceDescription -> $User@$VmHost -> VoxType. Premi Ctrl+C per fermarlo." -ForegroundColor Green
    try {
        [void] $sshProcess.Start()
        $sshStarted = $true
        [void] $ffmpegProcess.Start()
        $ffmpegStarted = $true
        $buffer = [byte[]]::new(65536)
        $output = $ffmpegProcess.StandardOutput.BaseStream
        $continueTunnel = $true
        while ($continueTunnel) {
            # A synchronous Read can block indefinitely when SSH disappears.
            # Poll the pending read so the watcher can tear down FFmpeg and
            # retry the tunnel after a transient connection failure.
            $pendingRead = $output.BeginRead($buffer, 0, $buffer.Length, $null, $null)
            while (-not $pendingRead.AsyncWaitHandle.WaitOne(250)) {
                if ($sshProcess.HasExited -or ($KeepRunning -and -not (& $KeepRunning))) {
                    $continueTunnel = $false
                    break
                }
            }
            if (-not $continueTunnel) { break }
            $read = $output.EndRead($pendingRead)
            if ($read -le 0 -or $sshProcess.HasExited) { break }
            $sshProcess.StandardInput.BaseStream.Write($buffer, 0, $read)
            $sshProcess.StandardInput.BaseStream.Flush()
            if ($KeepRunning -and -not (& $KeepRunning)) { break }
        }
    }
    finally {
        if ($sshStarted) { $sshProcess.StandardInput.Close() }
        if ($ffmpegStarted -and -not $ffmpegProcess.HasExited) { $ffmpegProcess.Kill() }
        if ($sshStarted -and -not $sshProcess.HasExited) { $sshProcess.WaitForExit() }
    }

    if ($sshStarted -and $sshProcess.ExitCode -ne 0) {
        throw "Il ricevitore SSH e terminato con codice $($sshProcess.ExitCode)."
    }
}

if ($InstallAutostart) {
    if (-not $VmAddress) { throw '-InstallAutostart richiede -VmAddress, per esempio 192.168.0.28.' }
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $powershell)) { throw 'Windows PowerShell non disponibile.' }
    $startupArguments = @(
        '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', (Quote-TaskArgument $PSCommandPath),
        '-Watch', '-VmHost', (Quote-TaskArgument $VmHost), '-VmAddress', (Quote-TaskArgument $VmAddress.IPAddressToString),
        '-User', (Quote-TaskArgument $User), '-KeyPath', (Quote-TaskArgument $KeyPath)
    )
    if ($Device) {
        $encodedDevice = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Device))
        $startupArguments += @('-DeviceBase64', (Quote-TaskArgument $encodedDevice))
    }
    $startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
    $launcher = Join-Path $startupDirectory 'Omarchy VoxType microphone tunnel.cmd'
    $launcherBody = "@echo off`r`nstart `"`" /b `"$powershell`" $($startupArguments -join ' ')`r`n"
    # Every argument is ASCII (the device name is Base64), so cmd.exe can read
    # this per-user startup file on every Windows code page.
    Set-Content -LiteralPath $launcher -Value $launcherBody -Encoding Ascii
    Start-Process -WindowStyle Hidden -FilePath $powershell -ArgumentList ($startupArguments -join ' ')
    Write-Host "Autostart installato in ${launcher}: attende lo stream Moonlight verso $($VmAddress.IPAddressToString), poi apre/chiude il tunnel con lo stream." -ForegroundColor Green
    exit 0
}

if ($Watch) {
    if (-not $VmAddress) { throw '-Watch richiede -VmAddress.' }
    Write-Host "Watcher attivo per Moonlight -> $($VmAddress.IPAddressToString) (TCP o UDP)." -ForegroundColor Green
    while ($true) {
        if (Test-MoonlightConnection -Address $VmAddress) {
            try {
                Start-MicrophoneTunnel -KeepRunning { Test-MoonlightConnection -Address $VmAddress }
            }
            catch {
                # A temporary Wi-Fi/SSH failure must not require manual
                # intervention: retain the watcher and retry while Moonlight
                # is still streaming.
                Write-Warning "Tunnel interrotto: $($_.Exception.Message)"
                # Omarchy's firewall rate-limits new SSH connections. A short
                # backoff prevents a failed Wi-Fi/guest restart from turning
                # into a permanent lockout through rapid retries.
                Start-Sleep -Seconds 15
            }
        }
        Start-Sleep -Seconds 2
    }
}

Start-MicrophoneTunnel
