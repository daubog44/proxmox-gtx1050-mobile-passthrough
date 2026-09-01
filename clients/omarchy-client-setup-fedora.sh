#!/usr/bin/env bash
# Reproducible Fedora client setup for an existing Omarchy/Sunshine guest.
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
config_file="$repo_root/config/omarchy.env"
module=all
install_key=0
configure_kde_firewall=0

die() { printf 'Errore: %s\n' "$*" >&2; exit 1; }
note() { printf '==> %s\n' "$*"; }

usage() {
  cat <<'EOF'
Uso:
  clients/omarchy-client-setup-fedora.sh --config FILE [opzioni]

Opzioni:
  --module onboard|all|check|moonlight|microphone|kde-connect|show
  --install-key                 autorizza una volta la chiave SSH del microfono
  --configure-kde-firewall      consente KDE Connect solo dall'IP della VM

Usare come utente desktop Fedora, non come root. DNF/rpm-ostree richiede sudo
solo quando deve installare pacchetti; Moonlight Flatpak e il servizio audio
restano per l'utente corrente.
EOF
}

while (( $# )); do
  case "$1" in
    --config) (( $# >= 2 )) || die '--config richiede un file'; config_file=$2; shift 2 ;;
    --module) (( $# >= 2 )) || die '--module richiede un valore'; module=$2; shift 2 ;;
    --install-key) install_key=1; shift ;;
    --configure-kde-firewall) configure_kde_firewall=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "opzione sconosciuta: $1" ;;
  esac
done
case "$module" in onboard|all|check|moonlight|microphone|kde-connect|show) ;; *) die 'modulo: onboard, all, check, moonlight, microphone, kde-connect oppure show' ;; esac
[[ $EUID -ne 0 ]] || die 'esegui come utente desktop Fedora: il servizio deve appartenere al tuo account'

[[ -r /etc/os-release ]] || die '/etc/os-release mancante'
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == fedora ]] || die "questo client supporta Fedora; rilevato ${ID:-sconosciuto}"

[[ -f "$config_file" ]] || die "configurazione mancante: $config_file"
# shellcheck disable=SC1090
source "$config_file"
: "${OMARCHY_USER:?OMARCHY_USER mancante}"
: "${OMARCHY_VM_HOST:?OMARCHY_VM_HOST mancante}"
: "${OMARCHY_VM_ADDRESS:?OMARCHY_VM_ADDRESS mancante}"
: "${OMARCHY_CLIENT_ADDRESS:?OMARCHY_CLIENT_ADDRESS mancante}"
: "${OMARCHY_RTP_PORT:?OMARCHY_RTP_PORT mancante}"

