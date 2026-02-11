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
            const supabase = window.supabase || supabase.createClient(
              '${this.supabaseUrl}',
              '${this.supabaseAnonKey}'
            );
            window.supabase = supabase;
            console.log('🔗 Supabase client ready.');
          } catch (err) {
            console.error('Supabase init failed:', err);
          }
        </script>`
        : '';

      // Process user HTML – extract inline scripts
      let processedHtml = appData.html || '';
      const inlineScripts: string[] = [];
      processedHtml = processedHtml.replace(
        /<script\b[^>]*>(.*?)<\/script>/gis,
        (match, scriptContent) => {
          if (match.includes('src=')) return match;
          const id = `inline-script-${inlineScripts.length}`;
          inlineScripts.push(scriptContent.trim());
          return `<div id="${id}" style="display:none;"></div>`;
        }
      );

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} - Live Preview</title>
          
          <!-- FAVICON -->
          <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
          
          <!-- ========== JQUERY – ALWAYS SAFE ========== -->
          <script>
            // INSTANT $ PLACEHOLDER – PREVENTS ALL $ ERRORS
            window.$ = window.jQuery = function(selector) {
              if (typeof selector === 'string') {
                return document.querySelector(selector) || {
                  on: function() { return this; },
                  click: function() { return this; },
                  css: function() { return this; },
                  html: function() { return this; },
                  ready: function(fn) { if (typeof fn === 'function') fn(); return this; }
                };
              }
              if (typeof selector === 'function') {
                if (document.readyState !== 'loading') setTimeout(selector, 0);
                else document.addEventListener('DOMContentLoaded', selector);
              }
              return window;
            };
            console.log('💡 $ placeholder active – no jQuery errors');
            
            // Load real jQuery
            (function() {
              var script = document.createElement('script');
              script.src = 'https://code.jquery.com/jquery-3.7.1.min.js';
              script.onload = function() {
                console.log('✅ jQuery loaded');
                window.$ = window.jQuery = jQuery.noConflict(true);
                if (window.__pendingJQueryCalls) {
                  window.__pendingJQueryCalls.forEach(function(fn) { try { fn(); } catch(e) {} });
                  delete window.__pendingJQueryCalls;
                }
              };
              script.onerror = function() {
                console.warn('⚠️ jQuery CDN failed – placeholder remains');
              };
              document.head.appendChild(script);
            })();
          </script>
          <!-- =========================================== -->
          
          ${supabaseInjection}
          
          <!-- USER CSS + PREVIEW ENGINE STYLES -->
          <style>
            /* Base reset – always let user's app be visible */
            body {
              margin: 0;
              padding: 0;
              min-height: 100vh;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: white;
            }
            
            /* ---------- NON-BLOCKING ERROR CORNER ---------- */
            #preview-error-corner {
              position: fixed;
              bottom: 20px;
              right: 20px;
              max-width: 380px;
              width: auto;
              background: white;
              border: 1px solid #e0e0e0;
              border-radius: 12px;
              box-shadow: 0 8px 30px rgba(0,0,0,0.2);
              z-index: 99999;
              display: none;
              overflow: hidden;
              font-size: 13px;
              pointer-events: none; /* lets clicks pass through the container */
            }
            
            #preview-error-corner .error-content {
              pointer-events: auto; /* but the box itself is clickable */
              padding: 16px 20px;
              background: white;
            }
            
            #preview-error-corner .error-header {
              display: flex;
              align-items: center;
              gap: 10px;
              margin-bottom: 10px;
            }
            
            #preview-error-corner .error-icon {
              color: #d93025;
              font-size: 20px;
              font-weight: bold;
            }
            
            #preview-error-corner .error-title {
              font-weight: 600;
              color: #202124;
              flex: 1;
            }
            
            #preview-error-corner .error-message {
              background: #f8f9fa;
              border-left: 4px solid #d93025;
              padding: 12px;
              font-family: 'Courier New', monospace;
              font-size: 12px;
              white-space: pre-wrap;
              word-break: break-word;
              max-height: 200px;
              overflow-y: auto;
              border-radius: 4px;
              margin: 10px 0;
            }
            
            #preview-error-corner .error-actions {
              display: flex;
              gap: 8px;
              justify-content: flex-end;
            }
            
            #preview-error-corner .error-btn {
              padding: 6px 12px;
              border-radius: 6px;
              border: none;
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
              background: #f1f3f4;
              color: #3c4043;
              transition: background 0.2s;
            }
            
            #preview-error-corner .error-btn:hover {
              background: #e8eaed;
            }
            
            #preview-error-corner .error-btn-dismiss {
              background: #1a73e8;
              color: white;
            }
            
            #preview-error-corner .error-btn-dismiss:hover {
              background: #0d62d9;
            }
            
            /* Error badge – tiny counter when minimized */
            #preview-error-badge {
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
              z-index: 99998;
              display: none;
              align-items: center;
              gap: 6px;
              cursor: pointer;
              pointer-events: auto;
              border: none;
            }
            
            #preview-error-badge:hover {
              background: #b91c1c;
            }
            
            .preview-watermark {
              position: fixed;
              bottom: 10px;
              left: 10px;
              background: rgba(0,0,0,0.6);
              color: white;
              padding: 4px 10px;
              border-radius: 20px;
              font-size: 11px;
              z-index: 9999;
              pointer-events: none;
            }
            
            ${appData.css || ''}
          </style>
        </head>
        <body>
          <!-- USER'S APP – ALWAYS VISIBLE, ALWAYS INTERACTIVE -->
          <div id="user-app-root">
            ${processedHtml || '<div style="padding:40px;text-align:center;color:#666;">✨ Live Preview – your app will appear here</div>'}
          </div>
          
          <!-- WATERMARK – DISCREET -->
          <div class="preview-watermark">Preview Engine | ${appData.id}</div>
          
          <!-- ========== NON-BLOCKING ERROR UI ========== -->
          <!-- Error badge (minimized) -->
          <button id="preview-error-badge" style="display: none;">
            <span>⚠️</span> <span id="error-badge-count">1</span> error
          </button>
          
          <!-- Error corner (expanded) -->
          <div id="preview-error-corner">
            <div class="error-content">
              <div class="error-header">
                <span class="error-icon">⚠️</span>
                <span class="error-title">Preview Error Detected</span>
              </div>
              <div id="error-message-box" class="error-message">Loading...</div>
              <div class="error-actions">
                <button class="error-btn error-btn-dismiss" onclick="document.getElementById('preview-error-corner').style.display='none'; document.getElementById('preview-error-badge').style.display='flex';">Minimize</button>
                <button class="error-btn" onclick="window.location.reload()">Reload</button>
              </div>
            </div>
          </div>
          <!-- ============================================= -->
          
          <script>
            // ---------- ERROR HANDLER – ALWAYS NON-BLOCKING ----------
            let errorCount = 0;
            const errorBadge = document.getElementById('preview-error-badge');
            const errorCorner = document.getElementById('preview-error-corner');
            const errorMessageBox = document.getElementById('error-message-box');
            
            function showError(message, type = 'Error', filename = '', line = '', stack = '') {
              errorCount++;
              const badgeCount = document.getElementById('error-badge-count');
              if (badgeCount) badgeCount.textContent = errorCount;
              
              // Build detailed error message
              let details = \`\${type}: \${message}\`;
              if (filename) details += \`\\nFile: \${filename}\`;
              if (line) details += \`\\nLine: \${line}\`;
              if (stack) details += \`\\n\\nStack:\\n\${stack}\`;
              
              errorMessageBox.textContent = details;
              
              // Show badge, hide corner initially
              errorBadge.style.display = 'flex';
              errorCorner.style.display = 'none';
            }
            
            // Click on badge expands error corner
            errorBadge.addEventListener('click', function() {
              errorBadge.style.display = 'none';
              errorCorner.style.display = 'block';
            });
            
            // Global error handler – catches everything
            window.addEventListener('error', function(event) {
              event.preventDefault();
              const err = event.error || { message: event.message };
              showError(
                err.message || 'Unknown error',
                err.constructor?.name || 'Error',
                event.filename,
                event.lineno ? \`\${event.lineno}:\${event.colno}\` : '',
                err.stack
              );
              console.error('🚨 Preview Error (non-blocking):', err);
              return true;
            });
            
            // Unhandled promise rejections
            window.addEventListener('unhandledrejection', function(event) {
              event.preventDefault();
              const reason = event.reason || {};
              showError(
                reason.message || String(reason) || 'Promise rejection',
                'UnhandledRejection',
                '',
                '',
                reason.stack
              );
              console.error('🚨 Unhandled Rejection (non-blocking):', reason);
              return true;
            });
            
            // ---------- EXECUTE USER'S INLINE SCRIPTS ----------
            function executeInlineScripts() {
              const scripts = [${inlineScripts.map(s => `\`${s.replace(/\\/g, '\\\\').replace(/\`/g, '\\\`').replace(/\$/g, 'window.$')}\``).join(', ')}];
              for (let i = 0; i < scripts.length; i++) {
                const marker = document.getElementById('inline-script-' + i);
                if (marker) {
                  try {
                    const scriptEl = document.createElement('script');
                    scriptEl.textContent = scripts[i];
                    document.head.appendChild(scriptEl);
                    document.head.removeChild(scriptEl);
                    console.log(\`✅ Inline script \${i} executed\`);
                  } catch (err) {
                    console.error(\`❌ Inline script \${i} error:\`, err);
                    // Error will be displayed via global handler
                  }
                  marker.remove();
                }
              }
            }
            
            // ---------- EXECUTE USER'S MAIN JAVASCRIPT ----------
            function executeUserJavaScript() {
              const userCode = \`${appData.js || ''}\`.trim();
              if (!userCode) {
                console.log('📝 No user JavaScript provided');
                return;
              }
              console.log('🚀 Executing user JavaScript...');
              try {
                const safeCode = userCode.replace(/\\$/g, 'window.$');
                const fn = new Function('window', 'document', '$', 'jQuery', 'supabase', \`
                  try { \${safeCode} } catch(e) { console.error(e); throw e; }
                \`);
                fn(window, document, window.$, window.jQuery, window.supabase);
                console.log('✅ User JavaScript executed');
              } catch (err) {
                // Will be caught by global handler
                throw err;
              }
            }
            
            // ---------- BOOTSTRAP ----------
            function startPreview() {
              console.log('🏁 Starting preview...');
              executeInlineScripts();
              executeUserJavaScript();
            }
            
            // Wait for DOM and jQuery
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', function() {
                if (window.$ && typeof window.$ === 'function') startPreview();
                else {
                  console.log('⏳ Waiting for jQuery...');
                  let attempts = 0;
                  const interval = setInterval(function() {
                    if (window.$ && typeof window.$ === 'function') {
                      clearInterval(interval);
                      startPreview();
                    } else if (attempts++ > 50) {
                      clearInterval(interval);
                      console.warn('⚠️ jQuery timeout – starting anyway');
                      startPreview();
                    }
                  }, 100);
                }
              });
            } else {
              if (window.$ && typeof window.$ === 'function') startPreview();
              else setTimeout(startPreview, 300);
            }
            
            // Queue for pending jQuery calls
            window.__pendingJQueryCalls = window.__pendingJQueryCalls || [];
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
        console.log(`🚀 REAL App server started for ${appId} on port ${port}`);
        if (this.supabaseUrl) console.log(`   🔗 Includes Supabase backend: ${this.supabaseUrl}`);
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
      console.log(`🧹 Cleaned up app: ${appId}`);
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
