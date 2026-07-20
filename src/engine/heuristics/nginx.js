/**
 * NGINX reverse proxy configuration generator for Odoo.
 *
 * Generates an optimized nginx server block tuned to the user's hardware,
 * Odoo worker count, deployment profile, and database size.
 *
 * Key performance parameters calculated:
 * - client_max_body_size — based on DB size and batch workload
 * - proxy_buffers — sized to Odoo response patterns
 * - proxy_timeouts — aligned to Odoo's limit_time_cpu/real
 * - keepalive connections — tuned to worker count
 * - rate limiting — based on expected concurrent users
 * - static file caching — disk-type aware expiry
 * - SSL session cache — sized for user count
 */

/**
 * Calculate client_max_body_size.
 * Odoo's default is 50MB but can be too small for imports/attachments.
 *
 * @param {'small'|'medium'|'large'|'very-large'} dbSize
 * @param {boolean} batchHeavy
 * @returns {{ value: string, configLine: string, rationale: string }}
 */
export function calcClientMaxBodySize(dbSize, batchHeavy = false) {
  const base = { small: 50, medium: 100, large: 200, 'very-large': 300 }
  const size = (base[dbSize] ?? 100) * (batchHeavy ? 2 : 1)

  return {
    value: `${size}M`,
    configLine: `client_max_body_size = ${size}M`,
    rationale: `${size}MB max body size (${dbSize} database${batchHeavy ? ', batch-heavy ×2' : ''}). Odoo attachments, imports, and report exports can be large. Too small = 413 errors on file uploads.`,
  }
}

/**
 * Calculate proxy buffer sizes.
 * Odoo responses vary: lightweight JSON for form views, heavy HTML for reports.
 *
 * @param {'small'|'medium'|'large'|'very-large'} dbSize
 * @param {boolean} batchHeavy
 * @returns {{ buffers: object, bufferSize: object, busySize: object, configLines: string[], rationale: string }}
 */
export function calcProxyBuffers(dbSize, batchHeavy = false) {
  // Larger databases produce larger response pages (more records, bigger reports)
  const bufCount = { small: 8, medium: 16, large: 32, 'very-large': 64 }
  const bufSize = { small: '8k', medium: '16k', large: '32k', 'very-large': '64k' }
  const multiplier = batchHeavy ? 2 : 1
  const count = (bufCount[dbSize] ?? 16) * multiplier

  const sizeStr = bufSize[dbSize] ?? '16k'
  // busy_buffers = count / 2 * size, capped conceptually
  const busySize = { small: '16k', medium: '32k', large: '64k', 'very-large': '128k' }[dbSize] ?? '32k'

  return {
    buffers: { value: count, unit: `× ${sizeStr}` },
    bufferSize: { value: sizeStr },
    busySize: { value: busySize },
    configLines: [
      `proxy_buffers ${count} ${sizeStr}`,
      `proxy_buffer_size ${sizeStr}`,
      `proxy_busy_buffers_size ${busySize}`,
    ],
    rationale: `${count} buffers of ${sizeStr} (${dbSize} DB${batchHeavy ? ', batch-heavy' : ''}). Larger buffers accommodate bigger Odoo report/export responses without swapping to disk.`,
  }
}

/**
 * Calculate proxy timeouts based on Odoo's time limits.
 * proxy_read_timeout should be >= Odoo's limit_time_real.
 *
 * @param {'small'|'medium'|'large'|'very-large'} dbSize
 * @param {boolean} batchHeavy
 * @returns {{ connect: object, read: object, send: object, configLines: string[], rationale: string }}
 */
export function calcProxyTimeouts(dbSize, batchHeavy = false) {
  // Odoo time limits from odoo-conf heuristic
  const realTime = { small: 120, medium: 240, large: 600, 'very-large': 1200 }
  const cpuTime = { small: 60, medium: 120, large: 300, 'very-large': 600 }

  const real = (realTime[dbSize] ?? 240) * (batchHeavy ? 1.5 : 1)
  const cpu = (cpuTime[dbSize] ?? 120) * (batchHeavy ? 1.5 : 1)

  return {
    connect: { value: 60, unit: 's', configLine: 'proxy_connect_timeout = 60s' },
    read: { value: real, unit: 's', configLine: `proxy_read_timeout = ${real}s` },
    send: { value: cpu, unit: 's', configLine: `proxy_send_timeout = ${cpu}s` },
    configLines: [
      `proxy_connect_timeout = 60s`,
      `proxy_read_timeout = ${real}s`,
      `proxy_send_timeout = ${cpu}s`,
    ],
    rationale: `Connect=60s, Read=${real}s, Send=${cpu}s. Read timeout matches Odoo's limit_time_real (~${real}s for ${dbSize} DB). Send timeout aligns with limit_time_cpu (~${cpu}s). Prevents nginx from killing long-running report generation requests prematurely.`,
  }
}

