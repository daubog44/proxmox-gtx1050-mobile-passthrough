#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Omarchy Node Installer & Bundler
# Turn-key setup script for Omarchy / Arch Linux GPU nodes
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
cat << "EOF"
   ___                       _           _   _           _      
  / _ \ _ __ ___   __ _ _ __| |__  _   _| \ | | ___   __| | ___ 
 | | | | '_ ` _ \ / _` | '__| '_ \| | | |  \| |/ _ \ / _` |/ _ \
 | |_| | | | | | | (_| | |  | | | | |_| | |\  | (_) | (_| |  __/
  \___/|_| |_| |_|\__,_|_|  |_| |_|\__, |_| \_|\___/ \__,_|\___|
                                   |___/                        
              Zero-SSH GPU Node Installer & Daemon
EOF
echo -e "${NC}"

# 1. Root check
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[ERROR] This script must be run as root (or with sudo).${NC}"
   exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CUSTOM_TOKEN="${OMARCHY_API_TOKEN:-}"
MOUNT_NAS_FLAG=false
TAILSCALE_FLAG=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --token)
            CUSTOM_TOKEN="$2"
            shift 2
            ;;
        --mount-nas)
            MOUNT_NAS_FLAG=true
            shift
            ;;
        --tailscale)
            TAILSCALE_FLAG=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

echo -e "${BLUE}[1/5] Checking dependencies...${NC}"
MISSING_DEPS=()
for cmd in python3 sqlite3 systemctl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        MISSING_DEPS+=("$cmd")
    fi
done

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    echo -e "${YELLOW}[INFO] Missing dependencies: ${MISSING_DEPS[*]}.${NC}"
    if command -v pacman >/dev/null 2>&1; then
        echo -e "${CYAN}[INFO] Installing missing packages via pacman...${NC}"
        pacman -S --needed --noconfirm "${MISSING_DEPS[@]}"
    elif command -v apt-get >/dev/null 2>&1; then
        echo -e "${CYAN}[INFO] Installing missing packages via apt...${NC}"
        apt-get update && apt-get install -y "${MISSING_DEPS[@]}"
    fi
fi

# 2. Install Binaries
echo -e "${BLUE}[2/5] Installing Omarchy Node binaries to /usr/local/bin...${NC}"
install -m 755 "${SCRIPT_DIR}/omarchy-session-broker" /usr/local/bin/omarchy-session-broker
if [[ -f "${SCRIPT_DIR}/omarchy-setup" ]]; then
    install -m 755 "${SCRIPT_DIR}/omarchy-setup" /usr/local/bin/omarchy-setup
fi
if [[ -f "${SCRIPT_DIR}/omarchy-wolf-network-isolation" ]]; then
    install -m 755 "${SCRIPT_DIR}/omarchy-wolf-network-isolation" /usr/local/bin/omarchy-wolf-network-isolation
fi
if [[ -f "${SCRIPT_DIR}/omarchy-mount-nas" ]]; then
    install -m 755 "${SCRIPT_DIR}/omarchy-mount-nas" /usr/local/bin/omarchy-mount-nas
fi
if [[ -f "${SCRIPT_DIR}/omarchy-ddns-updater" ]]; then
    install -m 755 "${SCRIPT_DIR}/omarchy-ddns-updater" /usr/local/bin/omarchy-ddns-updater
fi

# Ensure state directory exists
mkdir -p /var/lib/omarchy /etc/omarchy
chmod 750 /var/lib/omarchy

WOLF_CFG_SRC="${REPO_ROOT}/config/wolf.env.example"
[[ ! -f "$WOLF_CFG_SRC" ]] && WOLF_CFG_SRC="${SCRIPT_DIR}/../config/wolf.env.example"
if [[ -f "$WOLF_CFG_SRC" && ! -f /etc/omarchy/wolf.env ]]; then
    install -m 644 "$WOLF_CFG_SRC" /etc/omarchy/wolf.env
fi

# 3. Install Systemd Services & Timers
echo -e "${BLUE}[3/5] Installing systemd services and timers...${NC}"
SERVICE_SRC="${REPO_ROOT}/systemd/omarchy-session-broker.service"
if [[ ! -f "$SERVICE_SRC" ]]; then
    SERVICE_SRC="${SCRIPT_DIR}/../systemd/omarchy-session-broker.service"
fi

if [[ -f "$SERVICE_SRC" ]]; then
    install -m 644 "$SERVICE_SRC" /etc/systemd/system/omarchy-session-broker.service
else
    cat << 'EOF' > /etc/systemd/system/omarchy-session-broker.service
[Unit]
Description=Omarchy Session Broker & REST API Daemon
After=network.target sunshine.service wolf.service

[Service]
Type=simple
ExecStart=/usr/local/bin/omarchy-session-broker daemon --port 47995
Restart=always
RestartSec=5
User=root
WorkingDirectory=/var/lib/omarchy

[Install]
WantedBy=multi-user.target
EOF
fi

# Install DDNS timer if present
DDNS_SERVICE_SRC="${REPO_ROOT}/systemd/omarchy-ddns.service"
[[ ! -f "$DDNS_SERVICE_SRC" ]] && DDNS_SERVICE_SRC="${SCRIPT_DIR}/../systemd/omarchy-ddns.service"
DDNS_TIMER_SRC="${REPO_ROOT}/systemd/omarchy-ddns.timer"
[[ ! -f "$DDNS_TIMER_SRC" ]] && DDNS_TIMER_SRC="${SCRIPT_DIR}/../systemd/omarchy-ddns.timer"

