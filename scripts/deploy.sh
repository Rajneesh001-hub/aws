#!/usr/bin/env bash
# ==============================================================================
# WindWatch Web Server Deployment & Lifecycle Automation Script
# Configures Nginx virtual hosts, deploys web files, verifies configurations,
# and restarts systemd services securely.
# ==============================================================================

set -euo pipefail

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] ERROR: This script must be run as root (sudo)." >&2
  exit 1
fi

echo "[+] Starting WindWatch web services deployment..."

# 1. Update packages and install Nginx
echo "[+] Checking and installing Nginx..."
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx curl git
  echo "[+] Nginx installed successfully."
else
  echo "[*] Nginx is already installed. Version: $(nginx -v 2>&1)"
fi

# 2. Deploy application files
WWW_DIR="/var/www/windwatch"
echo "[+] Deploying web assets to $WWW_DIR..."
mkdir -p "$WWW_DIR"

# Simulating copying files from repository
# In a real environment: git clone/pull or scp copy would happen here
# For our demo, we generate a basic index index file if it does not exist
if [ ! -f "$WWW_DIR/index.html" ]; then
  cat << 'EOF' > "$WWW_DIR/index.html"
<!DOCTYPE html>
<html>
<head>
    <title>WindWatch Node Active</title>
    <style>
        body { font-family: sans-serif; background: #0b0f19; color: #10b981; text-align: center; padding-top: 15%; }
        h1 { font-size: 3rem; }
    </style>
</head>
<body>
    <h1>WindWatch Operational Node</h1>
    <p>VM status: ONLINE. Telemetry sync ACTIVE.</p>
</body>
</html>
EOF
fi

# Set proper permissions for Nginx user (www-data) to read files
chown -R www-data:www-data "$WWW_DIR"
chmod -R 755 "$WWW_DIR"

# 3. Configure Nginx Virtual Host
NGINX_CONF_PATH="/etc/nginx/sites-available/windwatch"
NGINX_ENABLED_PATH="/etc/nginx/sites-enabled/windwatch"

echo "[+] Writing Nginx configuration..."
cat << 'EOF' > "$NGINX_CONF_PATH"
server {
    listen 80;
    listen [::]:80;
    server_name windwatch.local www.windwatch.local;

    root /var/www/windwatch;
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }

    # API Proxy configuration
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Custom logs
    access_log /var/log/nginx/windwatch_access.log;
    error_log /var/log/nginx/windwatch_error.log;

    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
EOF

# Enable site by linking to sites-enabled
if [ ! -f "$NGINX_ENABLED_PATH" ]; then
  ln -sf "$NGINX_CONF_PATH" "$NGINX_ENABLED_PATH"
fi

# Disable default nginx configuration to prevent conflict if requested
if [ -f "/etc/nginx/sites-enabled/default" ]; then
  rm -f "/etc/nginx/sites-enabled/default"
  echo "[+] Disabled default Nginx config."
fi

# 4. Test Nginx Configuration and restart service
echo "[+] Validating Nginx configuration syntax..."
if nginx -t; then
  echo "[+] Configuration is valid. Restarting Nginx daemon..."
  systemctl restart nginx
  systemctl enable nginx
  echo "[+] Nginx service restarted and enabled on system boot."
else
  echo "[-] ERROR: Nginx configuration check failed. Aborting." >&2
  exit 1
fi

# 5. Firewall configuration (UFW check)
if command -v ufw >/dev/null 2>&1; then
  echo "[+] UFW is installed. Allowing HTTP web traffic..."
  ufw allow 'Nginx HTTP'
  ufw reload
fi

# 6. Verify health status
echo "[+] Verifying web service health status..."
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost || true)
if [ "$STATUS_CODE" -eq 200 ]; then
  echo "[+] Deployment verification succeeded! HTTP Status: 200 OK"
else
  echo "[!] Warning: Received HTTP Status code: $STATUS_CODE. Please review /var/log/nginx/windwatch_error.log"
fi

echo "[+] WindWatch deployment script executed successfully."
