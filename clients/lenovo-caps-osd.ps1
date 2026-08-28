[CmdletBinding(DefaultParameterSetName = 'Show')]
param(
    [Parameter(ParameterSetName = 'Show')]
    [switch] $Show,

    [Parameter(Mandatory, ParameterSetName = 'DisableCapsOsd')]
    [switch] $DisableCapsOsd,

    [Parameter(Mandatory, ParameterSetName = 'EnableCapsOsd')]
    [switch] $EnableCapsOsd,

    [Parameter(Mandatory, ParameterSetName = 'DisableService')]
    [switch] $DisableLenovoService,

    [Parameter(Mandatory, ParameterSetName = 'EnableService')]
    [switch] $EnableLenovoService
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceName = 'LenovoFnAndFunctionKeys'
$toastPath = 'HKLM:\SYSTEM\CurrentControlSet\Services\LenovoFnAndFunctionKeys\VantageToast'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LenovoCapsStatus {
    if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
        throw "Servizio Lenovo non trovato: $serviceName"
    }

    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    $toast = if (Test-Path $toastPath) { Get-ItemProperty -Path $toastPath } else { $null }
    $osdProcess = Get-Process -Name 'FnHotkeyCapsLKNumLK' -ErrorAction SilentlyContinue

    [pscustomobject]@{
        Service           = $service.DisplayName
        ServiceState      = $service.State
        ServiceStartMode  = $service.StartMode
        CapsOsdEnabled    = if ($null -eq $toast) { $null } else { [bool]$toast.ShowCapslkOSD }
        NumOsdEnabled     = if ($null -eq $toast) { $null } else { [bool]$toast.ShowNumlkOSD }
        OSDProcessRunning = [bool]$osdProcess
        OSDProcessId      = if ($osdProcess) { $osdProcess.Id -join ', ' } else { $null }
        RegistryPath      = $toastPath
    }
}

function Restart-LenovoService {
    Restart-Service -Name $serviceName -Force
    Start-Sleep -Seconds 2
}

if ($PSCmdlet.ParameterSetName -eq 'Show') {
    Get-LenovoCapsStatus | Format-List
    return
}

if (-not (Test-IsAdministrator)) {
    $argument = switch ($PSCmdlet.ParameterSetName) {
        'DisableCapsOsd' { '-DisableCapsOsd' }
        'EnableCapsOsd' { '-EnableCapsOsd' }
        'DisableService' { '-DisableLenovoService' }
        'EnableService' { '-EnableLenovoService' }
    }
    $quotedScript = '"{0}"' -f $PSCommandPath
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File $quotedScript $argument"
    exit $process.ExitCode
}

switch ($PSCmdlet.ParameterSetName) {
    'DisableCapsOsd' {
        if (-not (Test-Path $toastPath)) {
            throw "Chiave OSD Lenovo non trovata: $toastPath"
        }
        Set-ItemProperty -Path $toastPath -Name ShowCapslkOSD -Type DWord -Value 0
        Restart-LenovoService
        Write-Host 'OSD Caps Lock Lenovo disattivato. Il servizio Fn resta attivo.' -ForegroundColor Green
    }
    'EnableCapsOsd' {
        if (-not (Test-Path $toastPath)) {
            throw "Chiave OSD Lenovo non trovata: $toastPath"
        }
        Set-ItemProperty -Path $toastPath -Name ShowCapslkOSD -Type DWord -Value 1
        Restart-LenovoService
        Write-Host 'OSD Caps Lock Lenovo riattivato.' -ForegroundColor Green
    }
    'DisableService' {
        Stop-Service -Name $serviceName -Force
        Set-Service -Name $serviceName -StartupType Disabled
        Write-Warning 'Servizio Fn Lenovo disattivato: possono smettere di funzionare scorciatoie Fn specifiche del modello.'
    }
    'EnableService' {
        Set-Service -Name $serviceName -StartupType Automatic
        Start-Service -Name $serviceName
        Write-Host 'Servizio Fn Lenovo riattivato e impostato su Avvio automatico.' -ForegroundColor Green
    }
}

Get-LenovoCapsStatus | Format-List