/**
 * Calculate keepalive connections to the Odoo upstream.
 *
 * @param {number} odooWorkers
 * @returns {{ value: number, configLine: string, rationale: string }}
 */
export function calcKeepalive(odooWorkers) {
  const value = Math.max(8, Math.min(Math.round(odooWorkers * 1.5), 128))

  return {
    value,
    configLine: `keepalive ${value};`,
    rationale: `${value} keepalive connections to Odoo upstream (workers=${odooWorkers} × 1.5). Maintains persistent connections from nginx to Odoo workers, reducing TCP handshake overhead and latency.`,
  }
}

/**
 * Calculate rate limiting parameters.
 *
 * @param {number} expectedUsers
 * @returns {{ zoneSize: string, rate: string, burst: number, configLines: string[], rationale: string }}
 */
export function calcRateLimiting(expectedUsers) {
  const zoneSize = Math.max(5, Math.min(Math.round(expectedUsers * 0.02), 50))
  // Typical rate: users / 10 per second (one request per 10s per user average)
  const rate = Math.max(5, Math.min(Math.round(expectedUsers / 10), 100))
  const burst = Math.round(rate * 2)

  return {
    zoneSize: `${zoneSize}m`,
    rate: `${rate}r/s`,
    burst,
    configLines: [
      `limit_req_zone $binary_remote_addr zone=odoo:${zoneSize}m rate=${rate}r/s;`,
      `limit_req zone=odoo burst=${burst} nodelay;`,
    ],
    rationale: `Rate limit: ${rate}r/s with burst=${burst} (${expectedUsers} users ÷ 10 × 2). Zone: ${zoneSize}MB (${expectedUsers} × 0.02). Protects Odoo from brute force and accidental DDoS while allowing normal user bursts.`,
  }
}

/**
 * Calculate static file caching behaviour.
 *
 * @param {'ssd'|'nvme'|'hdd'|'cloud'} diskType
 * @returns {{ webStaticExpiry: string, webImageExpiry: string, filestoreExpiry: string, configLines: string[], rationale: string }}
 */
export function calcStaticCaching(diskType) {
  const cacheExtents = {
    nvme: { web: '60d', img: '14d', fs: '30d' },
    ssd:  { web: '30d', img: '7d', fs: '14d' },
    cloud: { web: '14d', img: '3d', fs: '7d' },
    hdd:  { web: '7d', img: '1d', fs: '3d' },
  }
  const c = cacheExtents[diskType] ?? cacheExtents.ssd

  return {
    webStaticExpiry: c.web,
    webImageExpiry: c.img,
    filestoreExpiry: c.fs,
    configLines: [
      `# Web static assets (versioned — safe to cache long)`,
      `location /web/static/ {`,
      `    alias /usr/lib/python3/dist-packages/odoo/addons/web/static/;`,
      `    expires ${c.web};`,
      `    add_header Cache-Control "public, immutable";`,
      `}`,
      ``,
      `location /web/image/ {`,
      `    proxy_pass http://odoo;`,
      `    expires ${c.img};`,
      `}`,
      ``,
      `location /web/filestore/ {`,
      `    alias /var/lib/odoo/filestore;`,
      `    expires ${c.fs};`,
      `    add_header Cache-Control "public";`,
      `}`,
    ].join('\n'),
    rationale: `Static assets cached for ${c.web} (versioned, immutable). Images cached ${c.img}. Filestore cached ${c.fs}. ${diskType.toUpperCase()} disk benefits from longer caching to reduce read I/O.`,
  }
}

/**
 * Calculate proxy buffering recommendation.
 * For Odoo: buffering on is generally good for reporting, off for real-time.
 *
 * @param {boolean} batchHeavy
 * @returns {{ enabled: boolean, configLine: string, rationale: string }}
 */
