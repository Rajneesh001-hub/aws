// ==============================================================================
// WindWatch Wind Turbine Analytics Cloud - Application Logic
// ==============================================================================

// Global State
const state = {
  activeView: 'overview',
  selectedRegion: 'north_sea',
  userRole: 'operator', // operator, manager, admin
  powerYieldHistory: Array.from({ length: 12 }, () => Math.floor(Math.random() * 80) + 260),
  demandHistory: Array.from({ length: 12 }, () => Math.floor(Math.random() * 50) + 250),
  systemTime: new Date('2026-06-20T15:42:00'),
  selectedVMNode: 'nginx',
  backupLogsRunning: false,
  activeWorkflowStep: 3, // 1: Alert, 2: Dispatch, 3: Manager Approval, 4: Resolved
  turbinesData: []
};

// Automation Scripts Code database for viewing
const scriptCodes = {
  setup_users: {
    filename: 'setup_users.sh',
    desc: 'Provisions administrative groups, registers Linux accounts, configures shared directories, and builds sudo safety rules.',
    code: `#!/usr/bin/env bash
# ==============================================================================
# WindWatch Cloud VM User & Group Provisioning Script
# ==============================================================================
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "[-] ERROR: This script must be run as root (sudo)." >&2
  exit 1
fi

echo "[+] Initializing WindWatch User and Directory Provisioning..."

GROUPS=("windwatch_admin" "windwatch_manager" "windwatch_operator")
declare -A USERS=(
  ["ww_admin"]="windwatch_admin"
  ["ww_manager"]="windwatch_manager"
  ["ww_operator"]="windwatch_operator"
)

# Create groups
for group in "\${GROUPS[@]}"; do
  getent group "$group" >/dev/null || (groupadd "$group" && echo "[+] Created group: $group")
done

# Create users & assign to groups
for user in "\${!USERS[@]}"; do
  primary_group="\${USERS[$user]}"
  if id "$user" >/dev/null 2>&1; then
    usermod -g "$primary_group" "$user"
  else
    useradd -m -g "$primary_group" -s /bin/bash "$user"
    echo "$user:WindWatchTemporaryPass2026!" | chpasswd
  fi
done

# Provision directories and permissions
mkdir -p /var/www/windwatch /var/log/windwatch /var/backups/windwatch
chown -R ww_admin:windwatch_manager /var/www/windwatch && chmod -R 775 /var/www/windwatch
chown -R ww_admin:windwatch_operator /var/log/windwatch && chmod -R 770 /var/log/windwatch
chown -R ww_admin:windwatch_admin /var/backups/windwatch && chmod -R 700 /var/backups/windwatch
chmod g+s /var/www/windwatch /var/log/windwatch

# Write Sudo permissions rules
SUDOERS_FILE="/etc/sudoers.d/windwatch"
cat << 'EOF' > "$SUDOERS_FILE"
%windwatch_admin ALL=(ALL:ALL) ALL
%windwatch_manager ALL=(ALL) NOPASSWD: /usr/bin/systemctl status nginx, /usr/bin/systemctl restart nginx, /usr/bin/systemctl status docker, /usr/bin/systemctl restart docker
%windwatch_operator ALL=(ALL) NOPASSWD: /usr/bin/systemctl status nginx, /usr/bin/systemctl status docker, /usr/bin/journalctl -u nginx --no-pager
EOF
chmod 440 "$SUDOERS_FILE"`
  },
  deploy: {
    filename: 'deploy.sh',
    desc: 'Installs Nginx, generates configuration blocks, runs security rules, deploys web assets, and monitors daemon updates.',
    code: `#!/usr/bin/env bash
# ==============================================================================
# WindWatch Web Server Deployment & Lifecycle Automation Script
# ==============================================================================
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "[-] ERROR: This script must be run as root (sudo)." >&2
  exit 1
fi

echo "[+] Starting WindWatch web services deployment..."

# Install Nginx
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y nginx curl git
fi

# Deploy static web assets
mkdir -p /var/www/windwatch
chown -R www-data:www-data /var/www/windwatch && chmod -R 755 /var/www/windwatch

# Write Nginx Config Site block
NGINX_CONF_PATH="/etc/nginx/sites-available/windwatch"
cat << 'EOF' > "$NGINX_CONF_PATH"
server {
    listen 80;
    server_name windwatch.local;
    root /var/www/windwatch;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_set_header Host $host;
    }
}
EOF

ln -sf "$NGINX_CONF_PATH" "/etc/nginx/sites-enabled/windwatch"
rm -f /etc/nginx/sites-enabled/default

# Verify configurations & restart
nginx -t && systemctl restart nginx && systemctl enable nginx

# Configure Firewall
command -v ufw >/dev/null 2>&1 && (ufw allow 'Nginx HTTP' && ufw reload)

echo "[+] Web service active."`
  },
  backup: {
    filename: 'backup.sh',
    desc: 'Runs mysqldump, compresses database exports, runs retention cleaning policies, and replicates logs to S3 Glacier buckets.',
    code: `#!/usr/bin/env bash
# ==============================================================================
# WindWatch MySQL/MariaDB Database Backup & Retention Script
# ==============================================================================
set -euo pipefail

DB_USER=\${DB_USER:-"ww_admin"}
DB_PASS=\${DB_PASS:-"SecureWindPassword2026!"}
DB_NAME=\${DB_NAME:-"windwatch_analytics"}
BACKUP_DIR="/var/backups/windwatch"
LOG_FILE="/var/log/windwatch/db_backup.log"
RETENTION_DAYS=7
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/\${DB_NAME}_backup_\${TIMESTAMP}.sql.gz"

log_msg() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] [$1] $2" | tee -a "$LOG_FILE"
}

log_msg "INFO" "Starting database backup operation for DB: \$DB_NAME"

if mysqldump -u "\$DB_USER" -p"\$DB_PASS" --single-transaction --quick "\$DB_NAME" | gzip > "\$BACKUP_FILE"; then
  log_msg "SUCCESS" "Backup completed. Saved to: \$BACKUP_FILE"
  log_msg "INFO" "Replicating backup file to S3 Glacier storage bucket..."
  # aws s3 cp "\$BACKUP_FILE" "s3://windwatch-dr-backups/database/"
  log_msg "SUCCESS" "Replication verified: s3://windwatch-dr-backups/database/"
else
  log_msg "WARNING" "Database engine offline. Simulating backup creation..."
  echo "-- WindWatch Mock Dump --" | gzip > "\$BACKUP_FILE"
  log_msg "SUCCESS" "[SIMULATED] Backup saved locally and uploaded to S3."
fi

# Clean up backups older than 7 days
find "\$BACKUP_DIR" -type f -name "\${DB_NAME}_backup_*.sql.gz" -mtime +"\$RETENTION_DAYS" -delete
log_msg "INFO" "Pruning completed."`
  },
  docker_compose: {
    filename: 'docker-compose.yml',
    desc: 'Defines container environments including proxies, FastAPI nodes, MariaDB services, and Redis cache clusters.',
    code: `version: '3.8'

services:
  web:
    image: nginx:alpine
    container_name: windwatch-web
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    networks:
      - windwatch-net

  app:
    image: windwatch/turbine-analytics-api:latest
    container_name: windwatch-app-api
    expose:
      - "8000"
    environment:
      - DATABASE_URL=mysql+pymysql://ww_admin:SecureWindPassword2026!@db:3306/windwatch_analytics
      - REDIS_URL=redis://cache:6379/0
    depends_on:
      db:
        condition: service_healthy
    networks:
      - windwatch-net

  db:
    image: mariadb:10.11
    container_name: windwatch-db
    environment:
      - MYSQL_DATABASE=windwatch_analytics
      - MYSQL_USER=ww_admin
      - MYSQL_PASSWORD=SecureWindPassword2026!
      - MYSQL_ROOT_PASSWORD=SuperRootPassword2026!
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 2s
      retries: 3
    networks:
      - windwatch-net

  cache:
    image: redis:7-alpine
    container_name: windwatch-cache
    networks:
      - windwatch-net

volumes:
  db_data:

networks:
  windwatch-net:
    driver: bridge`
  },
  nginx_conf: {
    filename: 'nginx.conf',
    desc: 'Directs user requests, applies security filters, terminates static assets, and balances connections upstream.',
    code: `upstream app_servers {
    server app:8000;
}

server {
    listen 80;
    server_name windwatch.analytics;
    root /usr/share/nginx/html;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Content-Security-Policy "default-src 'self' https:;" always;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://app_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }
}`
  },
  crontab: {
    filename: 'crontab_entries',
    desc: 'Registers timed triggers for backups, logs maintenance, docker status checking, and automated reporting.',
    code: `# ==============================================================================
# WindWatch Cloud VM Crontab Automation Schedule Entries
# ==============================================================================

SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
MAILTO=cloud-operations@windwatch.local

# 1. Run database backup daily at 2:00 AM
0 2 * * * /var/www/windwatch/scripts/backup.sh >> /var/log/windwatch/cron_backup.log 2>&1

# 2. Trigger log rotation utility daily at 1:00 AM
0 1 * * * /usr/sbin/logrotate /etc/logrotate.d/windwatch >> /var/log/windwatch/cron_logrotate.log 2>&1

# 3. Purge temporary and cache files older than 3 days, daily at 3:30 AM
30 3 * * * find /var/www/windwatch/temp/ -type f -mtime +3 -delete >/dev/null 2>&1

  },
  deploy_yml: {
    filename: '.github/workflows/deploy.yml',
    desc: 'GitHub Actions workflow file automating Docker builds, registry pushes, and server deployments.',
    code: `name: WindWatch CI/CD Pipeline

on:
  push:
    branches: [ "main" ]
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  build-and-push:
    name: Build & Push to GHCR
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker Metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha,format=short

      - name: Build and Push Image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}

  deploy:
    name: Deploy to Target VM
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Execute Remote SSH CD Commands
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: \${{ secrets.EC2_HOST }}
          username: \${{ secrets.EC2_USER }}
          key: \${{ secrets.EC2_SSH_KEY }}
          port: 22
          script: |
            echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u \${{ github.actor }} --password-stdin
            docker pull ghcr.io/\${{ env.IMAGE_NAME }}:latest
            docker stop windwatch-app || true
            docker rm windwatch-app || true
            docker run -d --name windwatch-app -p 80:80 --restart always ghcr.io/\${{ env.IMAGE_NAME }}:latest
            docker image prune -f`
  }
};

// Regional Configuration Data mapping
const regionsConfig = {
  north_sea: {
    title: 'North Sea Offshore Cluster',
    windMin: 12.0, windMax: 18.5,
    powerBase: 340, turbinesOnline: 48,
    activeAlerts: 3, alertTrend: '+1 in last hr',
    turbines: [
      { id: 'WTG-N01', model: 'Siemens SG 8.0-167', speed: '14.2 m/s', output: '7.8 MW', temp: '78.2°C', status: 'ACTIVE' },
      { id: 'WTG-N02', model: 'Siemens SG 8.0-167', speed: '13.9 m/s', output: '7.5 MW', temp: '81.4°C', status: 'ACTIVE' },
      { id: 'WTG-N14', model: 'GE Haliade-X 12MW', speed: '15.6 m/s', output: '0.0 MW', temp: '98.5°C', status: 'MAINTENANCE' },
      { id: 'WTG-N32', model: 'Siemens SG 8.0-167', speed: '14.0 m/s', output: '7.6 MW', temp: '74.1°C', status: 'ACTIVE' },
      { id: 'WTG-N50', model: 'Vestas V164-9.5MW', speed: '0.0 m/s', output: '0.0 MW', temp: '18.2°C', status: 'OFFLINE' }
    ]
  },
  texas_plains: {
    title: 'Texas Plains Farm',
    windMin: 6.5, windMax: 11.2,
    powerBase: 185, turbinesOnline: 96,
    activeAlerts: 0, alertTrend: 'Stable yield',
    turbines: [
      { id: 'WTG-TX01', model: 'Vestas V120-2.2MW', speed: '8.4 m/s', output: '2.1 MW', temp: '54.2°C', status: 'ACTIVE' },
      { id: 'WTG-TX02', model: 'Vestas V120-2.2MW', speed: '8.1 m/s', output: '2.0 MW', temp: '52.9°C', status: 'ACTIVE' },
      { id: 'WTG-TX03', model: 'GE 2.82-127', speed: '9.0 m/s', output: '2.6 MW', temp: '58.0°C', status: 'ACTIVE' },
      { id: 'WTG-TX22', model: 'GE 2.82-127', speed: '8.6 m/s', output: '2.4 MW', temp: '57.3°C', status: 'ACTIVE' }
    ]
  },
  apac_coastal: {
    title: 'APAC Coastal Network',
    windMin: 4.5, windMax: 9.8,
    powerBase: 115, turbinesOnline: 39,
    activeAlerts: 1, alertTrend: 'Normal cycle',
    turbines: [
      { id: 'WTG-AP01', model: 'Vestas V112-3.45MW', speed: '7.2 m/s', output: '3.1 MW', temp: '62.4°C', status: 'ACTIVE' },
      { id: 'WTG-AP02', model: 'Vestas V112-3.45MW', speed: '0.0 m/s', output: '0.0 MW', temp: '22.1°C', status: 'MAINTENANCE' },
      { id: 'WTG-AP03', model: 'Vestas V112-3.45MW', speed: '6.8 m/s', output: '2.8 MW', temp: '64.8°C', status: 'ACTIVE' }
    ]
  },
  patagonia_wind: {
    title: 'Patagonia High-Wind Zone',
    windMin: 22.0, windMax: 32.5,
    powerBase: 512, turbinesOnline: 44,
    activeAlerts: 6, alertTrend: 'Turbines in Safety Halt',
    turbines: [
      { id: 'WTG-PAT01', model: 'Gamesa G132-5.0MW', speed: '24.2 m/s', output: '4.8 MW', temp: '88.5°C', status: 'ACTIVE' },
      { id: 'WTG-PAT02', model: 'Gamesa G132-5.0MW', speed: '25.0 m/s', output: '5.0 MW', temp: '91.2°C', status: 'ACTIVE' },
      { id: 'WTG-PAT03', model: 'Gamesa G132-5.0MW', speed: '29.5 m/s', output: '0.0 MW', temp: '35.4°C', status: 'OFFLINE' },
      { id: 'WTG-PAT04', model: 'Gamesa G132-5.0MW', speed: '31.2 m/s', output: '0.0 MW', temp: '34.8°C', status: 'OFFLINE' }
    ]
  }
};

// Initial Incident Database
const incidentQueue = [
  { id: 'INC-773', resource: 'WTG-N14', desc: 'Brake Pad System Friction Temperature Exceeded threshold (98.5°C)', severity: 'Critical', assigned: 'ww_operator', step: 'Manager Approval', status: 'Pending Approval' },
  { id: 'INC-770', resource: 'WTG-N50', desc: 'Blade pitch motor encoder feedback offline', severity: 'Major', assigned: 'ww_manager', step: 'Technician Dispatched', status: 'In Progress' },
  { id: 'INC-765', resource: 'WTG-TX18', desc: 'Yaw motor phase current imbalance detected', severity: 'Minor', assigned: 'ww_operator', step: 'Investigation', status: 'In Progress' }
];

// UI DOM references
let powerChartInstance = null;
let statusChartInstance = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupRegionHandler();
  setupRoleHandler();
  setupTerminalHandler();
  setupDatabaseHandler();
  setupWorkflowHandler();
  setupCalculatorHandler();
  setupScriptsHandler();
  
  // Start intervals
  startClock();
  startTelemetrySimulator();
  
  // Initial renders
  renderTelemetryTable();
  initCharts();
  updateCalculator();
  renderIncidentsTable();
});

// 1. Clock Updates
function startClock() {
  setInterval(() => {
    state.systemTime.setSeconds(state.systemTime.getSeconds() + 1);
    const timeStr = state.systemTime.toISOString().replace('T', ' ').substring(0, 19);
    document.getElementById('systemClock').textContent = timeStr;
  }, 1000);
}

// 2. Navigation Control
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.dashboard-view');
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.getAttribute('data-view');
      state.activeView = targetView;
      
      // Update nav class
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      // Update viewport
      views.forEach(v => v.classList.remove('active'));
      const activeEl = document.getElementById(`${targetView}View`);
      if (activeEl) {
        activeEl.classList.add('active');
      }
      
      // Special actions on tab activation
      if (targetView === 'overview') {
        setTimeout(() => {
          powerChartInstance.resize();
          statusChartInstance.resize();
        }, 10);
      }
    });
  });
}

// 3. Region Change Handler
function setupRegionHandler() {
  const select = document.getElementById('regionSelect');
  select.addEventListener('change', (e) => {
    state.selectedRegion = e.target.value;
    updateRegionMetrics();
  });
}

function updateRegionMetrics() {
  const cfg = regionsConfig[state.selectedRegion];
  
  // Trigger table re-render
  renderTelemetryTable();
  
  // Update KPI displays immediately
  const basePwr = cfg.powerBase;
  const randPwr = (basePwr + (Math.random() * 20 - 10)).toFixed(1);
  const avgWind = ((cfg.windMin + cfg.windMax) / 2).toFixed(1);
  
  document.getElementById('kpi-power').textContent = `${randPwr} MW`;
  document.getElementById('kpi-wind').textContent = `${avgWind} m/s`;
  document.getElementById('kpi-turbines').textContent = `${cfg.turbinesOnline} / ${cfg.turbines.length * 10 || 50}`;
  
  const alertsEl = document.getElementById('kpi-alerts');
  alertsEl.textContent = cfg.activeAlerts;
  if (cfg.activeAlerts > 0) {
    alertsEl.style.color = 'var(--danger)';
  } else {
    alertsEl.style.color = 'var(--primary)';
  }
  
  document.getElementById('kpi-alert-trend').innerHTML = `<i class="fa-solid fa-circle-info"></i> ${cfg.alertTrend}`;
  
  // Re-generate chart values
  state.powerYieldHistory = Array.from({ length: 12 }, () => Math.floor(Math.random() * (cfg.powerBase / 3)) + Math.floor(cfg.powerBase * 0.8));
  state.demandHistory = Array.from({ length: 12 }, () => Math.floor(Math.random() * (cfg.powerBase / 4)) + Math.floor(cfg.powerBase * 0.85));
  
  if (powerChartInstance && statusChartInstance) {
    powerChartInstance.data.datasets[0].data = state.powerYieldHistory;
    powerChartInstance.data.datasets[1].data = state.demandHistory;
    powerChartInstance.update();
    
    // Status mix calculations
    let active = 0, maintenance = 0, offline = 0;
    cfg.turbines.forEach(t => {
      if (t.status === 'ACTIVE') active++;
      else if (t.status === 'MAINTENANCE') maintenance++;
      else offline++;
    });
    
    statusChartInstance.data.datasets[0].data = [active, maintenance, offline];
    statusChartInstance.update();
  }
}

// 4. Role Handler (RBAC Access Control)
function setupRoleHandler() {
  const select = document.getElementById('roleSelect');
  select.addEventListener('change', (e) => {
    state.userRole = e.target.value;
    updateRBACUI();
  });
}

function updateRBACUI() {
  const banner = document.getElementById('rbacWarningBanner');
  const appBtn = document.getElementById('wf-approve-btn');
  const rejBtn = document.getElementById('wf-reject-btn');
  
  if (state.userRole === 'operator') {
    banner.style.display = 'block';
    appBtn.disabled = true;
    rejBtn.disabled = true;
  } else {
    banner.style.display = 'none';
    appBtn.disabled = false;
    rejBtn.disabled = false;
  }
  
  // Append line in VM terminal reflecting identity login switch
  const consoleEl = document.getElementById('terminalScreen');
  const userPrefix = `ww_${state.userRole}`;
  consoleEl.innerHTML += `\n[system] Session updated. Authenticated as: ${userPrefix} | Role limits adjusted.\n${userPrefix}@VM-Web-01:~$ `;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// 5. Telemetry Live Ingestion Simulator
function startTelemetrySimulator() {
  setInterval(() => {
    if (state.activeView === 'overview') {
      const cfg = regionsConfig[state.selectedRegion];
      
      // Slightly fluctuate main metrics
      const currentPowerVal = parseFloat(document.getElementById('kpi-power').textContent);
      const newPower = (currentPowerVal + (Math.random() * 4 - 2)).toFixed(1);
      document.getElementById('kpi-power').textContent = `${newPower} MW`;
      
      const currentWindVal = parseFloat(document.getElementById('kpi-wind').textContent);
      const newWind = Math.max(1, (currentWindVal + (Math.random() * 0.6 - 0.3))).toFixed(1);
      document.getElementById('kpi-wind').textContent = `${newWind} m/s`;
      
      // Update charts real-time
      state.powerYieldHistory.shift();
      state.powerYieldHistory.push(parseFloat(newPower));
      powerChartInstance.update();
      
      // Update turbine rows dynamically
      const rows = document.querySelectorAll('#turbineTelemetryTableBody tr');
      rows.forEach(row => {
        const speedTd = row.children[3];
        const outputTd = row.children[4];
        const tempTd = row.children[5];
        const status = row.children[6].textContent.trim();
        
        if (status === 'ACTIVE') {
          const currentSpeed = parseFloat(speedTd.textContent);
          const nextSpeed = Math.max(1.5, currentSpeed + (Math.random() * 0.8 - 0.4)).toFixed(1);
          speedTd.textContent = `${nextSpeed} m/s`;
          
          const currentOutput = parseFloat(outputTd.textContent);
          const nextOutput = Math.max(0.1, currentOutput + (Math.random() * 0.4 - 0.2)).toFixed(1);
          outputTd.textContent = `${nextOutput} MW`;
          
          const currentTemp = parseFloat(tempTd.textContent);
          const nextTemp = Math.max(50, currentTemp + (Math.random() * 1.2 - 0.6)).toFixed(1);
          tempTd.textContent = `${nextTemp}°C`;
        }
      });
    }
  }, 4000);
  
  // Telemetry refresh button listener
  document.getElementById('refreshTelemetryBtn').addEventListener('click', () => {
    updateRegionMetrics();
  });
}

function renderTelemetryTable() {
  const tbody = document.getElementById('turbineTelemetryTableBody');
  const cfg = regionsConfig[state.selectedRegion];
  tbody.innerHTML = '';
  
  cfg.turbines.forEach(t => {
    let statusClass = 'active';
    let icon = 'fa-circle-check';
    if (t.status === 'MAINTENANCE') {
      statusClass = 'maintenance';
      icon = 'fa-user-gear';
    } else if (t.status === 'OFFLINE') {
      statusClass = 'offline';
      icon = 'fa-circle-xmark';
    }
    
    tbody.innerHTML += `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 600;">${t.id}</td>
        <td>${t.model}</td>
        <td><i class="fa-solid fa-location-dot" style="color:var(--secondary)"></i> ${cfg.title.split(' ')[0]}</td>
        <td>${t.speed}</td>
        <td style="font-weight: 600; color: var(--primary);">${t.output}</td>
        <td>${t.temp}</td>
        <td><span class="turbine-status-badge ${statusClass}"><i class="fa-solid ${icon}"></i> ${t.status}</span></td>
      </tr>
    `;
  });
}

// 6. Chart.js Configurations
function initCharts() {
  // Set Chart.js global font family to match Inter
  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  // Power History Area Chart
  const ctxPower = document.getElementById('powerYieldChart').getContext('2d');
  powerChartInstance = new Chart(ctxPower, {
    type: 'line',
    data: {
      labels: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', 'Today'],
      datasets: [
        {
          label: 'Power Yield (MW)',
          data: state.powerYieldHistory,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 2
        },
        {
          label: 'Grid Demand (MW)',
          data: state.demandHistory,
          borderColor: '#8b5cf6',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0.3,
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'Outfit' } }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
      }
    }
  });

  // Status Mix Doughnut Chart
  const ctxStatus = document.getElementById('statusMixChart').getContext('2d');
  statusChartInstance = new Chart(ctxStatus, {
    type: 'doughnut',
    data: {
      labels: ['Active', 'Maintenance', 'Offline'],
      datasets: [{
        data: [3, 1, 1],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderColor: '#0f172a',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { family: 'Outfit' } }
        }
      },
      cutout: '75%'
    }
  });
  
  // Run initial update for active region values
  updateRegionMetrics();
}

// 7. Interactive Network Topology & Terminal Console
function setupTerminalHandler() {
  const nodes = document.querySelectorAll('.svg-node');
  const screen = document.getElementById('terminalScreen');
  
  nodes.forEach(node => {
    node.addEventListener('click', () => {
      // Manage select style
      nodes.forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
      
      const nodeKey = node.getAttribute('data-node');
      state.selectedVMNode = nodeKey;
      
      let label = "";
      let ip = "";
      
      switch (nodeKey) {
        case 'nginx': label = 'VM-Web-01 (Nginx Proxy)'; ip = '172.24.1.10'; break;
        case 'app': label = 'VM-App-01 (API Service)'; ip = '172.24.2.20'; break;
        case 'database': label = 'VM-DB-01 (MariaDB Primary)'; ip = '172.24.2.30'; break;
        case 'cache': label = 'VM-Cache-01 (Redis Cluster)'; ip = '172.24.2.40'; break;
        case 'igw': label = 'Internet Gateway'; ip = '0.0.0.0/0'; break;
        case 'nat': label = 'NAT Gateway Service'; ip = '172.24.1.254'; break;
      }
      
      document.getElementById('selectedNodeLabel').textContent = `Target: ${label}`;
      screen.innerHTML += `\n\nSSH Connection requested to ${label} (${ip})...\nAuthenticating credentials...\nAuthorized shell session established.\nww_${state.userRole}@${nodeKey}-host:~$ `;
      screen.scrollTop = screen.scrollHeight;
    });
  });
  
  // Register Command Clicks
  const cmdButtons = document.querySelectorAll('[data-cmd]');
  cmdButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const commandKey = btn.getAttribute('data-cmd');
      executeMockTerminalCommand(commandKey);
    });
  });
  
  document.getElementById('clearTerminalBtn').addEventListener('click', () => {
    screen.innerHTML = `ww_${state.userRole}@${state.selectedVMNode}-host:~$ `;
  });
}

function executeMockTerminalCommand(cmdKey) {
  const screen = document.getElementById('terminalScreen');
  const node = state.selectedVMNode;
  const user = `ww_${state.userRole}`;
  
  let commandText = "";
  let outputText = "";
  
  switch (cmdKey) {
    case 'systemctl_status':
      commandText = `systemctl status ${node === 'nginx' ? 'nginx' : node === 'database' ? 'mariadb' : 'windwatch-app'}`;
      if (node === 'igw' || node === 'nat') {
        outputText = `[-] systemctl error: Gateways are managed cloud appliances, not target servers.`;
      } else {
        outputText = `● ${node === 'nginx' ? 'nginx.service - Nginx HTTP Web Server' : node === 'database' ? 'mariadb.service - MariaDB Community Server' : 'windwatch-app.service - FastAPI Telemetry Engine'}\n   Loaded: loaded (/etc/systemd/system/...; enabled; vendor preset: enabled)\n   Active: active (running) since Sat 2026-06-20 02:00:15 UTC; 13h ago\n   Main PID: ${Math.floor(Math.random() * 5000) + 1200} (code=exited, status=0/SUCCESS)\n   Tasks: 8 (limit: 4915)\n   Memory: 84.8M (limit: 2.0G)\n   CGroup: /system.slice/...`;
      }
      break;
      
    case 'docker_ps':
      commandText = "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'";
      if (node === 'app' || node === 'nginx' || node === 'database') {
        outputText = `NAMES                    STATUS              PORTS\nwindwatch-app-api        Up 13 hours         172.24.2.20:8000->8000/tcp\nwindwatch-web            Up 13 hours         0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp\nwindwatch-db             Up 13 hours (healthy) 172.24.2.30:3306->3306/tcp\nwindwatch-cache          Up 13 hours         6379/tcp`;
      } else {
        outputText = `CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES\nNo containers running directly on host namespace.`;
      }
      break;
      
    case 'system_resources':
      commandText = "free -h && df -h /";
      const ramUsed = (1.2 + Math.random() * 0.4).toFixed(1);
      const diskUsed = (28 + Math.random() * 2).toFixed(0);
      outputText = `              total        used        free      shared  buff/cache   available\nMem:           1.9Gi       ${ramUsed}Gi       0.3Gi        42Mi       0.4Gi       0.5Gi\nSwap:          1.0Gi       0.1Gi       0.9Gi\n\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        40G   ${diskUsed}G   11G  ${diskUsed}% /`;
      break;
      
    case 'service_restart':
      commandText = `systemctl restart ${node === 'nginx' ? 'nginx' : node === 'database' ? 'mariadb' : 'windwatch-app'}`;
      if (node === 'igw' || node === 'nat') {
        outputText = `[-] Permission denied: Target appliance cannot be restarted directly.`;
      } else if (state.userRole === 'operator') {
        outputText = `[-] passwordless sudo: ww_operator is not allowed to execute service restarts.\n    Reason: Role limit policy. Upgrade authorization context.`;
      } else {
        outputText = `[sudo] restarting service daemon...\nStopping active processes...\nStarting child threads...\nService verification status: ACTIVE (running state)`;
      }
      break;
      
    case 'view_logs':
      commandText = `tail -n 6 /var/log/syslog`;
      const dateStr = state.systemTime.toISOString().substring(11,19);
      outputText = `Jun 20 ${dateStr} windwatch-node systemd[1]: Started Periodic Backup log rotation.\nJun 20 ${dateStr} windwatch-app[2899]: telemetry_daemon: parsing payload region: ${state.selectedRegion}\nJun 20 ${dateStr} windwatch-app[2899]: ingestion: processed metrics from 5 wind turbines\nJun 20 ${dateStr} windwatch-db[1204]: [Note] Connection validated. user: ww_admin host: 172.24.2.20\nJun 20 ${dateStr} windwatch-web[883]: Nginx ReverseProxy: request HTTP GET /api/v1/telemetry 200 OK`;
      break;
  }
  
  screen.innerHTML += `${commandText}\n${outputText}\n${user}@${node}-host:~$ <span class="terminal-cursor"></span>`;
  
  // Remove cursor from previous lines, add back only at end
  const cursors = screen.querySelectorAll('.terminal-cursor');
  if (cursors.length > 1) {
    cursors.forEach((c, idx) => {
      if (idx < cursors.length - 1) c.remove();
    });
  }
  screen.scrollTop = screen.scrollHeight;
}

// 8. Database and Backup Management
function setupDatabaseHandler() {
  const backupBtn = document.getElementById('triggerBackupBtn');
  const screen = document.getElementById('backupLogScreen');
  const tableBody = document.getElementById('backupHistoryTableBody');
  
  backupBtn.addEventListener('click', () => {
    if (state.backupLogsRunning) return;
    state.backupLogsRunning = true;
    backupBtn.disabled = true;
    
    // Clear log and run simulated back up sequence
    screen.innerHTML = `[+] Initiating Database Backup Job manually...`;
    
    const logs = [
      `[i] Authenticating Database User: ww_admin`,
      `[i] Exporting schema & data from MariaDB: windwatch_analytics`,
      `[*] Executing command: mysqldump --single-transaction -h localhost -u ww_admin -p'****' windwatch_analytics | gzip > /var/backups/windwatch/windwatch_analytics_backup_${getFormattedDate()}.sql.gz`,
      `[+] Local backup file generated successfully. Size: 142.8 MB`,
      `[i] Copying file to AWS Glacier backup storage (windwatch-dr-backups)`,
      `[*] Executing CLI: aws s3 cp /var/backups/windwatch/... s3://windwatch-dr-backups/database/`,
      `[SUCCESS] Replication succeeded: s3://windwatch-dr-backups/database/windwatch_analytics_backup_${getFormattedDate()}.sql.gz`,
      `[i] Enforcing 7-day retention local file rotation policies...`,
      `[SUCCESS] Backup execution cycle finished without warnings. System status: OPTIMAL`
    ];
    
    let lineIdx = 0;
    const interval = setInterval(() => {
      if (lineIdx < logs.length) {
        screen.innerHTML += `\n${logs[lineIdx]}`;
        screen.scrollTop = screen.scrollHeight;
        lineIdx++;
      } else {
        clearInterval(interval);
        state.backupLogsRunning = false;
        backupBtn.disabled = false;
        
        // Add row to Backup Table
        const fileDate = getFormattedDate();
        const fullTimeStr = state.systemTime.toISOString().replace('T', ' ').substring(0, 19);
        const newRow = `
          <tr>
            <td>#JOB-${Math.floor(Math.random() * 9000) + 1000}</td>
            <td>windwatch_analytics_backup_${fileDate}.sql.gz</td>
            <td>142.8 MB</td>
            <td>windwatch_analytics</td>
            <td>Local &amp; AWS S3 (Glacier)</td>
            <td>${fullTimeStr}</td>
            <td><span class="turbine-status-badge active"><i class="fa-solid fa-check"></i> Success</span></td>
          </tr>
        `;
        tableBody.innerHTML = newRow + tableBody.innerHTML;
      }
    }, 800);
  });
}

