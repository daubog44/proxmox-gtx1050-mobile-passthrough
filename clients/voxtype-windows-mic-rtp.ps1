#requires -Version 5.1
[CmdletBinding()]
param(
    [System.Net.IPAddress] $VmAddress,
    [string] $VmHost,
    [string] $User = 'daubog44',
    [string] $Device,
    [ValidateRange(1024, 65535)] [int] $RtpPort = 40100,
    [switch] $ListDevices,
    [switch] $Watch,
    [switch] $InstallAutostart,
    [string] $DeviceBase64,
    [string] $KeyPath = (Join-Path $env:USERPROFILE '.ssh\voxtype-omarchy_ed25519')
)

<#
.SYNOPSIS
  Invia il microfono Windows alla VM Omarchy via RTP/Opus a bassa latenza.

.DESCRIPTION
  Il watcher e' avviato automaticamente al login Windows ma cattura il
  microfono solo quando la VM lo richiede: PTT VoxType o un'app che apre la
  sorgente PipeWire (Discord incluso). Un canale SSH ristretto trasporta solo
  lo stato active/idle; RTP/UDP trasporta Opus a frame da 20 ms. Pacchetti in
  ritardo vengono scartati, non accumulati per una trascrizione futura.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
    param([Parameter(Mandatory)] [string] $Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { throw "$Name non trovato. Installa FFmpeg e riprova." }
    $command.Source
}

function Add-Argument {
    param([Parameter(Mandatory)] [System.Diagnostics.ProcessStartInfo] $Info, [Parameter(Mandatory)] [string] $Value)
    $quoted = '"' + ($Value -replace '(\\*)"', '$1$1\\"') + '"'
    if ($Info.Arguments) { $Info.Arguments += ' ' }
    $Info.Arguments += $quoted
}

function Get-DirectShowAudioDevices {
    param([Parameter(Mandatory)] [string] $Ffmpeg)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $Ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 }
    finally { $ErrorActionPreference = $previous }
    @($output | ForEach-Object { if ($_ -match '^\[dshow[^\]]*\] "(.+)" \(audio\)$') { $Matches[1] } })
}

function Test-MoonlightConnection {
    $moonlightPids = @(Get-Process -Name Moonlight -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if ($moonlightPids.Count -eq 0) { return $false }
    $remote = $VmAddress.IPAddressToString
    if (Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
        Where-Object { $_.RemoteAddress -eq $remote -and $_.OwningProcess -in $moonlightPids } |
        Select-Object -First 1) { return $true }
    return $null -ne (Get-NetUDPEndpoint -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $moonlightPids } | Select-Object -First 1)
}

function Quote-TaskArgument { param([string] $Value); '"' + $Value.Replace('"', '\"') + '"' }

$ffmpeg = Require-Command ffmpeg
$ssh = Require-Command ssh
if ($DeviceBase64) {
    try { $Device = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DeviceBase64)) }
    catch { throw '-DeviceBase64 non contiene un nome dispositivo valido.' }
}
$devices = @(Get-DirectShowAudioDevices -Ffmpeg $ffmpeg)
if ($ListDevices) { $devices; exit 0 }
if (-not $VmAddress) { throw '-VmAddress e obbligatorio per inviare audio RTP.' }
if (-not $VmHost) { $VmHost = $VmAddress.IPAddressToString }
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Chiave controllo mancante: $KeyPath" }
if (-not $Device) {
    if ($devices.Count -eq 1) { $Device = $devices[0] }
    else { throw 'Specifica -Device. Usa -ListDevices per l''elenco.' }
}
if ($Device -notin $devices) { throw "Dispositivo DirectShow non trovato: $Device" }

function Start-RtpMicrophone {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $ffmpeg
    $info.UseShellExecute = $false
    $target = "rtp://$($VmAddress.IPAddressToString):$RtpPort`?pkt_size=1200"
    foreach ($arg in @('-hide_banner', '-nostdin', '-thread_queue_size', '16', '-f', 'dshow', '-audio_buffer_size', '50', '-i', "audio=$Device", '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-application', 'lowdelay', '-frame_duration', '20', '-b:a', '24k', '-vbr', 'off', '-payload_type', '111', '-f', 'rtp', $target)) {
        Add-Argument -Info $info -Value $arg
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void] $process.Start()
    return $process
}