export function calcProxyBuffering(batchHeavy) {
  const enabled = !batchHeavy  // off for batch-heavy to reduce memory pressure

  return {
    enabled,
    configLine: `proxy_buffering ${enabled ? 'on' : 'off'};`,
    rationale: `proxy_buffering ${enabled ? 'on' : 'off'}. ${
      enabled
        ? 'Recommended for general Odoo use. nginx buffers responses from Odoo and delivers them efficiently to slow clients, freeing Odoo workers faster.'
        : 'Batch/integration workloads benefit from streaming responses. Disabling buffering reduces nginx memory usage during large exports/imports at the cost of keeping Odoo workers busy longer.'
    }`,
  }
}

/**
 * Calculate SSL session cache size based on expected users.
 *
 * @param {number} expectedUsers
 * @returns {{ cacheSize: string, timeout: string, configLines: string[], rationale: string }}
 */
export function calcSSLSessionCache(expectedUsers) {
  // ~400 bytes per session, so 10MB = ~25000 sessions
  const mb = Math.max(1, Math.min(Math.round(expectedUsers / 2500), 20))
  const timeout = Math.max(5, Math.min(Math.round(expectedUsers / 10), 30))

  return {
    cacheSize: `${mb}m`,
    timeout: `${timeout}m`,
    configLines: [
      `ssl_session_cache shared:SSL:${mb}m;`,
      `ssl_session_timeout ${timeout}m;`,
    ],
    rationale: `${mb}MB SSL session cache (~${mb * 2500} sessions). Timeout: ${timeout}min. ${expectedUsers} users × 0.4KB per session = ${Math.round(expectedUsers * 0.4 / 1024 * 10) / 10}MB needed. Reduces TLS handshake overhead on repeat visits.`,
  }
}

/**
 * Calculate gzip settings.
 *
 * @returns {{ configLines: string[], rationale: string }}
 */
export function calcGzip() {
  return {
    configLines: [
      `gzip on;`,
      `gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml application/pdf;`,
      `gzip_min_length 1000;`,
      `gzip_comp_level 3;`,
      `gzip_vary on;`,
      `gzip_proxied any;`,
    ].join('\n'),
    rationale: `gzip enabled with compression level 3 (balance of speed vs ratio). Odoo serves HTML, JS, CSS, JSON (RPC calls), and XML (reports). Min length 1000 bytes avoids wasting CPU on tiny responses.`,
  }
}

/**
 * Calculate upstream block configuration.
 *
 * @param {number} odooWorkers
 * @param {number} keepalive - Upstream keepalive connections
 * @returns {{ config: string, odooPort: number, longpollPort: number, rationale: string }}
 */
export function calcUpstream(odooWorkers, keepalive) {
  const odooPort = 8069
  const longpollPort = 8072

  return {
    odooPort,
    longpollPort,
    config: `upstream odoo {
    server 127.0.0.1:${odooPort} max_fails=3 fail_timeout=30s;
    keepalive ${keepalive};
}

upstream odoo-longpoll {
    server 127.0.0.1:${longpollPort} max_fails=3 fail_timeout=30s;
    keepalive ${keepalive};
}`,
    rationale: `Two upstreams: 'odoo' (HTTP workers on port ${odooPort}) and 'odoo-longpoll' (gevent bus on ${longpollPort}). keepalive=${keepalive} connections per upstream. max_fails=3 / fail_timeout=30s prevents routing to unhealthy workers during transient failures.`,
  }
}

/**
 * Calculate the full nginx server block config.
 * Includes SSL template comments, proxy settings, caching, security headers.
 *
 * @param {object} params
 * @param {number} params.expectedUsers
 * @param {number} params.odooWorkers
 * @param {'small'|'medium'|'large'|'very-large'} params.dbSize
 * @param {boolean} params.batchHeavy
 * @param {'ssd'|'nvme'|'hdd'|'cloud'} params.diskType
 * @returns {{ config: string, params: object, warnings: string[] }}
 */
