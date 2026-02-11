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
    console.log(`🛠️ AppManager ready – Supabase: ${supabaseUrl ? '✅' : '❌'}`);
  }

  async createAppServer(appId: string, appData: UserApp): Promise<{ port: number; url: string }> {
    if (this.apps.size >= this.maxConcurrentApps) {
      const oldestAppId = this.findOldestAppId();
      if (oldestAppId) await this.cleanupAppServer(oldestAppId);
    }

    const app = express();

    // ---------- Serve the static preview processor script ----------
    app.get('/preview-processor.js', (req, res) => {
      res.setHeader('Content-Type', 'application/javascript');
      res.send(`
        // Preview Processor – runs in the browser
        window.showError = (msg, type = 'Error', file = '', line = '', stack = '') => {
          const errorBadge = document.getElementById('error-badge');
          const errorCorner = document.getElementById('error-corner');
          const errorMsg = document.getElementById('error-message');
          let count = parseInt(document.getElementById('error-count').textContent || '0') + 1;
          document.getElementById('error-count').textContent = count;
          let details = \`\${type}: \${msg}\`;
          if (file) details += \`\\nFile: \${file}\`;
          if (line) details += \`\\nLine: \${line}\`;
          if (stack) details += \`\\n\\n\${stack}\`;
          errorMsg.textContent = details;
          errorBadge.style.display = 'flex';
          errorCorner.style.display = 'none';
        };

        async function processPreview() {
          // Read user data from JSON script
          const dataElement = document.getElementById('preview-data');
          if (!dataElement) return;
          const userData = JSON.parse(dataElement.textContent);
          const { html, js, supabaseUrl, supabaseAnonKey } = userData;

          // 1. Insert cleaned HTML (no script tags)
          const container = document.getElementById('user-app-root');
          container.innerHTML = html;

          // 2. Setup Supabase if configured
          if (supabaseUrl && supabaseAnonKey) {
            const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
            window.supabase = createClient(supabaseUrl, supabaseAnonKey);
            console.log('🔗 Supabase ready');
          }

          // 3. Wait for esbuild
          while (!window.__esbuild) await new Promise(r => setTimeout(r, 50));
          const esbuild = window.__esbuild;

          // 4. Collect all scripts from the user's HTML (inline and external)
          const allScripts = [];
          
          // Find all script tags in the container (they were not executed because they were inserted via innerHTML)
          const scriptTags = container.querySelectorAll('script');
          scriptTags.forEach(script => {
            const src = script.getAttribute('src');
            const code = script.textContent;
            script.remove(); // remove from DOM, we'll compile and inject
            allScripts.push({ src, code });
          });

          // Add the user's JS field as an additional script
          if (js && js.trim()) {
            allScripts.push({ src: null, code: js });
          }

          // 5. Process each script
          for (const { src, code } of allScripts) {
            try {
              let codeToCompile = code;
              
              // Fetch external script if src exists
              if (src) {
                try {
                  const response = await fetch(src);
                  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
                  codeToCompile = await response.text();
                } catch (fetchErr) {
                  window.showError(\`Failed to fetch \${src}: \${fetchErr.message}\`, 'FetchError');
                  continue;
                }
              }

              if (!codeToCompile || !codeToCompile.trim()) continue;

              // Determine loader
              let loader = 'js';
              if (src?.includes('.tsx')) loader = 'tsx';
              else if (src?.includes('.ts')) loader = 'ts';
              else if (src?.includes('.jsx')) loader = 'jsx';
              else if (codeToCompile.includes('React') || codeToCompile.includes('jsx')) loader = 'tsx';

              const result = await esbuild.transform(codeToCompile, {
                loader,
                jsx: 'automatic',
                target: 'es2020',
                format: 'esm',
              });

              const scriptEl = document.createElement('script');
              scriptEl.type = 'module';
              scriptEl.textContent = result.code;
              document.body.appendChild(scriptEl);
            } catch (err) {
              window.showError(err.message, 'CompilationError', src || 'inline');
            }
          }
        }

        // Start when DOM ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', processPreview);
        } else {
          processPreview();
        }
      `);
    });

    app.get('/', (req, res) => {
      // Prepare user data as JSON – safe from injection
      const userData = {
        html: appData.html || '',
        js: appData.js || '',
        supabaseUrl: this.supabaseUrl || null,
        supabaseAnonKey: this.supabaseAnonKey || null,
      };

      // ---------- MAIN HTML PAGE ----------
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} – Live Preview</title>
          
          <!-- Favicon -->
          <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
          
          <!-- ========== JQUERY – ALWAYS READY ========== -->
          <script>
            window.$ = window.jQuery = function(selector) {
              if (typeof selector === 'function') {
                if (document.readyState !== 'loading') selector();
                else document.addEventListener('DOMContentLoaded', selector);
                return window;
              }
              return document.querySelector(selector) || {
                ready: f => { f?.(); return this; },
                on: () => this,
                click: () => this,
                css: () => this,
                html: () => this
              };
            };
          </script>
          <script src="https://code.jquery.com/jquery-3.7.1.min.js" onload="window.$ = window.jQuery = jQuery.noConflict(true); console.log('✅ jQuery loaded');"></script>
          
          <!-- ========== ESBUILD COMPILER ========== -->
          <script>
            window.__esbuild = null;
            (async function() {
              try {
                const esbuild = await import('https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js');
                await esbuild.initialize({
                  wasmURL: 'https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm'
                });
                window.__esbuild = esbuild;
                console.log('✅ esbuild compiler ready');
              } catch (e) {
                console.error('❌ esbuild init failed:', e);
              }
            })();
          </script>
          
          <!-- ========== IMPORT MAP (React) ========== -->
          <script type="importmap">
            {
              "imports": {
                "react": "https://esm.sh/react@18.2.0",
                "react-dom": "https://esm.sh/react-dom@18.2.0/client",
                "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime"
              }
            }
          </script>
          
          <!-- ========== USER CSS ========== -->
          <style>${appData.css || ''}</style>
          
          <!-- ========== ERROR UI STYLES ========== -->
          <style>
            body { margin: 0; padding: 0; min-height: 100vh; background: white; }
            #error-badge {
              position: fixed; bottom: 20px; right: 20px;
              background: #d93025; color: white;
              border-radius: 30px; padding: 8px 16px;
              font-size: 13px; font-weight: 600;
              box-shadow: 0 4px 12px rgba(217,48,37,0.3);
              z-index: 999999; display: none; align-items: center; gap: 6px;
              cursor: pointer; border: none;
            }
            #error-corner {
              position: fixed; bottom: 20px; right: 20px;
              max-width: 360px; background: white;
              border: 1px solid #e0e0e0; border-radius: 12px;
              box-shadow: 0 8px 30px rgba(0,0,0,0.15);
              z-index: 999999; display: none; font-size: 13px;
            }
            #error-corner .inner { padding: 16px 20px; }
            #error-corner .header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-weight: 600; color: #d93025; }
            #error-corner .message {
              background: #f8f9fa; border-left: 4px solid #d93025;
              padding: 12px; font-family: 'Courier New', monospace;
              font-size: 12px; white-space: pre-wrap; max-height: 200px;
              overflow-y: auto; border-radius: 4px; margin: 10px 0;
            }
            #error-corner .actions { display: flex; gap: 8px; justify-content: flex-end; }
            #error-corner button {
              padding: 6px 12px; border-radius: 6px; border: none;
              font-size: 12px; font-weight: 500; cursor: pointer;
              background: #f1f3f4; color: #3c4043;
            }
            #error-corner .dismiss { background: #1a73e8; color: white; }
            .preview-watermark {
              position: fixed; bottom: 10px; left: 10px;
              background: rgba(0,0,0,0.6); color: white;
              padding: 4px 12px; border-radius: 20px;
              font-size: 11px; z-index: 9999;
            }
          </style>
        </head>
        <body>
          <!-- ========== USER DATA – SAFE JSON ========== -->
          <script id="preview-data" type="application/json">${JSON.stringify(userData)}</script>
          
          <!-- ========== USER APP CONTAINER ========== -->
          <div id="user-app-root"></div>
          
          <!-- ========== WATERMARK ========== -->
          <div class="preview-watermark">Preview Engine | ${appData.id}</div>
          
          <!-- ========== ERROR UI ========== -->
          <button id="error-badge" style="display: none;"><span>⚠️</span> <span id="error-count">0</span> errors</button>
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
          
          <!-- ========== GLOBAL ERROR HANDLER ========== -->
          <script>
            window.addEventListener('error', (e) => {
              e.preventDefault();
              const err = e.error || { message: e.message };
              if (window.showError) {
                window.showError(err.message, err.constructor?.name || 'Error', e.filename, e.lineno ? \`\${e.lineno}:\${e.colno}\` : '', err.stack);
              }
              return true;
            });
            window.addEventListener('unhandledrejection', (e) => {
              e.preventDefault();
              const reason = e.reason || {};
              if (window.showError) {
                window.showError(reason.message || String(reason), 'UnhandledRejection', '', '', reason.stack);
              }
              return true;
            });
          </script>
          
          <!-- ========== PREVIEW PROCESSOR ========== -->
          <script src="/preview-processor.js"></script>
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
        console.log(`🚀 Preview server for ${appId} on port ${port}`);
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