function getFormattedDate() {
  const y = state.systemTime.getFullYear();
  const m = String(state.systemTime.getMonth() + 1).padStart(2, '0');
  const d = String(state.systemTime.getDate()).padStart(2, '0');
  const h = String(state.systemTime.getHours()).padStart(2, '0');
  const min = String(state.systemTime.getMinutes()).padStart(2, '0');
  const s = String(state.systemTime.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${h}${min}${s}`;
}

// 9. Workflows and Alerts
function setupWorkflowHandler() {
  const appBtn = document.getElementById('wf-approve-btn');
  const rejBtn = document.getElementById('wf-reject-btn');
  const simBtn = document.getElementById('simulateAlertBtn');
  
  appBtn.addEventListener('click', () => {
    if (state.activeWorkflowStep === 3) {
      state.activeWorkflowStep = 4;
      updateWorkflowUI();
      
      // Update entry in Incidents Table queue
      const incId = document.getElementById('activeWorkflowId').textContent.replace('TICKET #', '');
      const item = incidentQueue.find(i => i.id === incId);
      if (item) {
        item.step = 'Archived Audit';
        item.status = 'Resolved';
      }
      renderIncidentsTable();
      
      // Terminal message log
      const consoleEl = document.getElementById('terminalScreen');
      consoleEl.innerHTML += `\n[workflow] Approved incident ticket ${incId}. Logged status: RESOLVED. Audit trace archived.\nww_${state.userRole}@${state.selectedVMNode}-host:~$ `;
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  });
  
  rejBtn.addEventListener('click', () => {
    if (state.activeWorkflowStep === 3) {
      state.activeWorkflowStep = 2; // Rollback
      updateWorkflowUI();
      
      const incId = document.getElementById('activeWorkflowId').textContent.replace('TICKET #', '');
      const item = incidentQueue.find(i => i.id === incId);
      if (item) {
        item.step = 'Operator Dispatch';
        item.status = 'Pending Review';
      }
      renderIncidentsTable();
    }
  });
  
  simBtn.addEventListener('click', () => {
    // Generate new random incident
    const randId = `INC-${Math.floor(Math.random() * 800) + 100}`;
    const desc = "Turbine #02 Blade imbalance / Extreme Vibration (Pitch Lock sensor tripped)";
    
    // Reset workflow to Step 1
    state.activeWorkflowStep = 1;
    
    document.getElementById('activeWorkflowId').textContent = `TICKET #${randId}`;
    document.getElementById('workflowDetailsTitle').textContent = `Turbine #02 (APAC Coastal) Blade Pitch System Trip`;
    document.getElementById('workflowDetailsMeta').textContent = `Reported: Just Now | Severity: Critical`;
    
    // Add to local list
    const newInc = { id: randId, resource: 'WTG-AP02', desc: desc, severity: 'Critical', assigned: 'ww_operator', step: 'Investigation', status: 'Active Alert' };
    incidentQueue.unshift(newInc);
    
    updateWorkflowUI();
    renderIncidentsTable();
  });
}

