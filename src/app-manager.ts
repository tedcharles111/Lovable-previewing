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

    // Serve the user's REAL application with enhanced error handling
    app.get('/', (req, res) => {
      const supabaseInjection = this.supabaseUrl
        ? `
        <!-- SUPABASE CLIENT INJECTION -->
        <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
        <script>
          try {
            const supabase = window.supabase || supabase.createClient(
              '${this.supabaseUrl}',
              '${this.supabaseAnonKey}'
            );
            window.supabase = supabase;
            console.log('🔗 Supabase client ready for preview.');
          } catch (err) {
            console.error('Failed to initialize Supabase:', err);
          }
        </script>`
        : '';

      // PROCESS USER HTML - Replace inline scripts with safe versions
      let processedHtml = appData.html || '';
      
      // Extract inline scripts from user's HTML and process them
      const inlineScripts: string[] = [];
      processedHtml = processedHtml.replace(
        /<script\b[^>]*>(.*?)<\/script>/gis,
        (match, scriptContent) => {
          if (match.includes('src=')) {
            return match; // Keep external scripts as is
          }
          // Store inline script and replace with a marker
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
          
          <!-- JQUERY - LOAD FIRST AND GUARANTEE $ IS AVAILABLE -->
          <script>
            // Define $ immediately to prevent reference errors
            window.$ = window.jQuery = function(selector) {
              if (typeof selector === 'string') {
                return document.querySelector(selector);
              } else if (typeof selector === 'function') {
                // Handle $(document).ready() calls
                if (document.readyState !== 'loading') {
                  setTimeout(selector, 0);
                } else {
                  document.addEventListener('DOMContentLoaded', selector);
                }
                return selector;
              }
              return selector || document;
            };
            
            // Mock common jQuery methods
            window.$.fn = window.$.prototype = {
              addClass: function(cls) {
                this.classList?.add(cls);
                return this;
              },
              removeClass: function(cls) {
                this.classList?.remove(cls);
                return this;
              },
              css: function(prop, value) {
                if (typeof prop === 'object') {
                  Object.keys(prop).forEach(k => this.style[k] = prop[k]);
                } else if (value !== undefined) {
                  this.style[prop] = value;
                }
                return this;
              },
              show: function() {
                this.style.display = '';
                return this;
              },
              hide: function() {
                this.style.display = 'none';
                return this;
              },
              click: function(handler) {
                this.addEventListener('click', handler);
                return this;
              }
            };
            
            console.log('💡 $ defined (temporary fallback)');
            
            // Now load real jQuery
            (function() {
              var script = document.createElement('script');
              script.src = 'https://code.jquery.com/jquery-3.7.1.min.js';
              script.onload = function() {
                console.log('✅ jQuery loaded successfully');
                // Replace our fallback with real jQuery
                window.$ = window.jQuery = jQuery.noConflict(true);
                
                // Execute any pending jQuery code
                if (window.__pendingJQueryCalls) {
                  window.__pendingJQueryCalls.forEach(function(call) {
                    try {
                      call();
                    } catch(e) {
                      console.error('Pending jQuery call error:', e);
                    }
                  });
                  delete window.__pendingJQueryCalls;
                }
                
                console.log('✅ jQuery ready, real $ available');
              };
              script.onerror = function() {
                console.warn('⚠️ jQuery failed to load, using fallback');
              };
              document.head.appendChild(script);
            })();
          </script>
          
          ${supabaseInjection}
          
          <!-- USER'S CSS -->
          <style>
            /* Base styles */
            body {
              margin: 0;
              padding: 0;
              min-height: 100vh;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: white;
            }
            
            /* Error overlay */
            #preview-engine-error {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(255, 255, 255, 0.98);
              z-index: 10000;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 20px;
              display: none;
            }
            
            #preview-engine-error.show {
              display: flex;
            }
            
            .error-box {
              background: white;
              border-radius: 12px;
              padding: 30px;
              max-width: 800px;
              max-height: 80vh;
              overflow-y: auto;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              border: 1px solid #e0e0e0;
            }
            
            .error-header {
              color: #d93025;
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 15px;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            
            .error-content {
              background: #f8f9fa;
              border: 1px solid #dadce0;
              border-radius: 8px;
              padding: 20px;
              margin: 20px 0;
              font-family: 'Courier New', monospace;
              white-space: pre-wrap;
              word-break: break-word;
              max-height: 300px;
              overflow-y: auto;
              font-size: 14px;
            }
            
            .error-actions {
              display: flex;
              gap: 10px;
              justify-content: flex-end;
              margin-top: 20px;
            }
            
            .error-button {
              padding: 10px 20px;
              border-radius: 6px;
              border: none;
              cursor: pointer;
              font-weight: 500;
              font-size: 14px;
              transition: all 0.2s;
            }
            
            .error-dismiss {
              background: #1a73e8;
              color: white;
            }
            
            .error-dismiss:hover {
              background: #0d62d9;
            }
            
            .error-reload {
              background: #f1f3f4;
              color: #3c4043;
            }
            
            .error-reload:hover {
              background: #e8eaed;
            }
            
            .preview-watermark {
              position: fixed;
              bottom: 10px;
              right: 10px;
              background: rgba(0, 0, 0, 0.7);
              color: white;
              padding: 5px 10px;
              border-radius: 4px;
              font-size: 12px;
              z-index: 9999;
              font-family: monospace;
            }
            
            ${appData.css || ''}
          </style>
        </head>
        <body>
          <!-- ERROR OVERLAY -->
          <div id="preview-engine-error">
            <div class="error-box">
              <div class="error-header">
                <span>⚠️</span>
                <span>Preview Error Detected</span>
              </div>
              <p>This error helps the LLM understand what needs fixing:</p>
              <div class="error-content" id="error-details">
                Loading error details...
              </div>
              <div class="error-actions">
                <button class="error-button error-dismiss" onclick="document.getElementById('preview-engine-error').classList.remove('show')">
                  Dismiss
                </button>
                <button class="error-button error-reload" onclick="window.location.reload()">
                  Reload Preview
                </button>
              </div>
            </div>
          </div>
          
          <!-- USER'S HTML -->
          <div id="user-app-container">
            ${processedHtml || '<div style="padding:40px;text-align:center;color:#666;font-size:14px;"><p>🎉 Live Preview Loaded</p><p>Add HTML content to see your app here.</p></div>'}
          </div>
          
          <!-- WATERMARK -->
          <div class="preview-watermark">
            Preview Engine | ${appData.id}
          </div>
          
          <!-- MAIN SCRIPT - HANDLES EVERYTHING -->
          <script>
            // GLOBAL ERROR HANDLER - CATCHES EVERYTHING
            window.addEventListener('error', function(event) {
              event.preventDefault();
              
              var error = event.error || { message: event.message };
              var filename = event.filename || 'Inline script';
              var line = event.lineno || 'Unknown';
              var col = event.colno || 'Unknown';
              
              console.error('🚨 Preview Engine Error:', error.message);
              
              var errorDetails = 'Error: ' + error.message + 
                '\\nType: ' + (error.constructor?.name || 'Error') +
                '\\nFile: ' + filename + 
                '\\nLine: ' + line + ', Column: ' + col;
              
              if (error.stack) {
                errorDetails += '\\n\\nStack Trace:\\n' + error.stack;
              }
              
              // Show in overlay
              var detailsEl = document.getElementById('error-details');
              var overlayEl = document.getElementById('preview-engine-error');
              
              if (detailsEl && overlayEl) {
                detailsEl.textContent = errorDetails;
                overlayEl.classList.add('show');
              }
              
              return true;
            });
            
            // HANDLE UNHANDLED PROMISE REJECTIONS
            window.addEventListener('unhandledrejection', function(event) {
              event.preventDefault();
              
              console.error('🚨 Unhandled Promise Rejection:', event.reason);
              
              var errorDetails = 'Promise Rejection: ' + 
                (event.reason?.message || String(event.reason) || 'Unknown rejection');
              
              if (event.reason?.stack) {
                errorDetails += '\\n\\nStack Trace:\\n' + event.reason.stack;
              }
              
              var detailsEl = document.getElementById('error-details');
              var overlayEl = document.getElementById('preview-engine-error');
              
              if (detailsEl && overlayEl) {
                detailsEl.textContent = errorDetails;
                overlayEl.classList.add('show');
              }
              
              return true;
            });
            
            // EXECUTE USER'S INLINE SCRIPTS FROM HTML
            function executeInlineScripts() {
              console.log('🔄 Executing inline scripts from HTML...');
              
              // Find all inline script markers
              for (let i = 0; i < ${inlineScripts.length}; i++) {
                const markerId = 'inline-script-' + i;
                const marker = document.getElementById(markerId);
                if (marker) {
                  const scriptContent = \`${inlineScripts.map(s => s.replace(/\\/g, '\\\\').replace(/\`/g, '\\\`').replace(/\$/g, 'window.$')).join('`, `')}\`;
                  
                  if (i < ${inlineScripts.length}) {
                    const content = [${inlineScripts.map(s => `\`${s.replace(/\\/g, '\\\\').replace(/\`/g, '\\\`').replace(/\$/g, 'window.$')}\``).join(', ')}][i];
                    
                    try {
                      // Create and execute the script
                      const scriptEl = document.createElement('script');
                      scriptEl.textContent = content;
                      document.head.appendChild(scriptEl);
                      document.head.removeChild(scriptEl);
                      console.log(\`✅ Inline script \${i} executed\`);
                    } catch (err) {
                      console.error(\`❌ Error in inline script \${i}:\`, err);
                      // Error will be caught by global handler
                    }
                    
                    // Remove the marker
                    marker.remove();
                  }
                }
              }
            }
            
            // EXECUTE USER'S MAIN JAVASCRIPT
            function executeUserJavaScript() {
              var userCode = \`${appData.js || ''}\`.trim();
              
              if (!userCode) {
                console.log('📝 No user JavaScript provided in js field');
                return;
              }
              
              console.log('🚀 Executing user JavaScript from js field...');
              
              try {
                // Replace $ with window.$ to ensure it uses our jQuery
                var safeCode = userCode.replace(/\\$/g, 'window.$');
                
                // Create and execute function
                var userFunction = new Function('window', 'document', '$', 'jQuery', \`
                  try {
                    \${safeCode}
                  } catch(e) {
                    console.error('User code error:', e);
                    throw e;
                  }
                \`);
                
                userFunction(window, document, window.$, window.jQuery);
                console.log('✅ User JavaScript executed successfully');
                
              } catch (err) {
                console.error('❌ Error executing user JavaScript:', err);
                throw err; // Will be caught by global handler
              }
            }
            
            // MAIN EXECUTION FLOW
            function initializePreview() {
              console.log('🏁 Initializing preview engine...');
              
              // Execute inline scripts first
              executeInlineScripts();
              
              // Then execute user's main JavaScript
              executeUserJavaScript();
              
              console.log('🎉 Preview engine initialization complete');
            }
            
            // WAIT FOR JQUERY TO LOAD, THEN INITIALIZE
            function waitForJQueryAndInitialize() {
              var maxAttempts = 50; // 5 seconds
              var attempts = 0;
              
              function check() {
                if (window.$ && typeof window.$ === 'function') {
                  console.log('✅ jQuery ready, starting preview...');
                  setTimeout(initializePreview, 100); // Small delay for safety
                } else if (attempts < maxAttempts) {
                  attempts++;
                  setTimeout(check, 100);
                } else {
                  console.warn('⚠️ jQuery not loaded after timeout, proceeding anyway');
                  initializePreview();
                }
              }
              
              check();
            }
            
            // START WHEN DOM IS READY
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', waitForJQueryAndInitialize);
            } else {
              waitForJQueryAndInitialize();
            }
            
            // Pending jQuery calls queue
            window.__pendingJQueryCalls = window.__pendingJQueryCalls || [];
          </script>
        </body>
        </html>
      `);
    });

    // Find available port
    const port = await this.findAvailablePort(10001, 10100);

    return new Promise((resolve, reject) => {
      const server = createServer(app);

      server.listen(port, () => {
        this.apps.set(appId, { server, port, app: appData });
        this.usedPorts.add(port);

        console.log(`🚀 REAL App server started for ${appId} on port ${port}`);
        if (this.supabaseUrl) {
          console.log(`   🔗 Includes Supabase backend: ${this.supabaseUrl}`);
        }

        // Schedule cleanup
        const timeUntilExpiry = appData.expiresAt - Date.now();
        setTimeout(() => {
          this.cleanupAppServer(appId);
        }, Math.max(timeUntilExpiry, 0));

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
      await new Promise((resolve) => app.server.close(resolve));
      this.usedPorts.delete(app.port);
      this.apps.delete(appId);
      console.log(`🧹 Cleaned up app: ${appId}`);
    }
  }

  private async findAvailablePort(start: number, end: number): Promise<number> {
    const net = require('net');

    for (let port = start; port <= end; port++) {
      if (this.usedPorts.has(port)) continue;

      const isAvailable = await new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
          server.close(() => resolve(true));
        });
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
