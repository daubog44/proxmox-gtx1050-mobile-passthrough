#!/usr/bin/env bash
# Send a Fedora client's PipeWire/Pulse microphone to Omarchy only while the
# guest asks for it. SSH carries the small active/idle control stream; RTP/Opus
# carries audio. No password, address or device is embedded in this script.
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
config_file="$repo_root/config/omarchy.env"
mode=''

die() { printf 'Errore: %s\n' "$*" >&2; exit 1; }
note() { printf '==> %s\n' "$*"; }

usage() {
  cat <<'EOF'
Uso:
  voxtype-fedora-mic-rtp.sh --config FILE --watch
  voxtype-fedora-mic-rtp.sh --config FILE --install-key
  voxtype-fedora-mic-rtp.sh --config FILE --list-sources
  voxtype-fedora-mic-rtp.sh --config FILE --show

Il watcher non apre mai il microfono finche' Moonlight non e' collegato alla
VM e la VM non emette `active` (PTT VoxType o un client PipeWire come Discord).
EOF
}

while (( $# )); do
  case "$1" in
    --config) (( $# >= 2 )) || die '--config richiede un file'; config_file=$2; shift 2 ;;
    --watch) mode=watch; shift ;;
    --install-key) mode=install-key; shift ;;
    --list-sources) mode=list-sources; shift ;;
    --show) mode=show; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "opzione sconosciuta: $1" ;;
  esac
done
[[ -n "$mode" ]] || { usage >&2; exit 2; }

command -v pactl >/dev/null || die 'pactl mancante: installa PipeWire Pulse sul client Fedora'
if [[ "$mode" == list-sources ]]; then
  pactl list short sources
  exit 0
fi