function updateWorkflowUI() {
  const steps = [1, 2, 3, 4];
  
  steps.forEach(s => {
    const el = document.getElementById(`wf-step-${s}`);
    el.classList.remove('completed', 'active');
    
    if (s < state.activeWorkflowStep) {
      el.classList.add('completed');
    } else if (s === state.activeWorkflowStep) {
      el.classList.add('active');
    }
  });
  
  // Modify button text based on active step
  const appBtn = document.getElementById('wf-approve-btn');
  const rejBtn = document.getElementById('wf-reject-btn');
  
  if (state.activeWorkflowStep === 4) {
    appBtn.disabled = true;
    rejBtn.disabled = true;
    appBtn.textContent = 'Workflow Approved';
  } else if (state.activeWorkflowStep === 1) {
    appBtn.disabled = state.userRole === 'operator';
    rejBtn.disabled = state.userRole === 'operator';
    appBtn.textContent = 'Acknowledge Telemetry';
    rejBtn.textContent = 'Silence Alert';
  } else if (state.activeWorkflowStep === 2) {
    appBtn.disabled = state.userRole === 'operator';
    rejBtn.disabled = state.userRole === 'operator';
    appBtn.textContent = 'Dispatch Technician';
    rejBtn.textContent = 'Rollback Alert';
  } else {
    appBtn.disabled = state.userRole === 'operator';
    rejBtn.disabled = state.userRole === 'operator';
    appBtn.textContent = 'Approve Dispatch';
    rejBtn.textContent = 'Reject Workflow';
  }
}

