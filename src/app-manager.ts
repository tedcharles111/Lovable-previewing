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
      // ---------- SUPABASE (only if configured) ----------
      const supabaseInjection = this.supabaseUrl
        ? `
        <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
        <script>
          try {
            window.supabase = supabase.createClient(
              '${this.supabaseUrl}',
              '${this.supabaseAnonKey}'
            );
            console.log('🔗 Supabase ready');
          } catch (e) { console.error(e); }
        </script>`
        : '';

      // ---------- PREVIEW ENGINE – ULTRA FORGIVING, SELF‑COMPILING ----------
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} – Live Preview</title>
          
          <!-- FAVICON (kills 404) -->
          <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
          
          <!-- ========== JQUERY – SYNCHRONOUS, ALWAYS READY ========== -->
          <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
          <script>
            if (typeof jQuery === 'undefined') {
              window.$ = window.jQuery = function(s) { return { ready: function(f) { f?.(); } }; };
              console.warn('⚠️ jQuery fallback');
            } else {
              console.log('✅ jQuery loaded');
            }
          </script>
          <!-- ======================================================== -->
          
          ${supabaseInjection}
          
          <!-- ========== COMPILER CORE – ESBUILD (LOADED ONCE) ========== -->
          <script>
            window.__PREVIEW_COMPILER_READY = false;
            (function loadEsbuild() {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.20.2/esm/browser.js';
              script.type = 'module';
              script.onload = async () => {
                try {
                  const esbuild = await import('https://cdn.jsdelivr.net/npm/esbuild-wasm@0.20.2/esm/browser.js');
                  await esbuild.initialize({ wasmURL: 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.20.2/esbuild.wasm' });
                  window.__esbuild = esbuild;
                  window.__PREVIEW_COMPILER_READY = true;
                  console.log('✅ esbuild compiler ready – can compile TSX/JSX/TS');
                } catch (e) {
                  console.error('❌ esbuild init failed:', e);
                }
              };
              document.head.appendChild(script);
            })();
          </script>
          <!-- =========================================================== -->
          
          <!-- USER CSS – EXACTLY AS GIVEN -->
          <style>${appData.css || ''}</style>
          
          <!-- ========== ERROR CORNER – NEVER BLOCKS, ALWAYS POLITE ========== -->
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
          <!-- USER HTML – EXACT, UNTOUCHED -->
          <div id="user-app-root">
            ${appData.html || '<div style="padding:40px;text-align:center;color:#666;">✨ Preview ready</div>'}
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
            // ---------- GLOBAL ERROR CATCHER – NEVER INTERRUPTS ----------
            let errorCount = 0;
            const errorBadge = document.getElementById('error-badge');
            const errorCorner = document.getElementById('error-corner');
            const errorMsg = document.getElementById('error-message');
            function showError(msg, type = 'Error', file = '', line = '', stack = '') {
              errorCount++;
              document.getElementById('error-count').textContent = errorCount;
              let details = \`\${type}: \${msg}\`;
              if (file) details += \`\\nFile: \${file}\`;
              if (line) details += \`\\nLine: \${line}\`;
              if (stack) details += \`\\n\\n\${stack}\`;
              errorMsg.textContent = details;
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
              showError(err.message, err.constructor?.name || 'Error', e.filename, e.lineno ? \`\${e.lineno}:\${e.colno}\` : '', err.stack);
              return true;
            });
            window.addEventListener('unhandledrejection', function(e) {
              e.preventDefault();
              const reason = e.reason || {};
              showError(reason.message || String(reason), 'UnhandledRejection', '', '', reason.stack);
              return true;
            });
          </script>
          
          <!-- ========== SMART COMPILER & RUNTIME INJECTOR ========== -->
          <script type="module">
            // 1. Detect if React/JSX is used – inject React, ReactDOM
            const needsReact = 
              ${JSON.stringify(appData.html || '')}.includes('React') || 
              ${JSON.stringify(appData.js || '')}.includes('React') ||
              /<\\w+\\s*\\/?>|\\/\\s*<|\\/>/.test(${JSON.stringify(appData.html || '')}) ||
              /import.*from\\s+['"]react['"]/.test(${JSON.stringify(appData.js || '')});
            
            if (needsReact) {
              console.log('⚛️ React detected – loading React and ReactDOM');
              await Promise.all([
                import('https://esm.sh/react@18.2.0'),
                import('https://esm.sh/react-dom@18.2.0/client')
              ]).then(([React, ReactDOMClient]) => {
                window.React = React;
                window.ReactDOM = { createRoot: ReactDOMClient.createRoot };
                console.log('✅ React 18 ready');
              }).catch(e => showError('React load failed: ' + e.message, 'DependencyError'));
            }
            
            // 2. Find all script tags (inline and external) that need compilation
            const scriptsToCompile = [];
            document.querySelectorAll('script[type="text/babel"], script:not([src]):not([type])').forEach(el => {
              if (el.textContent.includes('React') || el.textContent.includes('jsx') || el.textContent.includes('tsx')) {
                scriptsToCompile.push(el.textContent);
                el.remove(); // remove original, we'll inject compiled version
              }
            });
            
            // 3. If there is user JS in the appData.js, add it to the compilation queue
            if (${JSON.stringify(appData.js || '')}.trim()) {
              scriptsToCompile.push(${JSON.stringify(appData.js || '')});
            }
            
            // 4. Compile everything with esbuild (if compiler ready, otherwise fallback)
            if (scriptsToCompile.length > 0 && window.__PREVIEW_COMPILER_READY) {
              const esbuild = window.__esbuild;
              const compilePromises = scriptsToCompile.map(code =>
                esbuild.transform(code, {
                  loader: 'tsx',   // handles TSX, JSX, TS, JS
                  jsx: 'automatic',
                  target: 'es2020',
                  format: 'esm',
                }).catch(err => {
                  showError(err.message, 'CompilationError');
                  return null;
                })
              );
              
              const results = await Promise.all(compilePromises);
              results.forEach(result => {
                if (result && result.code) {
                  const script = document.createElement('script');
                  script.type = 'module';
                  script.textContent = result.code;
                  document.body.appendChild(script);
                }
              });
            } else if (scriptsToCompile.length > 0) {
              console.warn('⚠️ esbuild not ready – executing raw code (may fail)');
              scriptsToCompile.forEach(code => {
                try {
                  eval(code); // last resort
                } catch (e) {
                  showError(e.message, 'RawEvalError');
                }
              });
            }
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