[[ -f "$config_file" ]] || die "configurazione mancante: $config_file"
# The configuration is a local file managed by the client owner, just as for
# the existing PVE/guest CLI. It is deliberately not accepted from the network.
# shellcheck disable=SC1090
source "$config_file"
: "${OMARCHY_USER:?OMARCHY_USER mancante}"
: "${OMARCHY_VM_HOST:?OMARCHY_VM_HOST mancante}"
: "${OMARCHY_VM_ADDRESS:?OMARCHY_VM_ADDRESS mancante}"
: "${OMARCHY_CLIENT_ADDRESS:?OMARCHY_CLIENT_ADDRESS mancante}"
: "${OMARCHY_RTP_PORT:?OMARCHY_RTP_PORT mancante}"
[[ "$OMARCHY_RTP_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( OMARCHY_RTP_PORT <= 65535 )) || die 'OMARCHY_RTP_PORT non valida'

source_name="${OMARCHY_FEDORA_MIC_SOURCE:-@DEFAULT_SOURCE@}"
key_path="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/voxtype-omarchy_ed25519"

show() {
  printf '%-18s %s\n' \
    'Configurazione:' "$config_file" \
    'VM SSH:' "$OMARCHY_USER@$OMARCHY_VM_HOST" \
    'VM RTP:' "$OMARCHY_VM_ADDRESS:$OMARCHY_RTP_PORT/udp" \
    'IP client:' "$OMARCHY_CLIENT_ADDRESS" \
    'Sorgente Pulse:' "$source_name" \
    'Chiave dedicata:' "$key_path"
}

install_key() {
  command -v ssh >/dev/null || die 'ssh mancante: installa openssh-clients'
  command -v ssh-keygen >/dev/null || die 'ssh-keygen mancante: installa openssh-clients'
  install -d -m 0700 "$(dirname "$key_path")"
  if [[ ! -f "$key_path" ]]; then
    ssh-keygen -q -t ed25519 -f "$key_path" -N '' -C 'voxtype-fedora-mic-rtp'
  fi
  local public_key remote_line encoded remote_command
  public_key="$(<"$key_path.pub")"
  remote_line="restrict,command=\"/home/$OMARCHY_USER/.local/bin/voxtype-remote-mic-ssh-dispatch\" $public_key"
  encoded="$(printf %s "$remote_line" | base64 -w 0)"
  remote_command="umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; line=\$(printf %s '$encoded' | base64 -d); grep -qxF \"\$line\" ~/.ssh/authorized_keys || printf '%s\\n' \"\$line\" >> ~/.ssh/authorized_keys"
  note 'inserisci una sola volta la password SSH della VM per autorizzare la chiave dedicata del client Fedora'
  ssh -tt "$OMARCHY_USER@$OMARCHY_VM_HOST" "$remote_command"
  note 'chiave installata: puo eseguire solo il dispatcher microfono active/idle nella VM'
}

moonlight_connected() {
  # The Flatpak process can have different helper names across releases, so
  # inspect both the Moonlight command line and an actual VM network peer.
  pgrep -f '[m]oonlight' >/dev/null || return 1
  ss -H -tnu 2>/dev/null | grep -Fq -- "$OMARCHY_VM_ADDRESS"
}

rtp_pid=''
control_pid=''
control_dir=''
control_fd=''

stop_pid() {
  local pid=${1:-}
  [[ -n "$pid" ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  stop_pid "$rtp_pid"
  stop_pid "$control_pid"
  [[ -n "$control_fd" ]] && eval "exec ${control_fd}<&-" || true
  [[ -n "$control_dir" ]] && rm -rf -- "$control_dir"
  rtp_pid=''
  control_pid=''
  control_dir=''
  control_fd=''
}
trap cleanup EXIT HUP INT TERM

start_rtp() {
  if [[ -n "$rtp_pid" ]] && kill -0 "$rtp_pid" 2>/dev/null; then
    return 0
  fi
  command -v ffmpeg >/dev/null || die 'ffmpeg mancante: esegui il modulo Fedora Microphone'
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -Eq '[[:space:]]libopus([[:space:]]|$)' || die 'questo FFmpeg non include l encoder libopus; installa un build Fedora con libopus e riprova'
  note "microfono Fedora aperto: $source_name -> $OMARCHY_VM_ADDRESS:$OMARCHY_RTP_PORT"
  ffmpeg -hide_banner -nostdin -loglevel warning \
    -thread_queue_size 16 -f pulse -i "$source_name" \
    -ac 1 -ar 16000 -c:a libopus -application lowdelay -frame_duration 20 \
    -b:a 24k -vbr off -payload_type 111 -f rtp \
    "rtp://$OMARCHY_VM_ADDRESS:$OMARCHY_RTP_PORT?pkt_size=1200" &
  rtp_pid=$!
}

stop_rtp() {
  [[ -z "$rtp_pid" ]] || note 'microfono Fedora chiuso'
  stop_pid "$rtp_pid"
  rtp_pid=''
}

run_session() {
  control_dir="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/omarchy-voxtype-control.XXXXXX")"
  local fifo="$control_dir/control"
  mkfifo "$fifo"
  ssh -T -i "$key_path" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o ConnectTimeout=10 -o ConnectionAttempts=1 \
    "$OMARCHY_USER@$OMARCHY_VM_HOST" voxtype-remote-mic-control-follow >"$fifo" 2>"$control_dir/stderr" &
  control_pid=$!
  exec {control_fd}<"$fifo"

  local line
  while moonlight_connected; do
    if IFS= read -r -t 2 line <&"$control_fd"; then
      case "$line" in
        active) start_rtp ;;
        idle) stop_rtp ;;
      esac
    elif ! kill -0 "$control_pid" 2>/dev/null; then
      cat "$control_dir/stderr" >&2 || true
      return 1
    fi
  done
  cleanup
}

case "$mode" in
  install-key) install_key ;;
  show) show ;;
  watch)
    command -v ssh >/dev/null || die 'ssh mancante: installa openssh-clients'
    command -v ss >/dev/null || die 'ss mancante: installa iproute'
    [[ -f "$key_path" ]] || die "chiave mancante: $key_path (esegui prima --install-key)"
    while true; do
      if moonlight_connected; then
        run_session || { sleep 2; continue; }
      fi
      sleep 1
    done
    ;;
esac
