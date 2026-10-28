# IPOPro — Deployment, Operations & Disaster Recovery Guide

This operations guide details the deployment procedures for both the Render backend service and Hostinger static frontend, including the exact steps to provision a managed PostgreSQL database on Render to achieve 100% production persistence.

---

## 1. Backend Deployment (Render Web Service)

### Service Overview
- **Service Name:** `apo-wubq`
- **Current Live Endpoint:** `https://apo-wubq.onrender.com/api/v1`
- **Runtime:** Python 3.11
- **Repository Branch:** `main`

### Deployment Settings in Render Dashboard
- **Build Command:**
  ```bash
  pip install -r backend/requirements.txt
  ```
- **Start Command:**
  ```bash
  cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
  ```

### Required Environment Variables
| Variable Name | Required Value / Format | Purpose |
|---|---|---|
| `TRADING_MODE` | `PAPER` (or `LIVE` when approved) | Controls execution routing |
| `DATABASE_URL` | `postgresql://user:pass@dpg-xxx:5432/ipopro_db` | Persistent remote database connection |
| `APP_ENCRYPTION_KEY` | 32-byte Base64 Fernet key | Symmetric encryption of credentials |
| `API_KEY` | e.g. `ipopro-secure-master-key-2026` | API authentication key for REST calls |
| `ALLOWED_ORIGINS` | `https://ipo.emperialcabs.com,http://localhost:5173` | CORS whitelist |

---

## 2. Resolving the Production Persistence Blocker (Step-by-Step)

To transition from ephemeral SQLite storage to durable remote PostgreSQL on Render:

1. Log in to the **Render Dashboard** (`https://dashboard.render.com`).
2. Click the **`New +`** button at the top-right and select **`PostgreSQL`**.
3. Configure the database instance:
   - **Name:** `ipopro-db`
   - **Database:** `ipopro_db`
   - **User:** `ipopro_user`
   - **Region:** Choose the same region as the `apo-wubq` Web Service (e.g. Frankfurt or Singapore).
   - **Plan:** Select Free or Starter.
4. Click **`Create Database`** and wait approximately 60 seconds for provisioning to complete.
5. In the database dashboard under **Connections**, copy the **`Internal Database URL`** (e.g. `postgresql://ipopro_user:xxxx@dpg-xxxx-a:5432/ipopro_db`).
6. Navigate back to the `apo-wubq` Web Service dashboard -> **`Environment`**.
7. Add or edit the `DATABASE_URL` variable, pasting the Internal Database URL.
8. Click **`Save Changes`**. Render will automatically trigger a rolling redeployment.
9. Verify the fix:
   Execute `curl https://apo-wubq.onrender.com/api/v1/health/ready` and confirm:
   ```json
   {
     "status": "UP",
     "database_engine": "postgresql",
     "storage_type": "PERSISTENT_REMOTE",
     "database_url_configured": true
   }
   ```

---

## 3. Frontend Deployment (Hostinger Static Hosting)

### Live Hostinger Endpoint
- **Domain:** `https://ipo.emperialcabs.com`
- **Hosting Type:** Hostinger Shared / Cloud Hosting (Static HTML/JS)

### Deployment Procedure
1. Build the production bundle from the repository root:
   ```bash
   cd frontend
   npm run build
   ```
2. The compilation outputs optimized files to `frontend/dist/`.
3. The root directory contains `hostinger_frontend_upload.zip`, which bundles:
   - `index.html` (referencing active asset hashes)
   - `assets/` (containing compiled JS and CSS bundles)
   - `.htaccess` (enforcing client-side routing fallback)
4. In Hostinger File Manager:
   - Navigate to `public_html/`.
   - Upload `hostinger_frontend_upload.zip`.
   - Extract in place and overwrite existing files.

### Client-Side SPA Routing (`.htaccess`)
To prevent HTTP 404 errors when reloading sub-routes (e.g. `/portfolio`, `/orders`):
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

---

## 4. Backup & Disaster Recovery Protocols

1. **Automated SQLite/JSON Boot Fail-Safe (`account_persistence.py`):**
   - In environments where PostgreSQL is not yet configured, the system writes an encrypted JSON backup of accounts and risk limits to disk periodically.
   - On container restart, this file is detected and auto-restored into the fresh database.
2. **PostgreSQL Point-in-Time Backup:**
   - Standard pg_dump command for manual database backup:
     ```bash
     pg_dump "$DATABASE_URL" -F c -b -v -f ipopro_backup_$(date +%Y%m%d).dump
     ```
   - Restore command:
     ```bash
     pg_restore -d "$DATABASE_URL" -v ipopro_backup_20261028.dump
     ```