function Stop-StaleRtpProcesses {
    # A prior crash can leave Chocolatey's ffmpeg shim and its child alive.
    # Only target our configured RTP endpoint, never unrelated FFmpeg work.
    $endpoint = "rtp://$($VmAddress.IPAddressToString):$RtpPort"
    $stale = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like "*$endpoint*"
    })
    foreach ($entry in $stale) {
        if (Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue) {
            & taskkill.exe /PID $entry.ProcessId /T /F | Out-Null
        }
    }
}

function Stop-ChildProcess {
    param([System.Diagnostics.Process] $Process)
    if ($null -ne $Process -and -not $Process.HasExited) {
        # Chocolatey's ffmpeg shim starts the real ffmpeg as a child. Kill the
        # complete, explicitly identified process tree so capture really stops.
        & taskkill.exe /PID $Process.Id /T /F | Out-Null
        $Process.WaitForExit()
    }
}

function Start-ControlFollower {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $ssh
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in @('-T', '-i', $KeyPath, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', "$User@$VmHost", 'voxtype-remote-mic-control-follow')) {
        Add-Argument -Info $info -Value $arg
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void] $process.Start()
    return $process
}

function Start-MoonlightSession {
    $control = $null
    $rtp = $null
    try {
        $control = Start-ControlFollower
        while (Test-MoonlightConnection) {
            $line = $control.StandardOutput.ReadLine()
            if ($null -eq $line) { throw 'Il canale di controllo VM e terminato.' }
            $wanted = $line.Trim()
            if ($wanted -eq 'active') {
                if ($null -eq $rtp -or $rtp.HasExited) { $rtp = Start-RtpMicrophone }
            }
            elseif ($wanted -eq 'idle') {
                Stop-ChildProcess -Process $rtp
                $rtp = $null
            }
        }
    }
    finally {
        Stop-ChildProcess -Process $rtp
        Stop-ChildProcess -Process $control
    }
}

if ($InstallAutostart) {
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $encodedDevice = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Device))
    $args = @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', (Quote-TaskArgument $PSCommandPath), '-Watch', '-VmAddress', (Quote-TaskArgument $VmAddress.IPAddressToString), '-VmHost', (Quote-TaskArgument $VmHost), '-User', (Quote-TaskArgument $User), '-KeyPath', (Quote-TaskArgument $KeyPath), '-RtpPort', $RtpPort, '-DeviceBase64', (Quote-TaskArgument $encodedDevice))
    $launcher = Join-Path ([Environment]::GetFolderPath('Startup')) 'Omarchy VoxType realtime microphone.cmd'
    Set-Content -LiteralPath $launcher -Value "@echo off`r`nstart `"`" /b `"$powershell`" $($args -join ' ')`r`n" -Encoding Ascii
    Start-Process -WindowStyle Hidden -FilePath $powershell -ArgumentList ($args -join ' ')
    Write-Host "Autostart RTP installato: $launcher" -ForegroundColor Green
    exit 0
}

if ($Watch) {
    $mutex = [Threading.Mutex]::new($false, 'Local\OmarchyVoxtypeRtpMicrophone')
    $ownsMutex = $false
    try {
        $ownsMutex = $mutex.WaitOne(0)
        if (-not $ownsMutex) {
            Write-Warning 'Watcher RTP gia attivo: questa seconda istanza termina.'
            exit 0
        }
        Stop-StaleRtpProcesses
        while ($true) {
            if (Test-MoonlightConnection) {
                try { Start-MoonlightSession }
                catch { Write-Warning $_.Exception.Message; Start-Sleep -Seconds 2 }
            }
            Start-Sleep -Seconds 1
        }
    }
    finally {
        Stop-StaleRtpProcesses
        if ($ownsMutex) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

throw 'Usa -Watch o -InstallAutostart per il trasporto RTP controllato dalla VM.'