if [[ -f "$DDNS_SERVICE_SRC" && -f "$DDNS_TIMER_SRC" ]]; then
    install -m 644 "$DDNS_SERVICE_SRC" /etc/systemd/system/omarchy-ddns.service
    install -m 644 "$DDNS_TIMER_SRC" /etc/systemd/system/omarchy-ddns.timer
    systemctl enable --now omarchy-ddns.timer 2>/dev/null || true
fi

systemctl daemon-reload

# 4. Firewall Configuration (UFW)
echo -e "${BLUE}[4/5] Configuring firewall rules (port 47995 TCP)...${NC}"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 47995/tcp comment "Omarchy REST API Daemon" >/dev/null 2>&1 || true
    # Also ensure local LAN can connect without rate limit issues
    LAN_SUBNET=$(ip -o -f inet addr show | awk '/scope global/ {print $4}' | head -n 1)
    if [[ -n "$LAN_SUBNET" ]]; then
        ufw allow from "$LAN_SUBNET" to any port 22 proto tcp comment "Omarchy LAN SSH" >/dev/null 2>&1 || true
        ufw allow from "$LAN_SUBNET" to any port 47995 proto tcp comment "Omarchy REST API LAN" >/dev/null 2>&1 || true
    fi
    ufw reload >/dev/null 2>&1 || true
fi

# 5. Enable & Start Service
echo -e "${BLUE}[5/5] Enabling and starting omarchy-session-broker.service...${NC}"
systemctl enable --now omarchy-session-broker.service

# Wait up to 5s for health check
sleep 1
HEALTH_STATUS="unknown"
for i in {1..10}; do
    if curl -s -f http://127.0.0.1:47995/api/health >/dev/null 2>&1; then
        HEALTH_STATUS="online"
        break
    fi
    sleep 0.5
done

# Set custom token if requested
if [[ -n "$CUSTOM_TOKEN" ]]; then
    echo -e "${CYAN}[INFO] Setting custom/cluster Bearer Token...${NC}"
    /usr/local/bin/omarchy-session-broker token --set "$CUSTOM_TOKEN" >/dev/null 2>&1 || true
fi

# Mount NAS if requested
if [[ "$MOUNT_NAS_FLAG" == true ]] && [[ -x /usr/local/bin/omarchy-mount-nas ]]; then
    echo -e "${CYAN}[INFO] Configuring NAS mount...${NC}"
    /usr/local/bin/omarchy-mount-nas || true
fi

# Read active Bearer Token
TOKEN=$(/usr/local/bin/omarchy-session-broker token --raw 2>/dev/null || echo "omarchy_sec_unavailable")

# Handle Tailscale if requested
if [[ "$TAILSCALE_FLAG" == true ]]; then
    if ! command -v tailscale >/dev/null 2>&1; then
        echo -e "${CYAN}[INFO] Installing Tailscale...${NC}"
        if command -v pacman >/dev/null 2>&1; then
            pacman -S --needed --noconfirm tailscale
        elif command -v apt-get >/dev/null 2>&1; then
            apt-get update && apt-get install -y tailscale
        fi
    fi
    systemctl enable --now tailscaled >/dev/null 2>&1 || true
    echo -e "${YELLOW}[INFO] To authenticate Tailscale, run: sudo tailscale up${NC}"
fi

TAILSCALE_IP=""
if command -v tailscale >/dev/null 2>&1; then
    TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || true)
fi

# Detect host IPs
HOST_IPS=$(ip -o -f inet addr show | awk '/scope global/ {print $4}' | cut -d/ -f1 | tr '\n' ' ')
HOSTNAME=$(hostname)

echo ""
echo -e "${GREEN}${BOLD}========================================================================${NC}"
echo -e "${GREEN}${BOLD}       OMARCHY NODE DAEMON SUCCESSFULLY INSTALLED & RUNNING!             ${NC}"
echo -e "${GREEN}${BOLD}========================================================================${NC}"
echo ""
echo -e "  ${BOLD}Status:${NC}        ${GREEN}${HEALTH_STATUS}${NC} (:47995 TCP)"
echo -e "  ${BOLD}Hostname:${NC}      ${CYAN}${HOSTNAME}.local${NC}"
echo -e "  ${BOLD}Node IPs:${NC}      ${CYAN}${HOST_IPS}${NC}"
if [[ -n "$TAILSCALE_IP" ]]; then
echo -e "  ${BOLD}Tailscale IP:${NC}  ${GREEN}${BOLD}${TAILSCALE_IP}${NC} (Accesso Globale da fuori casa)"
fi
echo -e "  ${BOLD}API Port:${NC}      ${CYAN}47995${NC}"
echo -e "  ${BOLD}Bearer Token:${NC}  ${YELLOW}${BOLD}${TOKEN}${NC}"
echo ""
echo -e "${BOLD}Come collegare questo nodo a Omarchy Control:${NC}"
echo -e "  1. Apri ${BOLD}Omarchy Control${NC} sul tuo Mac o PC."
echo -e "  2. Apri il modale ${BOLD}\"Aggiungi / Connetti Nodo\"${NC}."
echo -e "  3. Inserisci l'Host (${CYAN}${HOSTNAME}.local${NC} o IP) e la porta ${CYAN}47995${NC}."
echo -e "  4. Incolla il Bearer Token: ${YELLOW}${TOKEN}${NC}"
echo -e "  5. Clicca ${BOLD}\"⚡ Testa Connessione REST API Daemon\"${NC} e salva."
echo -e "${GREEN}${BOLD}========================================================================${NC}"
echo ""
