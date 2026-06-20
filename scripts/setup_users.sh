#!/usr/bin/env bash
# ==============================================================================
# WindWatch Cloud VM User & Group Provisioning Script
# This script sets up system-level administrators, managers, and operators
# with proper groups, directory structures, and service restart permissions.
# ==============================================================================

set -euo pipefail

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] ERROR: This script must be run as root (sudo)." >&2
  exit 1
fi

echo "[+] Initializing WindWatch User and Directory Provisioning..."

# 1. Define groups and users
GROUPS=("windwatch_admin" "windwatch_manager" "windwatch_operator")
declare -A USERS=(
  ["ww_admin"]="windwatch_admin"
  ["ww_manager"]="windwatch_manager"
  ["ww_operator"]="windwatch_operator"
)

# Create groups if they don't exist
for group in "${GROUPS[@]}"; do
  if getent group "$group" >/dev/null; then
    echo "[*] Group '$group' already exists. Skipping creation."
  else
    groupadd "$group"
    echo "[+] Created group: $group"
  fi
done

# Create users, assign to their respective primary group, and add shell
for user in "${!USERS[@]}"; do
  primary_group="${USERS[$user]}"
  
  if id "$user" >/dev/null 2>&1; then
    echo "[*] User '$user' already exists. Updating groups."
    usermod -g "$primary_group" "$user"
  else
    useradd -m -g "$primary_group" -s /bin/bash "$user"
    echo "[+] Created user: $user (Group: $primary_group)"
    # Set a dummy default password (force change on first login in real setup)
    echo "$user:WindWatchTemporaryPass2026!" | chpasswd
  fi
done

# 2. Configure Directory Structures & Permissions
WWW_DIR="/var/www/windwatch"
LOG_DIR="/var/log/windwatch"
BACKUP_DIR="/var/backups/windwatch"

echo "[+] Configuring directory permissions..."

# Create directories
mkdir -p "$WWW_DIR" "$LOG_DIR" "$BACKUP_DIR"

# Assign directory ownership:
# - Web root: Admins can modify everything; Managers can read/write; Operators can read.
chown -R ww_admin:windwatch_manager "$WWW_DIR"
chmod -R 775 "$WWW_DIR"

# - Log directory: Operators and Managers can read, app processes can write.
chown -R ww_admin:windwatch_operator "$LOG_DIR"
chmod -R 770 "$LOG_DIR"

# - Backup directory: Admin access only
chown -R ww_admin:windwatch_admin "$BACKUP_DIR"
chmod -R 700 "$BACKUP_DIR"

# Set GID bit on directories so new files inherit the group
chmod g+s "$WWW_DIR" "$LOG_DIR"

# 3. Configure Sudo Rights (Passwordless service management for Admins/Managers)
SUDOERS_FILE="/etc/sudoers.d/windwatch"
echo "[+] Configuring secure sudo permissions in $SUDOERS_FILE..."

cat << 'EOF' > "$SUDOERS_FILE"
# WindWatch sudoers configuration
# Allow administrators to run all commands as any user
%windwatch_admin ALL=(ALL:ALL) ALL

# Allow managers to check status and restart Nginx/Docker services without password
%windwatch_manager ALL=(ALL) NOPASSWD: /usr/bin/systemctl status nginx, /usr/bin/systemctl restart nginx, /usr/bin/systemctl status docker, /usr/bin/systemctl restart docker

# Allow operators to check system logs and service status
%windwatch_operator ALL=(ALL) NOPASSWD: /usr/bin/systemctl status nginx, /usr/bin/systemctl status docker, /usr/bin/journalctl -u nginx --no-pager
EOF

chmod 440 "$SUDOERS_FILE"

echo "[+] User and permission setup completed successfully."
echo "[i] Default Users created: ww_admin, ww_manager, ww_operator"
echo "[i] Root directory set to: $WWW_DIR"