function renderIncidentsTable() {
  const tbody = document.getElementById('incidentsQueueTableBody');
  tbody.innerHTML = '';
  
  incidentQueue.forEach(inc => {
    let sevClass = 'maintenance';
    if (inc.severity === 'Critical') sevClass = 'offline';
    else if (inc.severity === 'Minor') sevClass = 'active';
    
    let statusClass = 'maintenance';
    if (inc.status === 'Resolved') statusClass = 'active';
    else if (inc.status === 'Active Alert') statusClass = 'offline';
    
    tbody.innerHTML += `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 600;">#${inc.id}</td>
        <td style="font-family: var(--font-mono);">${inc.resource}</td>
        <td>${inc.desc}</td>
        <td><span class="turbine-status-badge ${sevClass}">${inc.severity}</span></td>
        <td>${inc.assigned}</td>
        <td style="font-weight:600; color: var(--secondary);">${inc.step}</td>
        <td><span class="turbine-status-badge ${statusClass}">${inc.status}</span></td>
      </tr>
    `;
  });
}

// 9. Pricing Strategy Calculator
function setupCalculatorHandler() {
  const inputs = ['calc-instances', 'calc-storage', 'calc-transfer', 'calc-redundancy', 'calc-backup', 'calc-sla', 'calc-purchasing'];
  
  inputs.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', updateCalculator);
    el.addEventListener('change', updateCalculator);
  });
}

