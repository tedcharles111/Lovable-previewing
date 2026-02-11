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

    app.get('/', (req, res) => {
      const supabaseInjection = this.supabaseUrl
        ? `
        <!-- Supabase client (ES module) -->
        <script type="importmap">
          {
            "imports": {
              "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
            }
          }
        </script>
        <script type="module">
          import { createClient } from '@supabase/supabase-js';
          window.supabase = createClient('${this.supabaseUrl}', '${this.supabaseAnonKey}');
          console.log('🔗 Supabase ready');
        </script>`
        : '';

      // ---------- ULTIMATE PREVIEW ENGINE – INTERCEPTS & COMPILES EVERYTHING ----------
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} – Live Preview</title>
          
          <!-- Favicon (kills 404) -->
          <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
          
          <!-- ========== JQUERY – SYNCHRONOUS, ALWAYS READY ========== -->
          <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
          <script>
            if (typeof jQuery === 'undefined') {
              window.$ = window.jQuery = (s) => ({ ready: (f) => f?.() });
              console.warn('⚠️ jQuery fallback');
            } else {
              console.log('✅ jQuery loaded');
            }
          </script>
          
          <!-- ========== ESBUILD COMPILER – LOADED ONCE ========== -->
          <script>
            window.__PREVIEW_COMPILER = null;
            (async function loadEsbuild() {
              try {
                const esbuild = await import('https://esm.sh/esbuild-wasm@0.20.2?bundle');
                await esbuild.initialize({
                  wasmURL: 'https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm'
                });
                window.__PREVIEW_COMPILER = esbuild;
                console.log('✅ esbuild compiler ready');
              } catch (e) {
                console.error('❌ esbuild init failed:', e);
              }
            })();
          </script>
          
          <!-- ========== IMPORT MAP FOR REACT (PRE‑CONFIGURED) ========== -->
          <script type="importmap">
            {
              "imports": {
                "react": "https://esm.sh/react@18.2.0",
                "react-dom": "https://esm.sh/react-dom@18.2.0/client",
                "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime"
              }
            }
          </script>
          
          ${supabaseInjection}
          
          <!-- USER CSS – EXACTLY AS GIVEN -->
          <style>${appData.css || ''}</style>
          
          <!-- ========== ERROR CORNER – NEVER BLOCKS ========== -->
          <style>
            body { margin: 0; padding: 0; min-height: 100vh; background: white; }
            #error-badge, #error-corner { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
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
          <!-- USER'S HTML – WILL BE POPULATED WITH INTERCEPTED SCRIPTS -->
          <div id="user-app-root">${appData.html || '<div style="padding:40px;text-align:center;color:#666;">✨ Preview ready</div>'}</div>
          
          <!-- WATERMARK -->
          <div class="preview-watermark">Preview Engine | ${appData.id}</div>
          
          <!-- ========== ERROR UI ========== -->
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
          
          <!-- ========== SCRIPT INTERCEPTOR & COMPILER ========== -->
          <script type="module">
            // ----- ERROR HANDLER (non‑blocking) -----
            let errorCount = 0;
            const errorBadge = document.getElementById('error-badge');
            const errorCorner = document.getElementById('error-corner');
            const errorMsg = document.getElementById('error-message');
            window.showError = (msg, type = 'Error', file = '', line = '', stack = '') => {
              errorCount++;
              document.getElementById('error-count').textContent = errorCount;
              let details = \`\${type}: \${msg}\`;
              if (file) details += \`\\nFile: \${file}\`;
              if (line) details += \`\\nLine: \${line}\`;
              if (stack) details += \`\\n\\n\${stack}\`;
              errorMsg.textContent = details;
              errorBadge.style.display = 'flex';
              errorCorner.style.display = 'none';
            };
            errorBadge.addEventListener('click', () => {
              errorBadge.style.display = 'none';
              errorCorner.style.display = 'block';
            });
            window.addEventListener('error', (e) => {
              e.preventDefault();
              const err = e.error || { message: e.message };
              showError(err.message, err.constructor?.name || 'Error', e.filename, e.lineno ? \`\${e.lineno}:\${e.colno}\` : '', err.stack);
              return true;
            });
            window.addEventListener('unhandledrejection', (e) => {
              e.preventDefault();
              const reason = e.reason || {};
              showError(reason.message || String(reason), 'UnhandledRejection', '', '', reason.stack);
              return true;
            });

            // ----- SCRIPT QUEUE – INTERCEPT ALL SCRIPTS INSIDE USER-APP-ROOT -----
            const scriptQueue = [];
            const observer = new MutationObserver((mutations) => {
              mutations.forEach(mut => {
                mut.addedNodes.forEach(node => {
                  if (node.tagName === 'SCRIPT' && node.parentElement?.id === 'user-app-root') {
                    // Intercept script tag
                    const src = node.src;
                    const type = node.type;
                    const code = node.textContent;
                    
                    // Prevent execution by removing or changing type
                    node.type = 'text/plain'; // disables execution
                    
                    scriptQueue.push({ src, type, code, element: node });
                  }
                });
              });
            });
            
            // Start observing
            const root = document.getElementById('user-app-root');
            observer.observe(root, { childList: true, subtree: true });
            
            // Also catch scripts already in the HTML
            root.querySelectorAll('script').forEach(node => {
              if (!node.src && node.type !== 'module' && node.type !== 'importmap') {
                const src = node.src;
                const type = node.type;
                const code = node.textContent;
                node.type = 'text/plain';
                scriptQueue.push({ src, type, code, element: node });
              }
            });

            // ----- WAIT FOR ESBUILD, THEN COMPILE & EXECUTE -----
            async function processScripts() {
              const esbuild = window.__PREVIEW_COMPILER;
              if (!esbuild) {
                // If esbuild not ready, wait and retry
                setTimeout(processScripts, 100);
                return;
              }

              for (const item of scriptQueue) {
                try {
                  let codeToCompile = item.code;
                  
                  // If it's an external script, fetch it
                  if (item.src && !item.src.startsWith('data:')) {
                    try {
                      const response = await fetch(item.src);
                      codeToCompile = await response.text();
                    } catch (fetchErr) {
                      showError(\`Failed to fetch \${item.src}: \${fetchErr.message}\`, 'FetchError');
                      continue;
                    }
                  }

                  if (!codeToCompile || codeToCompile.trim() === '') continue;

                  // Compile with esbuild
                  const result = await esbuild.transform(codeToCompile, {
                    loader: 'tsx',        // handles TSX, JSX, TS, JS
                    jsx: 'automatic',
                    target: 'es2020',
                    format: 'esm',
                  });

                  // Inject as module script
                  const script = document.createElement('script');
                  script.type = 'module';
                  script.textContent = result.code;
                  document.body.appendChild(script);
                  
                } catch (err) {
                  showError(err.message, 'CompilationError', item.src || 'inline');
                }
              }
            }

            // Start processing when compiler ready
            (async function init() {
              while (!window.__PREVIEW_COMPILER) await new Promise(r => setTimeout(r, 50));
              await processScripts();
            })();
          </script>
          
          <!-- ========== USER'S ADDITIONAL JAVASCRIPT (js FIELD) ========== -->
          <script type="module">
            (async function() {
              const esbuild = window.__PREVIEW_COMPILER;
              const userCode = ${JSON.stringify(appData.js || '')};
              if (!userCode.trim()) return;
              
              // Wait for compiler
              while (!esbuild) await new Promise(r => setTimeout(r, 50));
              
              try {
                const result = await esbuild.transform(userCode, {
                  loader: 'tsx',
                  jsx: 'automatic',
                  target: 'es2020',
                  format: 'esm',
                });
                const script = document.createElement('script');
                script.type = 'module';
                script.textContent = result.code;
                document.body.appendChild(script);
              } catch (err) {
                showError(err.message, 'UserJSCompilationError');
              }
            })();
          </script>
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