validate_onboard_config() {
  [[ "$OMARCHY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'OMARCHY_USER non valido per SSH'
  [[ "$OMARCHY_VM_HOST" =~ ^[a-zA-Z0-9._:-]+$ ]] || die 'OMARCHY_VM_HOST non valido per SSH'
  [[ "$OMARCHY_CLIENT_ADDRESS" =~ ^[0-9a-fA-F:.]+$ ]] || die 'OMARCHY_CLIENT_ADDRESS non valido'
  [[ "$OMARCHY_RTP_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( OMARCHY_RTP_PORT <= 65535 )) || die 'OMARCHY_RTP_PORT non valida'
}

confirm() {
  local prompt=$1 answer
  while true; do
    read -r -p "$prompt [s/N]: " answer
    case "$answer" in
      s|S|si|SI|Si) return 0 ;;
      ''|n|N|no|NO|No) return 1 ;;
      *) note 'rispondi s oppure n' ;;
    esac
  done
}

local_sudo() {
  local secret="${OMARCHY_LOCAL_SUDO_PASSWORD:-${OMARCHY_SUDO_PASSWORD:-${OMARCHY_SSH_PASSWORD:-}}}"
  if [[ -n "$secret" ]]; then
    printf '%s\n' "$secret" | sudo -S -p '' -- "$@"
  else
    sudo -- "$@"
  fi
}

install_rpms() {
  local packages=("$@")
  local missing=()
  local package
  for package in "${packages[@]}"; do rpm -q "$package" >/dev/null 2>&1 || missing+=("$package"); done
  ((${#missing[@]})) || return 0
  note "dipendenze Fedora mancanti: ${missing[*]}"
  print_install_command "${missing[@]}"
  if command -v rpm-ostree >/dev/null && rpm-ostree status --json >/dev/null 2>&1; then
    local_sudo rpm-ostree install "${missing[@]}"
    die 'pacchetti aggiunti alla prossima deployment rpm-ostree: riavvia Fedora, poi riesegui questo comando'
  fi
  local_sudo dnf install -y "${missing[@]}"
}

has_ffmpeg_opus() {
  command -v ffmpeg >/dev/null &&
    ffmpeg -hide_banner -encoders 2>/dev/null |
      grep -E '[[:space:]]libopus([[:space:]]|$)' >/dev/null
}

ensure_ffmpeg_opus() {
  has_ffmpeg_opus && return 0
  if command -v ffmpeg >/dev/null; then
    die 'FFmpeg e presente ma non include libopus: installa una build compatibile senza sostituire automaticamente il pacchetto attuale'
  fi
  install_rpms ffmpeg-free
  has_ffmpeg_opus || die 'FFmpeg installato ma senza encoder libopus'
}

print_install_command() {
  local packages=("$@")
  if command -v rpm-ostree >/dev/null && rpm-ostree status --json >/dev/null 2>&1; then
    printf '  sudo rpm-ostree install'
  else
    printf '  sudo dnf install -y'
  fi
  printf ' %q' "${packages[@]}"
  printf '\n'
}

check_dependencies() {
  local missing_packages=() missing=0 package command
  local packages=(openssh-clients iproute pulseaudio-utils pipewire-pulseaudio kde-connect flatpak)
  local commands=(ffmpeg ssh scp ssh-keygen ss pactl kdeconnect-cli flatpak systemctl)
  printf '%-27s %s\n' 'Sistema:' "Fedora ${VERSION_ID:-sconosciuta}"
  for package in "${packages[@]}"; do
    if rpm -q "$package" >/dev/null 2>&1; then
      printf '%-27s %s\n' "RPM $package:" 'ok'
    else
      printf '%-27s %s\n' "RPM $package:" 'MANCANTE'
      missing_packages+=("$package")
      missing=1
    fi
  done
  for command in "${commands[@]}"; do
    if command -v "$command" >/dev/null; then
      printf '%-27s %s\n' "Comando $command:" 'ok'
    else
      printf '%-27s %s\n' "Comando $command:" 'MANCANTE'
      missing=1
    fi
  done
  if has_ffmpeg_opus; then
    printf '%-27s %s\n' 'Encoder libopus:' 'ok'
  else
    printf '%-27s %s\n' 'Encoder libopus:' 'MANCANTE'
    command -v ffmpeg >/dev/null || missing_packages+=(ffmpeg-free)
    missing=1
  fi
  if command -v flatpak >/dev/null && flatpak info com.moonlight_stream.Moonlight >/dev/null 2>&1; then
    printf '%-27s %s\n' 'Moonlight Flatpak:' 'ok'
  else
    printf '%-27s %s\n' 'Moonlight Flatpak:' 'MANCANTE'
    missing=1
  fi
  if ! systemctl --user is-enabled voxtype-fedora-mic-rtp.service >/dev/null 2>&1; then
    printf '%-27s %s\n' 'Watcher microfono:' 'non installato'
    missing=1
  else
    printf '%-27s %s\n' 'Watcher microfono:' 'ok'
  fi
  if ((${#missing_packages[@]})); then
    printf 'Pacchetti mancanti: %s\n' "${missing_packages[*]}"
    print_install_command "${missing_packages[@]}"
  fi
  if ! command -v flatpak >/dev/null || ! flatpak info com.moonlight_stream.Moonlight >/dev/null 2>&1; then
    printf '%s\n' 'Moonlight: prima installa flatpak, poi:'
    printf '%s\n' '  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo'
    printf '%s\n' '  flatpak install --user flathub com.moonlight_stream.Moonlight'
  fi
  (( missing == 0 ))
}

install_moonlight() {
  install_rpms flatpak
  if flatpak info com.moonlight_stream.Moonlight >/dev/null 2>&1; then
    note 'Moonlight gia installato'
    return 0
  fi
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub com.moonlight_stream.Moonlight
  note 'Moonlight installato. Aprilo dal menu o con: flatpak run com.moonlight_stream.Moonlight'
}

install_microphone() {
  ensure_ffmpeg_opus
  install_rpms openssh-clients iproute pulseaudio-utils pipewire-pulseaudio
  local target_bin="$HOME/.local/bin/voxtype-fedora-mic-rtp"
  local target_config="$HOME/.config/omarchy/omarchy.env"
  local target_unit="$HOME/.config/systemd/user/voxtype-fedora-mic-rtp.service"
  install -d -m 0700 "$HOME/.config/omarchy" "$HOME/.config/systemd/user"
  install -Dm755 "$script_dir/voxtype-fedora-mic-rtp.sh" "$target_bin"
  install -Dm600 "$config_file" "$target_config"
  install -Dm644 "$repo_root/systemd/voxtype-fedora-mic-rtp.service" "$target_unit"
  if (( install_key )); then "$target_bin" --config "$target_config" --install-key; fi
  systemctl --user daemon-reload
  systemctl --user enable --now voxtype-fedora-mic-rtp.service
  note "watcher microfono installato: $target_unit"
}

install_kde_connect() {
  install_rpms kde-connect
  command -v kdeconnect-cli >/dev/null || die 'kdeconnect-cli non disponibile dopo l installazione'
  kdeconnect-cli --refresh || true
  if (( configure_kde_firewall )); then
    command -v firewall-cmd >/dev/null || die 'firewall-cmd mancante: configura manualmente KDE Connect oppure installa firewalld'
    local protocol rule
    for protocol in tcp udp; do
      rule="rule family=ipv4 source address=$OMARCHY_VM_ADDRESS port port=1714-1764 protocol=$protocol accept"
      local_sudo firewall-cmd --permanent --query-rich-rule="$rule" >/dev/null || \
        local_sudo firewall-cmd --permanent --add-rich-rule="$rule"
    done
    local_sudo firewall-cmd --reload
    note "firewall KDE Connect: TCP/UDP 1714-1764 ammessi soltanto dalla VM $OMARCHY_VM_ADDRESS"
  fi
  guide_kde_pairing
}

guide_kde_pairing() {
  local paired=() discovered=() device_id line candidate
  mapfile -t paired < <(kdeconnect-cli --list-available --id-only 2>/dev/null || true)
  if ((${#paired[@]})); then
    note "KDE Connect: pairing gia attivo con ${#paired[@]} dispositivo/i"
    kdeconnect-cli --list-available || true
    return 0
  fi

  note 'KDE Connect: cerco Omarchy nella LAN (puo richiedere alcuni secondi)'
  kdeconnect-cli --refresh >/dev/null 2>&1 || true
  sleep 2
  while IFS= read -r line; do
    [[ "$line" == *"$OMARCHY_VM_ADDRESS"* ]] || continue
    candidate=$(grep -Eo '[0-9a-fA-F]{32}' <<<"$line" | head -n 1 || true)
    [[ -n "$candidate" ]] && { device_id=$candidate; break; }
  done < <(kdeconnect-cli --list-devices 2>/dev/null || true)
  mapfile -t discovered < <(kdeconnect-cli --list-devices --id-only 2>/dev/null || true)
  if ((${#discovered[@]} == 0)); then
    note 'nessun dispositivo rilevato: apri KDE Connect su Omarchy e Fedora, poi usa kdeconnect-cli --refresh'
    return 0
  fi
  if [[ -n "$device_id" ]]; then
    note "Omarchy rilevato automaticamente all IP $OMARCHY_VM_ADDRESS (ID $device_id)"
  elif ((${#discovered[@]} == 1)); then
    device_id=${discovered[0]}
  else
    kdeconnect-cli --list-devices --id-name-only || true
    read -r -p 'Incolla l ID del dispositivo Omarchy da associare (vuoto per saltare): ' device_id
    [[ -n "$device_id" ]] || return 0
  fi
  if ! kdeconnect-cli --pair --device "$device_id"; then
    note 'KDE Connect non ha inviato la richiesta: apri le due GUI e riprova solo il pairing'
    return 0
  fi
  note 'richiesta inviata: approva la notifica Pairing request sul desktop Omarchy; il wizard attende fino a 45 secondi'
  for _ in {1..15}; do
    sleep 3
    kdeconnect-cli --list-available --id-only 2>/dev/null | grep -Fxq -- "$device_id" && {
      note 'pairing KDE Connect completato; abilita il plugin Clipboard nelle due GUI se non e gia attivo'
      return 0
    }
  done
  note 'pairing non ancora approvato: apri KDE Connect su Omarchy e accetta la richiesta; non serve ripetere il resto del setup'
}

remote_ssh_options=()
remote_control_dir=''
ssh_auth_prefix=()

configure_ssh_password() {
  [[ -n "${OMARCHY_SSH_PASSWORD:-}" ]] || return 0
  # Omarchy Control provides its own in-memory SSH_ASKPASS executable. A
  # standalone shell can obtain the same non-interactive behavior via sshpass.
  if [[ -z "${SSH_ASKPASS:-}" ]]; then
    command -v sshpass >/dev/null || die 'OMARCHY_SSH_PASSWORD richiede sshpass: sudo dnf install -y sshpass'
    export SSHPASS="$OMARCHY_SSH_PASSWORD"
    ssh_auth_prefix=(sshpass -e)
  fi
}

ssh_run() { "${ssh_auth_prefix[@]}" ssh "$@"; }
scp_run() { "${ssh_auth_prefix[@]}" scp "$@"; }

remote_sudo() {
  local secret="${OMARCHY_SUDO_PASSWORD:-${OMARCHY_SSH_PASSWORD:-}}"
  if [[ -n "$secret" ]]; then
    # No PTY in automated mode: a remote terminal could echo piped input
    # before sudo disables echo. sudo -S works through the encrypted stdin.
    local remote_command="sudo -S -p '' --" argument
    for argument in "$@"; do printf -v remote_command '%s %q' "$remote_command" "$argument"; done
    printf '%s\n' "$secret" | ssh_run -T "${remote_ssh_options[@]}" \
      "$OMARCHY_USER@$OMARCHY_VM_HOST" "$remote_command"
  else
    ssh_run -tt "${remote_ssh_options[@]}" \
      "$OMARCHY_USER@$OMARCHY_VM_HOST" sudo "$@"
  fi
}

cleanup_remote_ssh() {
  [[ -n "$remote_control_dir" ]] || return 0
  rm -rf -- "$remote_control_dir"
  remote_control_dir=''
}

prepare_remote_ssh() {
  [[ -n "$remote_control_dir" ]] && return 0
  command -v ssh >/dev/null || die 'ssh mancante: installa openssh-clients prima di configurare la VM'
  command -v scp >/dev/null || die 'scp mancante: installa openssh-clients prima di configurare la VM'
  configure_ssh_password
  remote_control_dir="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/omarchy-ssh.XXXXXX")"
  chmod 0700 "$remote_control_dir"
  remote_ssh_options=(
    -o StrictHostKeyChecking=accept-new
    -o ConnectTimeout=10
    -o ControlMaster=auto
    -o ControlPersist=2m
    -o "ControlPath=$remote_control_dir/control"
  )
}

vm_receiver_present() {
  ssh_run "${remote_ssh_options[@]}" "$OMARCHY_USER@$OMARCHY_VM_HOST" \
    'test -x ~/.local/bin/voxtype-remote-mic-ssh-dispatch && test -x ~/.local/bin/voxtype-remote-mic-rtp-receive && test -f ~/.config/systemd/user/voxtype-remote-mic-rtp.service'
}

bootstrap_vm_microphone() (
  local local_stage remote_stage source destination
  local sources=(
    scripts/omarchy-setup
    scripts/voxtype-remote-mic-rtp-receive
    scripts/voxtype-remote-mic-control-follow
    scripts/voxtype-remote-mic-demand
    scripts/voxtype-remote-mic-ssh-dispatch
    systemd/voxtype-remote-mic-rtp.service
  )

  for source in "${sources[@]}"; do
    [[ -f "$repo_root/$source" ]] || die "bootstrap VM non disponibile: file pacchetto mancante $source"
  done

  local_stage="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/omarchy-guest-bootstrap.XXXXXX")"
  chmod 0700 "$local_stage"
  remote_stage=''
  cleanup_bootstrap() {
    rm -rf -- "$local_stage"
    [[ "$remote_stage" =~ ^/tmp/omarchy-guest-bootstrap\.[A-Za-z0-9]+$ ]] || return 0
    ssh_run "${remote_ssh_options[@]}" "$OMARCHY_USER@$OMARCHY_VM_HOST" "rm -rf -- $remote_stage" >/dev/null 2>&1 || true
  }
  trap cleanup_bootstrap EXIT
  install -d -m 0700 "$local_stage/scripts" "$local_stage/systemd" "$local_stage/config"
  for source in "${sources[@]}"; do
    destination="$local_stage/$source"
    install -D -m "$(test -x "$repo_root/$source" && echo 0755 || echo 0644)" "$repo_root/$source" "$destination"
  done
  install -m 0600 "$config_file" "$local_stage/config/omarchy.env"

  note 'ricevitore VM assente: trasferisco soltanto gli script del microfono e la configurazione privata temporanea'
  remote_stage="$(ssh_run "${remote_ssh_options[@]}" "$OMARCHY_USER@$OMARCHY_VM_HOST" 'umask 077; mktemp -d /tmp/omarchy-guest-bootstrap.XXXXXX')" || die 'impossibile creare la directory temporanea nella VM via SSH'
  [[ "$remote_stage" =~ ^/tmp/omarchy-guest-bootstrap\.[A-Za-z0-9]+$ ]] || die 'directory temporanea VM non valida: bootstrap annullato'
  scp_run "${remote_ssh_options[@]}" -pr "$local_stage/." "$OMARCHY_USER@$OMARCHY_VM_HOST:$remote_stage/" || die 'trasferimento del ricevitore alla VM fallito'

  note 'VM: installo il ricevitore, il servizio utente, la regola UFW e i binding PTT esistenti'
  remote_sudo bash "$remote_stage/scripts/omarchy-setup" --config "$remote_stage/config/omarchy.env" guest microphone install --apply || \
    die 'bootstrap microfono VM fallito: leggi l errore precedente. Servono VoxType, ffmpeg, PipeWire/Pulse, pw-cat, systemd utente e ufw gia disponibili nella VM Omarchy'
  ssh_run "${remote_ssh_options[@]}" "$OMARCHY_USER@$OMARCHY_VM_HOST" "rm -rf -- $remote_stage"
  remote_stage=''
  trap - EXIT
  rm -rf -- "$local_stage"
  note 'ricevitore microfono VM installato e configurato automaticamente'
)

ensure_vm_microphone_receiver() {
  validate_onboard_config
  prepare_remote_ssh
  note "VM Omarchy: controllo il ricevitore RTP su $OMARCHY_VM_HOST"
  if vm_receiver_present; then
    note 'ricevitore microfono VM: gia installato'
  else
    bootstrap_vm_microphone
  fi
  configure_vm_rtp_firewall
  cleanup_remote_ssh
}

configure_vm_rtp_firewall() {
  local owns_connection=0
  validate_onboard_config
  if [[ -z "$remote_control_dir" ]]; then
    prepare_remote_ssh
    owns_connection=1
  fi
  note "VM Omarchy: verifico il ricevitore e autorizzo UDP $OMARCHY_RTP_PORT da $OMARCHY_CLIENT_ADDRESS"
  if [[ -n "${OMARCHY_SSH_PASSWORD:-}" ]]; then
    note 'uso la credenziale temporanea della GUI per SSH e sudo VM; non viene salvata e non serve reinserirla'
  else
    note 'il terminale puo chiedere prima la password SSH e poi sudo della VM; nessuna password viene salvata'
  fi
  vm_receiver_present || die 'ricevitore VM assente dopo il bootstrap: esegui omarchy-onboard --apply e riporta l errore completo'
  remote_sudo ufw allow from "$OMARCHY_CLIENT_ADDRESS" to any port "$OMARCHY_RTP_PORT" proto udp comment Omarchy-Voxtype-RTP-microphone
  if (( owns_connection )); then cleanup_remote_ssh; fi
}

onboard() {
  validate_onboard_config
  note '1/5: installo Moonlight e le dipendenze richieste'
  install_moonlight
  ensure_ffmpeg_opus
  install_rpms openssh-clients iproute pulseaudio-utils pipewire-pulseaudio kde-connect

  note '2/5: controllo o installo automaticamente il ricevitore RTP nella VM via SSH'
  ensure_vm_microphone_receiver

  note '3/5: installo watcher e chiave SSH limitata del microfono'
  install_key=1
  install_microphone

  note '4/5: installo KDE Connect, limito il firewall alla VM e avvio il pairing guidato'
  configure_kde_firewall=1
  install_kde_connect

  note '5/5: verifico dipendenze, Moonlight e watcher'
  check_dependencies || die 'onboarding non completato: leggi le dipendenze mancanti indicate sopra'
  note 'onboarding completato: apri Moonlight, associa Sunshine e poi approva il pairing KDE Connect su entrambi i PC'
}

show() {
  "$script_dir/voxtype-fedora-mic-rtp.sh" --config "$config_file" --show
  printf '%-18s %s\n' 'Moonlight Flatpak:' "$(flatpak info com.moonlight_stream.Moonlight >/dev/null 2>&1 && echo installato || echo non-installato)"
  printf '%-18s %s\n' 'KDE Connect:' "$(command -v kdeconnect-cli >/dev/null && echo installato || echo non-installato)"
  systemctl --user is-enabled voxtype-fedora-mic-rtp.service 2>/dev/null || true
}

case "$module" in
  check) check_dependencies ;;
  onboard) onboard ;;
  moonlight) install_moonlight ;;
  microphone) install_microphone ;;
  kde-connect) install_kde_connect ;;
  all) install_moonlight; install_microphone; install_kde_connect ;;
  show) show ;;
esac
