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

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} - Live Preview</title>
          
          <!-- FAVICON FIX -->
          <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>">
          
          <!-- ULTRA-EARLY JQUERY LOADING - CRITICAL FIX -->
          <script>
            // Load jQuery IMMEDIATELY to prevent early $ errors
            (function() {
              console.log('🔄 Loading jQuery for preview...');
              var jqScript = document.createElement('script');
              jqScript.src = 'https://code.jquery.com/jquery-3.7.1.min.js';
              jqScript.integrity = 'sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=';
              jqScript.crossOrigin = 'anonymous';
              
              jqScript.onload = function() {
                console.log('✅ jQuery loaded successfully');
                // Ensure $ and jQuery are available globally
                window.$ = window.jQuery = jQuery.noConflict(true);
                console.log('✅ jQuery ready, $ defined:', typeof window.$);
              };
              
              jqScript.onerror = function() {
                console.warn('⚠️ jQuery failed to load, creating fallback');
                window.$ = window.jQuery = function(selector) {
                  console.warn('Using jQuery fallback for selector:', selector);
                  if (typeof selector === 'string') {
                    return document.querySelector(selector);
                  } else if (typeof selector === 'function') {
                    // Handle $(document).ready()
                    if (document.readyState !== 'loading') {
                      selector();
                    } else {
                      document.addEventListener('DOMContentLoaded', selector);
                    }
                  }
                  return selector;
                };
                window.$.ajax = function() {
                  console.warn('jQuery.ajax is not available in fallback mode');
                };
              };
              
              // Insert jQuery FIRST before any other scripts
              document.head.insertBefore(jqScript, document.head.firstChild);
            })();
          </script>
          
          ${supabaseInjection}
          
          <!-- USER'S CSS -->
          <style>
            /* Base styles to prevent white screen */
            body {
              margin: 0;
              min-height: 100vh;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background-color: #f5f5f5;
            }
            
            /* Error display that shows immediately */
            #preview-engine-error {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: white;
              z-index: 10000;
              padding: 40px;
              overflow-y: auto;
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            }
            
            #preview-engine-error.show {
              display: block;
            }
            
            .error-header {
              color: #d93025;
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 20px;
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
              max-height: 400px;
              overflow-y: auto;
            }
            
            .error-actions {
              display: flex;
              gap: 10px;
              margin-top: 30px;
            }
            
            .error-button {
              padding: 10px 20px;
              border-radius: 6px;
              border: none;
              cursor: pointer;
              font-weight: 500;
              transition: background 0.2s;
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
            }
            
            ${appData.css || ''}
          </style>
        </head>
        <body>
          <!-- IMMEDIATE ERROR DISPLAY (Can show before DOM loads) -->
          <div id="preview-engine-error">
            <div class="error-header">
              <span>⚠️</span>
              <span>Preview JavaScript Error</span>
            </div>
            <p>This error helps the LLM understand what needs fixing:</p>
            <div class="error-content" id="preview-error-details">
              Loading error details...
            </div>
            <div class="error-actions">
              <button class="error-button error-dismiss" onclick="document.getElementById('preview-engine-error').classList.remove('show')">
                Dismiss Error
              </button>
              <button class="error-button error-reload" onclick="window.location.reload()">
                Reload Preview
              </button>
            </div>
          </div>
          
          <!-- USER'S HTML (Will be inserted here) -->
          <div id="user-app-container">
            ${appData.html || '<div style="padding:40px;text-align:center;color:#666"><p>Live Preview Loaded</p><p>If you see this, the HTML content is empty or being processed.</p></div>'}
          </div>
          
          <!-- WATERMARK -->
          <div class="preview-watermark">
            Preview Engine | ${appData.id}
          </div>
          
          <!-- MAIN ERROR HANDLING AND USER CODE EXECUTION -->
          <script>
            // CAPTURE ALL ERRORS - Setup immediately
            (function() {
              console.log('🔧 Setting up preview engine error handling...');
              
              // Collect early errors
              window.__previewEarlyErrors = [];
              
              // Early error handler for errors before DOMContentLoaded
              window.addEventListener('error', function earlyErrorHandler(event) {
                // Don't handle errors from extensions or external scripts
                if (!event.filename || event.filename.includes('lovable-previewing')) {
                  window.__previewEarlyErrors.push({
                    message: event.message || 'Unknown error',
                    filename: event.filename || 'Inline script',
                    lineno: event.lineno,
                    colno: event.colno,
                    error: event.error,
                    timestamp: new Date().toISOString()
                  });
                  
                  console.log('📝 Early error captured:', event.message);
                  
                  // Show error immediately if possible
                  try {
                    var errorDiv = document.getElementById('preview-engine-error');
                    var detailsDiv = document.getElementById('preview-error-details');
                    if (errorDiv && detailsDiv) {
                      detailsDiv.textContent = 'Early Error: ' + event.message + '\\nFile: ' + (event.filename || 'Inline script') + '\\nLine: ' + event.lineno;
                      errorDiv.classList.add('show');
                    }
                  } catch(e) {
                    // Ignore DOM errors
                  }
                }
              }, true); // Use capture phase to catch errors early
              
              // Wait for DOM to be ready
              function onDomReady() {
                console.log('🏁 DOM ready, executing user code...');
                
                // Show early errors if any
                if (window.__previewEarlyErrors.length > 0) {
                  var firstError = window.__previewEarlyErrors[0];
                  var detailsDiv = document.getElementById('preview-error-details');
                  if (detailsDiv) {
                    detailsDiv.textContent = 'Early Error: ' + firstError.message + 
                      '\\nFile: ' + firstError.filename + 
                      '\\nLine: ' + firstError.lineno + ', Column: ' + firstError.colno + 
                      '\\n\\nNote: This error occurred before the page fully loaded.';
                  }
                }
                
                // Main error handler for runtime errors
                window.addEventListener('error', function mainErrorHandler(event) {
                  event.preventDefault();
                  
                  var errorDetails = 'Error: ' + (event.error?.message || event.message) + 
                    '\\nType: ' + (event.error?.constructor?.name || 'RuntimeError') + 
                    '\\nFile: ' + (event.filename || 'User code') + 
                    '\\nLine: ' + event.lineno + ', Column: ' + event.colno;
                  
                  if (event.error?.stack) {
                    errorDetails += '\\n\\nStack Trace:\\n' + event.error.stack;
                  }
                  
                  errorDetails += '\\n\\nTimestamp: ' + new Date().toISOString();
                  
                  var detailsDiv = document.getElementById('preview-error-details');
                  if (detailsDiv) {
                    detailsDiv.textContent = errorDetails;
                    document.getElementById('preview-engine-error').classList.add('show');
                  }
                  
                  console.error('🚨 Preview Engine caught error:', event.error || event.message);
                  return true;
                });
                
                // Catch unhandled promise rejections
                window.addEventListener('unhandledrejection', function(event) {
                  event.preventDefault();
                  
                  var errorDetails = 'Promise Rejection: ' + (event.reason?.message || event.reason || 'Unknown') + 
                    '\\nType: Promise Rejection';
                  
                  if (event.reason?.stack) {
                    errorDetails += '\\n\\nStack Trace:\\n' + event.reason.stack;
                  }
                  
                  errorDetails += '\\n\\nTimestamp: ' + new Date().toISOString();
                  
                  var detailsDiv = document.getElementById('preview-error-details');
                  if (detailsDiv) {
                    detailsDiv.textContent = errorDetails;
                    document.getElementById('preview-engine-error').classList.add('show');
                  }
                  
                  console.error('🚨 Unhandled promise rejection:', event.reason);
                  return true;
                });
                
                // EXECUTE USER'S JAVASCRIPT
                console.log('🚀 Executing user JavaScript...');
                
                var userCode = \`${appData.js || ''}\`.trim();
                
                if (!userCode) {
                  console.log('📝 No user JavaScript provided');
                  return;
                }
                
                // Check if jQuery is available for user code
                if (!window.$) {
                  console.warn('⚠️ jQuery ($) is not available for user code');
                  // Create a minimal fallback if not already done
                  window.$ = window.jQuery = function(selector) {
                    if (typeof selector === 'string') {
                      return document.querySelector(selector);
                    } else if (typeof selector === 'function') {
                      if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', selector);
                      } else {
                        selector();
                      }
                    }
                    return selector;
                  };
                }
                
                try {
                  // Create a safe execution environment for user code
                  var userFunction = new Function(
                    'window',
                    'document',
                    '$',
                    'jQuery',
                    \`
                    try {
                      \${userCode}
                    } catch(userError) {
                      console.error('User code error:', userError);
                      throw userError;
                    }
                    \`
                  );
                  
                  // Execute with available jQuery
                  userFunction(window, document, window.$, window.jQuery);
                  console.log('✅ User JavaScript executed successfully');
                  
                } catch (execError) {
                  console.error('❌ Error executing user JavaScript:', execError);
                  // The error will be caught by our main error handler
                  throw execError;
                }
              }
              
              // Wait for jQuery to load or timeout
              function waitForJQuery(callback) {
                var attempts = 0;
                var maxAttempts = 50; // 5 seconds
                
                function check() {
                  if (window.jQuery && window.$) {
                    callback();
                  } else if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(check, 100);
                  } else {
                    console.warn('⚠️ jQuery not loaded after timeout, proceeding anyway');
                    callback();
                  }
                }
                
                check();
              }
              
              // Start when DOM is ready
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                  waitForJQuery(onDomReady);
                });
              } else {
                waitForJQuery(onDomReady);
              }
            })();
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
