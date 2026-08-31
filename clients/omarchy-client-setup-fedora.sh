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
  --module all|check|moonlight|microphone|kde-connect|show
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
case "$module" in all|check|moonlight|microphone|kde-connect|show) ;; *) die 'modulo: all, check, moonlight, microphone, kde-connect oppure show' ;; esac
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

install_rpms() {
  local packages=("$@")
  local missing=()
  local package
  for package in "${packages[@]}"; do rpm -q "$package" >/dev/null 2>&1 || missing+=("$package"); done
  ((${#missing[@]})) || return 0
  note "dipendenze Fedora mancanti: ${missing[*]}"
  print_install_command "${missing[@]}"
  if command -v rpm-ostree >/dev/null && rpm-ostree status --json >/dev/null 2>&1; then
    sudo rpm-ostree install "${missing[@]}"
    die 'pacchetti aggiunti alla prossima deployment rpm-ostree: riavvia Fedora, poi riesegui questo comando'
  fi
  sudo dnf install -y "${missing[@]}"
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
  local packages=(ffmpeg-free openssh-clients iproute pulseaudio-utils pipewire-pulseaudio kde-connect flatpak)
  local commands=(ffmpeg ssh ssh-keygen ss pactl kdeconnect-cli flatpak systemctl)
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
  if command -v ffmpeg >/dev/null && ffmpeg -hide_banner -encoders 2>/dev/null | grep -Eq '[[:space:]]libopus([[:space:]]|$)'; then
    printf '%-27s %s\n' 'Encoder libopus:' 'ok'
  else
    printf '%-27s %s\n' 'Encoder libopus:' 'MANCANTE'
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
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y flathub com.moonlight_stream.Moonlight
  note 'Moonlight installato. Aprilo dal menu o con: flatpak run com.moonlight_stream.Moonlight'
}

install_microphone() {
  install_rpms ffmpeg-free openssh-clients iproute pulseaudio-utils pipewire-pulseaudio
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -Eq '[[:space:]]libopus([[:space:]]|$)' || die 'ffmpeg-free installato ma senza encoder libopus; usa un build FFmpeg Fedora con libopus e riesegui'
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
      sudo firewall-cmd --permanent --query-rich-rule="$rule" >/dev/null || \
        sudo firewall-cmd --permanent --add-rich-rule="$rule"
    done
    sudo firewall-cmd --reload
    note "firewall KDE Connect: TCP/UDP 1714-1764 ammessi soltanto dalla VM $OMARCHY_VM_ADDRESS"
  fi
  note 'apri KDE Connect su Fedora e Omarchy, effettua il pairing e abilita Clipboard su entrambi: il consenso non viene automatizzato'
}

show() {
  "$script_dir/voxtype-fedora-mic-rtp.sh" --config "$config_file" --show
  printf '%-18s %s\n' 'Moonlight Flatpak:' "$(flatpak info com.moonlight_stream.Moonlight >/dev/null 2>&1 && echo installato || echo non-installato)"
  printf '%-18s %s\n' 'KDE Connect:' "$(command -v kdeconnect-cli >/dev/null && echo installato || echo non-installato)"
  systemctl --user is-enabled voxtype-fedora-mic-rtp.service 2>/dev/null || true
}

case "$module" in
  check) check_dependencies ;;
  moonlight) install_moonlight ;;
  microphone) install_microphone ;;
  kde-connect) install_kde_connect ;;
  all) install_moonlight; install_microphone; install_kde_connect ;;
  show) show ;;
esac
