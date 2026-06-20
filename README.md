# WindWatch Wind Turbine Analytics Cloud

WindWatch is a centralized Cloud Operations, Telemetry Analytics, and Infrastructure Automation platform tailored for multi-region wind energy farms. This workspace contains the prototype interface and production-ready server administration scripts supporting scalable cloud deployment patterns, security standard configurations, and cost calculator calculations.

## Directory Layout

```
.
├── index.html                   # Main dashboard & VM console interface
├── styles.css                   # Custom premium dark-theme stylesheet
├── app.js                       # Telemetry simulation, CLI terminal & pricing logic
├── README.md                    # Project documentation (this file)
└── scripts/                     # Production-ready automation & setup scripts
    ├── setup_users.sh           # User/group provisioning and sudo rules configuration
    ├── deploy.sh                # Nginx web server deployment & lifecycle script
    ├── backup.sh                # MySQL backup, S3 Glacier replication & retention cleanup
    ├── docker-compose.yml       # Multi-container service orchestrator manifest
    ├── nginx.conf               # Reverse proxy upstream routing & security headers configuration
    └── crontab_entries          # Automations cron triggers lists
```

---

## How to Run the Dashboard

1. **Locally (Double Click)**:
   Simply open [index.html](file:///Users/rajneesharya/Desktop/aws/index.html) in any modern web browser.
   
2. **Via Local Server (Recommended)**:
   Launch a lightweight Python server inside this directory:
   ```bash
   python3 -m http.server 8080
   ```
   Then navigate to `http://localhost:8080` in your web browser.

---

## Component Details & Scripts Description

### 1. Linux Administration (`scripts/setup_users.sh`)
Provisions secure roles on target Ubuntu/Debian machines:
- **Groups created**: `windwatch_admin`, `windwatch_manager`, `windwatch_operator`.
- **Directory configs**: Sets up strict access for web assets (`/var/www/windwatch`), log folders (`/var/log/windwatch`), and backups (`/var/backups/windwatch`).
- **Sudo configs**: Grants passwordless restart rights for system daemons (Nginx, Docker) to Managers and basic status checks to Operators.

### 2. VM Service Deployment (`scripts/deploy.sh`)
Automates host configurations and web service initialization:
- Checks and installs Nginx on the target machine.
- Configures Nginx virtual host with custom server blocks, API reverse proxy upstream, and gzip settings.
- Tests syntax configurations, restarts Nginx using `systemctl`, and updates the local firewall (`ufw`).

### 3. Database & Disaster Recovery Strategy (`scripts/backup.sh`)
Defines database backups and high availability archiving:
- Runs database dump using `mysqldump` in a single-transaction state.
- Compresses output with gzip format, labeling files with precise date timestamps.
- Simulates replication upload to AWS S3 Glacier storage class bucket.
- Rotates backup directory, cleaning up files older than 7 days.

### 4. Containerization Orchestrator (`scripts/docker-compose.yml` & `nginx.conf`)
Orchestrates multi-container topologies:
- **`web`**: Serves as the gateway proxy container (alpine Nginx) with rate-limits and security headers.
- **`app`**: Python-based telemetry API server fetching turbine telemetry metrics.
- **`db`**: Database container (MariaDB 10.11) with local persistence volume storage and health status checks.
- **`cache`**: Memory cache layer (Redis 7) processing telemetry metrics high-frequency streams.

---

## Interactive Dashboard Features

- **Live Telemetry & Region Selector**: Toggle between the North Sea Offshore Cluster, Texas Plains, APAC Coast, or Patagonia Zone to view live turbine status cards and fluctuated generation charts.
- **Identity RBAC Adjuster**: Select between Operator, Manager, or Admin roles. Basic operators will receive `Access Denied` banners when trying to execute high-privilege operations like technician dispatches or service restarts.
- **SVG VPC Network Topology**: Interactive graphical representation of the VPC boundary. Clicking elements (Nginx, App, DB, Cache, Gateways) targets the VM Console Terminal to that specific server.
- **VM Diagnostic Shell**: Clicking terminal action buttons (checking resources, checking logs, listing docker containers, restarting nginx) runs live mock script console responses.
- **Backup Monitor**: Trigger a database backup to output detailed bash execution stages in real-time, instantly adding a timestamped record to the backup tables list.
- **TCO Price Estimator**: Real-time slider calculations for VMs count, SSD storage, bandwidth, replication scopes, and backup strategies. Updates breakdown logs and advice indicators.