export function generateNginxConfig({ expectedUsers, odooWorkers, dbSize, batchHeavy = false, diskType = 'ssd' }) {
  const bodySize = calcClientMaxBodySize(dbSize, batchHeavy)
  const buffers = calcProxyBuffers(dbSize, batchHeavy)
  const timeouts = calcProxyTimeouts(dbSize, batchHeavy)
  const keepalive = calcKeepalive(odooWorkers)
  const rateLimiting = calcRateLimiting(expectedUsers)
  const caching = calcStaticCaching(diskType)
  const buffering = calcProxyBuffering(batchHeavy)
  const sslCache = calcSSLSessionCache(expectedUsers)
  const gzip = calcGzip()
  const upstream = calcUpstream(odooWorkers, keepalive.value)

  const warnings = []
  if (expectedUsers > 200) {
    warnings.push('High user count: consider using multiple Odoo app servers with a load balancer upstream of nginx.')
  }
  if (buffering.enabled && diskType === 'hdd') {
    warnings.push('proxy_buffering on with HDD may cause disk I/O pressure. Monitor swap and disk latency.')
  }

  const config = `# =================================================================
# OdooTune — NGINX Reverse Proxy Configuration for Odoo
# Generated for: ${expectedUsers} users, ${odooWorkers} workers, ${dbSize} DB, ${diskType} disk
# ${batchHeavy ? 'Batch-heavy workload' : 'Standard workload'}
# =================================================================
# WARNING: Review paths (ssl_certificate, static alias, filestore)
# before applying. These are template paths — adjust to your system.
# =================================================================

# --- Rate Limiting Zone (must be in http block) ---
${rateLimiting.configLines[0]}

# --- Upstreams ---
${upstream.config}

server {
    listen 80;
    server_name odoo.example.com;

    # Redirect HTTP → HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name odoo.example.com;

    # ──────────────────────────────────────────────
    # SSL / TLS
    # ──────────────────────────────────────────────
    ssl_certificate /etc/ssl/certs/odoo.crt;
    ssl_certificate_key /etc/ssl/private/odoo.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_ecdh_curve auto;
${sslCache.configLines.map(l => `    ${l}`).join('\n')}

    # ──────────────────────────────────────────────
    # Security Headers
    # ──────────────────────────────────────────────
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # ──────────────────────────────────────────────
    # Proxy Buffers
    # ──────────────────────────────────────────────
    ${buffers.configLines.join('\n    ')}
    ${buffering.configLine}

    # ──────────────────────────────────────────────
    # Timeouts
    # ──────────────────────────────────────────────
    ${timeouts.configLines.join('\n    ')}

    # ──────────────────────────────────────────────
    # Client Settings
    # ──────────────────────────────────────────────
    ${bodySize.configLine}
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    # ──────────────────────────────────────────────
    # Proxy Headers
    # ──────────────────────────────────────────────
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;

    # ──────────────────────────────────────────────
    # Gzip
    # ──────────────────────────────────────────────
${gzip.configLines.split('\n').map(l => `    ${l}`).join('\n')}

    # ──────────────────────────────────────────────
    # Rate Limiting
    # ──────────────────────────────────────────────
    ${rateLimiting.configLines[1]}

    # ──────────────────────────────────────────────
    # Static Files
    # ──────────────────────────────────────────────
    # Web assets (versioned — safe to cache aggressively)
    location /web/static/ {
        alias /usr/lib/python3/dist-packages/odoo/addons/web/static/;
        expires ${caching.webStaticExpiry};
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Image proxy (resized images — cache medium)
    location /web/image/ {
        proxy_pass http://odoo;
        expires ${caching.webImageExpiry};
    }

    # Filestore (attachments — cache long)
    location /web/filestore/ {
        alias /var/lib/odoo/filestore;
        expires ${caching.filestoreExpiry};
        add_header Cache-Control "public";
        access_log off;
    }

    # ──────────────────────────────────────────────
    # Long-polling (gevent) — no buffering
    # ──────────────────────────────────────────────
    location /longpolling/ {
        proxy_pass http://odoo-longpoll;
        proxy_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /websocket/ {
        proxy_pass http://odoo-longpoll;
        proxy_buffering off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # ──────────────────────────────────────────────
    # Main Proxy
    # ──────────────────────────────────────────────
    location / {
        proxy_pass http://odoo;
        proxy_redirect off;
    }

    # ──────────────────────────────────────────────
    # Deny access to sensitive files
    # ──────────────────────────────────────────────
    location ~ (/.ht|~$|\\.bak|\\.swp) {
        deny all;
        return 404;
    }
}
`

  return {
    config,
    params: {
      bodySize,
      buffers,
      timeouts,
      keepalive,
      rateLimiting,
      caching,
      buffering,
      sslCache,
      gzip,
      upstream,
    },
    warnings,
  }
}
