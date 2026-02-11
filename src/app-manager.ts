import express from 'express';
import { createServer, Server } from 'http';
import { UserApp } from './types';

export class AppManager {
  private apps: Map<string, { server: Server; port: number; app: UserApp }> = new Map();
  private usedPorts: Set<number> = new Set();
  private maxConcurrentApps: number;
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.maxConcurrentApps = parseInt(process.env.MAX_CONCURRENT_APPS || '5');
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
    console.log(`🛠️ AppManager initialized with Supabase: ${supabaseUrl ? '✅' : '❌'}`);
  }

  async createAppServer(appId: string, appData: UserApp): Promise<{ port: number; url: string }> {
    if (this.apps.size >= this.maxConcurrentApps) {
      const oldestAppId = this.findOldestAppId();
      if (oldestAppId) {
        await this.cleanupAppServer(oldestAppId);
      }
    }

    const app = express();

    app.get('/', (req, res) => {
      const supabaseInjection = this.supabaseUrl
        ? `
        <!-- SUPABASE CLIENT -->
        <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
        <script>
          try {
            window.supabase = supabase.createClient(
              '${this.supabaseUrl}',
              '${this.supabaseAnonKey}'
            );
            console.log('🔗 Supabase ready');
          } catch (err) {
            console.error('Supabase init failed:', err);
          }
        </script>`
        : '';

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} – Live Preview</title>
          
          <!-- FAVICON (prevents 404) -->
          <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
          
          <!-- ========== JQUERY – LOADS FIRST, SYNCHRONOUSLY ========== -->
          <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
          <script>
            // If jQuery fails, provide a safe fallback immediately
            if (typeof jQuery === 'undefined') {
              window.$ = window.jQuery = function(selector) {
                return {
                  ready: function(fn) { if (typeof fn === 'function') fn(); return this; },
                  on: function() { return this; },
                  click: function() { return this; },
                  css: function() { return this; },
                  html: function() { return this; }
                };
              };
              console.warn('⚠️ jQuery CDN failed – using fallback');
            } else {
              console.log('✅ jQuery loaded');
            }
          </script>
          <!-- ======================================================== -->
          
          ${supabaseInjection}
          
          <!-- USER CSS – injected as is -->
          <style>${appData.css || ''}</style>
          
          <!-- PREVIEW ENGINE STYLES (non‑blocking error corner) -->
          <style>
            body { margin: 0; padding: 0; min-height: 100vh; background: white; }
            
            /* ---------- SILENT ERROR CORNER – NEVER HIDES CONTENT ---------- */
            #error-corner {
              position: fixed;
              bottom: 20px;
              right: 20px;
              max-width: 360px;
              background: white;
              border: 1px solid #e0e0e0;
              border-radius: 12px;
              box-shadow: 0 8px 30px rgba(0,0,0,0.15);
              z-index: 999999;
              display: none;
              font-size: 13px;
              pointer-events: none;
            }
            #error-corner .inner {
              pointer-events: auto;
              padding: 16px 20px;
            }
            #error-corner .header {
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 10px;
              font-weight: 600;
              color: #d93025;
            }
            #error-corner .message {
              background: #f8f9fa;
              border-left: 4px solid #d93025;
              padding: 12px;
              font-family: 'Courier New', monospace;
              font-size: 12px;
              white-space: pre-wrap;
              max-height: 200px;
              overflow-y: auto;
              border-radius: 4px;
              margin: 10px 0;
            }
            #error-corner .actions {
              display: flex;
              gap: 8px;
              justify-content: flex-end;
            }
            #error-corner button {
              padding: 6px 12px;
              border-radius: 6px;
              border: none;
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
              background: #f1f3f4;
              color: #3c4043;
            }
            #error-corner button:hover { background: #e8eaed; }
            #error-corner .dismiss {
              background: #1a73e8;
              color: white;
            }
            #error-corner .dismiss:hover { background: #0d62d9; }
            
            #error-badge {
              position: fixed;
              bottom: 20px;
              right: 20px;
              background: #d93025;
              color: white;
              border-radius: 30px;
              padding: 8px 16px;
              font-size: 13px;
              font-weight: 600;
              box-shadow: 0 4px 12px rgba(217,48,37,0.3);
              z-index: 999998;
              display: none;
              align-items: center;
              gap: 6px;
              cursor: pointer;
              pointer-events: auto;
              border: none;
            }
            #error-badge:hover { background: #b91c1c; }
            
            .preview-watermark {
              position: fixed;
              bottom: 10px;
              left: 10px;
              background: rgba(0,0,0,0.6);
              color: white;
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 11px;
              z-index: 9999;
              pointer-events: none;
            }
          </style>
        </head>
        <body>
          <!-- USER'S HTML – EXACTLY AS PROVIDED, NO MODIFICATIONS -->
          <div id="user-app-root">
            ${appData.html || '<div style="padding:40px;text-align:center;color:#666;">✨ Preview ready – add HTML to see your app</div>'}
          </div>
          
          <!-- WATERMARK -->
          <div class="preview-watermark">Preview Engine | ${appData.id}</div>
          
          <!-- ========== SILENT ERROR UI ========== -->
          <button id="error-badge" style="display: none;"><span>⚠️</span> <span id="error-count">1</span> error</button>
          <div id="error-corner">
            <div class="inner">
              <div class="header"><span>⚠️</span> <span>Preview Error</span></div>
              <div id="error-message" class="message"></div>
              <div class="actions">
                <button class="dismiss" onclick="document.getElementById('error-corner').style.display='none'; document.getElementById('error-badge').style.display='flex';">Minimize</button>
                <button onclick="window.location.reload()">Reload</button>
              </div>
            </div>
          </div>
          
          <script>
            // ---------- GLOBAL ERROR CATCHER – NEVER BLOCKS ----------
            let errorCount = 0;
            const errorBadge = document.getElementById('error-badge');
            const errorCorner = document.getElementById('error-corner');
            const errorMessage = document.getElementById('error-message');
            
            function showError(msg, type = 'Error', file = '', line = '', stack = '') {
              errorCount++;
              document.getElementById('error-count').textContent = errorCount;
              let details = \`\${type}: \${msg}\`;
              if (file) details += \`\\nFile: \${file}\`;
              if (line) details += \`\\nLine: \${line}\`;
              if (stack) details += \`\\n\\n\${stack}\`;
              errorMessage.textContent = details;
              errorBadge.style.display = 'flex';
              errorCorner.style.display = 'none';
            }
            
            errorBadge.addEventListener('click', () => {
              errorBadge.style.display = 'none';
              errorCorner.style.display = 'block';
            });
            
            window.addEventListener('error', function(e) {
              e.preventDefault();
              const err = e.error || { message: e.message };
              showError(
                err.message || 'Unknown error',
                err.constructor?.name || 'Error',
                e.filename,
                e.lineno ? \`\${e.lineno}:\${e.colno}\` : '',
                err.stack
              );
              return true;
            });
            
            window.addEventListener('unhandledrejection', function(e) {
              e.preventDefault();
              const reason = e.reason || {};
              showError(
                reason.message || String(reason) || 'Promise rejection',
                'UnhandledRejection',
                '',
                '',
                reason.stack
              );
              return true;
            });
          </script>
          
          <!-- ========== USER JAVASCRIPT – EXECUTED AS A NORMAL SCRIPT TAG ========== -->
          ${appData.js ? `<script>${appData.js}</script>` : ''}
          <!-- ====================================================================== -->
        </body>
        </html>
      `);
    });

    const port = await this.findAvailablePort(10001, 10100);
    return new Promise((resolve, reject) => {
      const server = createServer(app);
      server.listen(port, () => {
        this.apps.set(appId, { server, port, app: appData });
        this.usedPorts.add(port);
        console.log(`🚀 Preview server started for ${appId} on port ${port}`);
        if (this.supabaseUrl) console.log(`   🔗 Supabase: ${this.supabaseUrl}`);
        const timeUntilExpiry = appData.expiresAt - Date.now();
        setTimeout(() => this.cleanupAppServer(appId), Math.max(timeUntilExpiry, 0));
        resolve({ port, url: `http://localhost:${port}` });
      });
      server.on('error', reject);
    });
  }

  private findOldestAppId(): string | null {
    let oldestId: string | null = null;
    let oldestTime = Date.now();
    for (const [appId, { app }] of this.apps) {
      if (app.createdAt < oldestTime) {
        oldestTime = app.createdAt;
        oldestId = appId;
      }
    }
    return oldestId;
  }

  getAppPort(appId: string): number | null {
    return this.apps.get(appId)?.port || null;
  }

  async cleanupAppServer(appId: string): Promise<void> {
    const app = this.apps.get(appId);
    if (app) {
      await new Promise(resolve => app.server.close(resolve));
      this.usedPorts.delete(app.port);
      this.apps.delete(appId);
      console.log(`🧹 Cleaned up: ${appId}`);
    }
  }

  private async findAvailablePort(start: number, end: number): Promise<number> {
    const net = require('net');
    for (let port = start; port <= end; port++) {
      if (this.usedPorts.has(port)) continue;
      const isAvailable = await new Promise(resolve => {
        const server = net.createServer();
        server.listen(port, () => { server.close(() => resolve(true)); });
        server.on('error', () => resolve(false));
      });
      if (isAvailable) return port;
    }
    throw new Error('No available ports');
  }

  getActiveAppCount(): number {
    return this.apps.size;
  }
}