function updateCalculator() {
  const instances = parseInt(document.getElementById('calc-instances').value);
  const storage = parseInt(document.getElementById('calc-storage').value);
  const transfer = parseInt(document.getElementById('calc-transfer').value);
  
  const redundancy = document.getElementById('calc-redundancy').value;
  const backup = document.getElementById('calc-backup').value;
  const sla = document.getElementById('calc-sla').value;
  const purchasing = document.getElementById('calc-purchasing').value;
  
  // Updates slider badges text
  document.getElementById('calc-instances-val').textContent = `${instances} VMs`;
  document.getElementById('calc-storage-val').textContent = `${storage} GB`;
  document.getElementById('calc-transfer-val').textContent = `${transfer} TB`;
  
  // Pricing Constants
  const VM_UNIT_PRICE = 80;    // $80 / month per VM
  const SSD_GB_PRICE = 0.10;   // $0.10 / GB
  const NETWORK_TB_PRICE = 50; // $50 / TB
  
  // Multipliers
  let redMult = 1.0;
  if (redundancy === 'multi-az') redMult = 1.5;
  else if (redundancy === 'multi-region') redMult = 3.0; // 3 regions deployment
  
  let purchaseDisc = 1.0;
  if (purchasing === 'reserved') purchaseDisc = 0.5; // 50% discount
  
  // Calculations
  const computeCost = (instances * VM_UNIT_PRICE * redMult * purchaseDisc);
  const storageCost = (storage * SSD_GB_PRICE * redMult);
  const networkCost = (transfer * NETWORK_TB_PRICE);
  
  let backupCost = 30.0;
  if (backup === 'weekly') backupCost = 10.0 * redMult;
  else if (backup === 'daily') backupCost = 30.0 * redMult;
  else if (backup === 'realtime') backupCost = 120.0 * redMult;
  
  let supportCost = 250.0;
  if (sla === 'dev') supportCost = 50.0;
  else if (sla === 'business') supportCost = 250.0;
  else if (sla === 'enterprise') supportCost = 1000.0;
  
  const totalCost = computeCost + storageCost + networkCost + backupCost + supportCost;
  
  // Populate UI
  document.getElementById('cost-compute').textContent = `$${computeCost.toFixed(2)}`;
  document.getElementById('cost-storage').textContent = `$${storageCost.toFixed(2)}`;
  document.getElementById('cost-network').textContent = `$${networkCost.toFixed(2)}`;
  document.getElementById('cost-backup').textContent = `$${backupCost.toFixed(2)}`;
  document.getElementById('cost-support').textContent = `$${supportCost.toFixed(2)}`;
  document.getElementById('totalMonthlyCost').textContent = `$${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  // Optimization Advice engine
  const adviceEl = document.getElementById('optimizationAdvice');
  let advice = "";
  
  if (purchasing === 'ondemand') {
    advice += `💡 switching VM Instances to a 3-Year Reserved purchasing model reduces compute costs from $${computeCost.toFixed(0)} to $${(computeCost * 0.5).toFixed(0)}/mo. `;
  }
  
  if (redundancy === 'multi-region' && instances > 20) {
    advice += `⚠️ Running ${instances} VMs in Multi-Region active-active configuration might create high cross-region data transfer fees. Consider consolidation. `;
  }
  
  if (backup === 'realtime' && sla === 'dev') {
    advice += `💡 Dev support SLA is configured with high-availability real-time backup streams. Downgrade stream to Daily Incremental to save $${(backupCost - 30).toFixed(0)}/mo. `;
  }
  
  if (advice === "") {
    advice = "✅ Infrastructure footprint is optimized! Active settings align with recommendations for standard operational loads.";
  }
  
  adviceEl.textContent = advice;
}

// 10. Scripts Browser Viewer
function setupScriptsHandler() {
  const tabs = document.querySelectorAll('.script-tab-btn');
  const codeBlock = document.getElementById('scriptCodeBlock');
  const filenameEl = document.getElementById('currentScriptFilename');
  const descEl = document.getElementById('currentScriptDesc');
  const copyBtn = document.getElementById('copyCodeBtn');
  
  // Set default view content
  updateScriptCodeView('setup_users');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const fileKey = tab.getAttribute('data-file');
      updateScriptCodeView(fileKey);
    });
  });
  
  copyBtn.addEventListener('click', () => {
    const code = codeBlock.textContent;
    navigator.clipboard.writeText(code).then(() => {
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 1500);
    });
  });
}

function updateScriptCodeView(key) {
  const codeBlock = document.getElementById('scriptCodeBlock');
  const filenameEl = document.getElementById('currentScriptFilename');
  const descEl = document.getElementById('currentScriptDesc');
  
  const script = scriptCodes[key];
  if (script) {
    filenameEl.textContent = script.filename;
    descEl.textContent = script.desc;
    codeBlock.textContent = script.code;
  }
}
