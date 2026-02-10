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
          
          <!-- AUTO-LOAD JQUERY TO PREVENT $ ERRORS -->
          <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
          <script>
            // Fallback if jQuery fails
            if (typeof window.$ === 'undefined') {
              console.warn('JQuery failed to load, creating mock $');
              window.$ = window.jQuery = function(selector) {
                return document.querySelector(selector);
              };
            }
          </script>
          
          ${supabaseInjection}
          
          <!-- USER'S CSS -->
          <style>${appData.css || ''}</style>
          
          <!-- ERROR DISPLAY STYLES -->
          <style>
            .preview-error-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.85);
              z-index: 10000;
              display: none;
              justify-content: center;
              align-items: center;
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            }
            
            .preview-error-container {
              background: white;
              border-radius: 12px;
              padding: 30px;
              max-width: 800px;
              max-height: 80vh;
              overflow-y: auto;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }
            
            .preview-error-header {
              color: #d93025;
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 20px;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            
            .preview-error-content {
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
            }
            
            .preview-error-actions {
              display: flex;
              gap: 10px;
              justify-content: flex-end;
              margin-top: 20px;
            }
            
            .preview-error-button {
              padding: 10px 20px;
              border-radius: 6px;
              border: none;
              cursor: pointer;
              font-weight: 500;
              transition: background 0.2s;
            }
            
            .preview-error-dismiss {
              background: #1a73e8;
              color: white;
            }
            
            .preview-error-dismiss:hover {
              background: #0d62d9;
            }
            
            .preview-error-reload {
              background: #f1f3f4;
              color: #3c4043;
            }
            
            .preview-error-reload:hover {
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
            
            /* Fix for empty CSS */
            body {
              margin: 0;
              min-height: 100vh;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
          </style>
        </head>
        <body>
          <!-- ERROR OVERLAY -->
          <div id="preview-error-overlay" class="preview-error-overlay">
            <div class="preview-error-container">
              <div class="preview-error-header">
                <span>⚠️</span>
                <span>Preview Error</span>
              </div>
              <p>There was an error in the generated code. This helps the LLM understand what needs fixing:</p>
              
              <div class="preview-error-content" id="error-details">
                <!-- Error details will appear here -->
              </div>
              
              <p><strong>Error Type:</strong> <span id="error-type">Unknown</span></p>
              <p><strong>Affected File:</strong> <span id="error-file">User JavaScript</span></p>
              
              <div class="preview-error-actions">
                <button class="preview-error-button preview-error-dismiss" onclick="document.getElementById('preview-error-overlay').style.display='none'">
                  Dismiss Error
                </button>
                <button class="preview-error-button preview-error-reload" onclick="window.location.reload()">
                  Reload Preview
                </button>
              </div>
            </div>
          </div>
          
          <!-- USER'S HTML -->
          <div id="user-app-container">
            ${appData.html || '<div style="padding: 40px; text-align: center; color: #666;"><p>No HTML content provided.</p></div>'}
          </div>
          
          <!-- WATERMARK -->
          <div class="preview-watermark">
            Preview Engine | ${appData.id}
          </div>
          
          <!-- ENHANCED ERROR HANDLING SCRIPT -->
          <script>
            // EARLY ERROR CAPTURE - set up before anything else
            window.__previewEarlyErrors = [];
            window.__previewErrorHandlerLoaded = false;
            
            // Early error handler (catches errors before main handler loads)
            window.addEventListener('error', function earlyErrorHandler(event) {
              if (!window.__previewErrorHandlerLoaded) {
                const errorDetails = {
                  message: event.message || 'Unknown error',
                  filename: event.filename || 'Unknown',
                  lineno: event.lineno || 'Unknown',
                  colno: event.colno || 'Unknown'
                };
                window.__previewEarlyErrors.push(errorDetails);
                console.log('📝 Early error captured:', errorDetails);
              }
              // Don't prevent default - let it also go to console
            });
            
            // MAIN ERROR HANDLING SYSTEM
            document.addEventListener('DOMContentLoaded', function() {
              // Mark that main handler is now loaded
              window.__previewErrorHandlerLoaded = true;
              
              // Show any early errors
              if (window.__previewEarlyErrors.length > 0) {
                const firstError = window.__previewEarlyErrors[0];
                const errorDetails = \`
Early Error: \${firstError.message}
File: \${firstError.filename}
Line: \${firstError.lineno}, Column: \${firstError.colno}

Note: This error occurred before the page fully loaded.
                \`.trim();
                
                document.getElementById('error-details').textContent = errorDetails;
                document.getElementById('error-type').textContent = 'Early Load Error';
                document.getElementById('error-file').textContent = firstError.filename || 'Unknown';
                document.getElementById('preview-error-overlay').style.display = 'flex';
                console.log('🚨 Showing early error in overlay');
              }
              
              // Global error handler for runtime errors
              window.addEventListener('error', function mainErrorHandler(event) {
                event.preventDefault();
                
                const errorDetails = \`
Error: \${event.error?.message || event.message || 'Unknown error'}
Type: \${event.error?.constructor?.name || 'RuntimeError'}
File: \${event.filename || 'Inline Script'}
Line: \${event.lineno || 'N/A'}, Column: \${event.colno || 'N/A'}
Stack Trace:
\${event.error?.stack || 'No stack trace available'}

Timestamp: \${new Date().toISOString()}
                \`.trim();
                
                document.getElementById('error-details').textContent = errorDetails;
                document.getElementById('error-type').textContent = event.error?.constructor?.name || 'RuntimeError';
                document.getElementById('error-file').textContent = event.filename || 'Inline Script';
                document.getElementById('preview-error-overlay').style.display = 'flex';
                
                console.error('🚨 Preview Engine caught error:', event.error || event.message);
                
                // Return true to prevent default browser error handling
                return true;
              });
              
              // Catch unhandled promise rejections
              window.addEventListener('unhandledrejection', function(event) {
                event.preventDefault();
                
                const errorDetails = \`
Promise Rejection: \${event.reason?.message || event.reason || 'Unknown promise rejection'}
Type: Promise Rejection
Stack Trace:
\${event.reason?.stack || 'No stack trace available'}

Timestamp: \${new Date().toISOString()}
                \`.trim();
                
                document.getElementById('error-details').textContent = errorDetails;
                document.getElementById('error-type').textContent = 'Promise Rejection';
                document.getElementById('error-file').textContent = 'Async Operation';
                document.getElementById('preview-error-overlay').style.display = 'flex';
                
                console.error('🚨 Preview Engine caught promise rejection:', event.reason);
                
                return true;
              });
              
              // EXECUTE USER'S JAVASCRIPT
              console.log('🚀 Executing user JavaScript...');
              
              const userCode = \`${appData.js || '// No JavaScript provided'}\`;
              
              if (!userCode.trim() || userCode.trim() === '// No JavaScript provided') {
                console.log('📝 No user JavaScript to execute');
                return;
              }
              
              try {
                // Wrap user code in a function and execute immediately
                const userFunction = new Function(userCode);
                
                // Execute synchronously (errors will be caught by our handler)
                userFunction();
                
                console.log('✅ User JavaScript executed successfully');
              } catch (execError) {
                // This will be caught by the global error handler above
                console.error('❌ Error executing user JavaScript:', execError);
                // Re-throw to be caught by global handler
                throw execError;
              }
            });
            
            // Fallback: If DOMContentLoaded already fired, run immediately
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
              // Trigger our error handling setup
              const event = new Event('DOMContentLoaded');
              document.dispatchEvent(event);
            }
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
