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
    // Prevent exceeding concurrency limits
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
          // Create and expose the Supabase client for the user's app
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
        </script>
        `
        : '<!-- Supabase not configured -->';

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} - Live Preview</title>
          
          <!-- COMMON LIBRARIES TO PREVENT COMMON ERRORS -->
          <script src="https://code.jquery.com/jquery-3.6.4.min.js"></script>
          <script>
            // Create a safe $ alias even if jQuery fails
            window.$ = window.$ || function(selector) {
              console.warn('JQuery not properly loaded, using fallback');
              return document.querySelector(selector);
            };
          </script>
          
          <!-- USER'S CSS WITH ERROR HANDLING -->
          <style id="user-css">
            /* User CSS will be injected here */
            ${appData.css || '/* No CSS provided */'}
          </style>
          
          ${supabaseInjection}
          
          <!-- ERROR DISPLAY STYLES -->
          <style>
            .preview-error-overlay {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0, 0, 0, 0.7);
              z-index: 10000;
              display: none;
              justify-content: center;
              align-items: center;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .preview-error-container {
              background: white;
              border-radius: 10px;
              padding: 30px;
              max-width: 800px;
              max-height: 80vh;
              overflow-y: auto;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
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
              border-radius: 6px;
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
            
            .preview-error-try-again {
              background: #f1f3f4;
              color: #3c4043;
            }
            
            .preview-error-try-again:hover {
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
          </style>
        </head>
        <body>
          <!-- ERROR OVERLAY (HIDDEN BY DEFAULT) -->
          <div id="preview-error-overlay" class="preview-error-overlay">
            <div class="preview-error-container">
              <div class="preview-error-header">
                <span>⚠️</span>
                <span>Preview Error</span>
              </div>
              <p>There was an error executing the generated code. This helps the LLM understand what needs to be fixed:</p>
              
              <div class="preview-error-content" id="error-details">
                <!-- Error details will appear here -->
              </div>
              
              <p><strong>Error Type:</strong> <span id="error-type">Unknown</span></p>
              <p><strong>Affected File:</strong> <span id="error-file">User JavaScript</span></p>
              
              <div class="preview-error-actions">
                <button class="preview-error-button preview-error-dismiss" onclick="document.getElementById('preview-error-overlay').style.display='none'">
                  Dismiss Error
                </button>
                <button class="preview-error-button preview-error-try-again" onclick="window.location.reload()">
                  Reload Preview
                </button>
              </div>
            </div>
          </div>
          
          <!-- USER'S HTML -->
          <div id="user-app-container">
            ${appData.html || '<p>No HTML content provided.</p>'}
          </div>
          
          <!-- WATERMARK -->
          <div class="preview-watermark">
            Preview Engine | ${appData.id}
          </div>
          
          <!-- USER'S JAVASCRIPT WITH COMPREHENSIVE ERROR HANDLING -->
          <script>
            // Global error handler to catch all unhandled errors
            window.addEventListener('error', function(event) {
              event.preventDefault();
              
              const errorDetails = \`
Error: \${event.error?.message || event.message}
Type: \${event.error?.constructor?.name || 'Unknown'}
File: \${event.filename || 'Unknown'}
Line: \${event.lineno || 'Unknown'}
Column: \${event.colno || 'Unknown'}
Stack Trace:
\${event.error?.stack || 'No stack trace available'}
              \`.trim();
              
              document.getElementById('error-details').textContent = errorDetails;
              document.getElementById('error-type').textContent = event.error?.constructor?.name || 'Unknown';
              document.getElementById('error-file').textContent = event.filename || 'User JavaScript';
              document.getElementById('preview-error-overlay').style.display = 'flex';
              
              console.error('🚨 Preview Engine caught error:', event.error || event.message);
            });
            
            // Catch unhandled promise rejections
            window.addEventListener('unhandledrejection', function(event) {
              event.preventDefault();
              
              const errorDetails = \`
Promise Rejection: \${event.reason?.message || event.reason || 'Unknown'}
Type: Promise Rejection
Stack Trace:
\${event.reason?.stack || 'No stack trace available'}
              \`.trim();
              
              document.getElementById('error-details').textContent = errorDetails;
              document.getElementById('error-type').textContent = 'Promise Rejection';
              document.getElementById('error-file').textContent = 'Async Operation';
              document.getElementById('preview-error-overlay').style.display = 'flex';
              
              console.error('🚨 Preview Engine caught promise rejection:', event.reason);
            });
            
            // Execute user's JavaScript with try-catch wrapper
            (function() {
              const userCode = \`${appData.js || '// No JavaScript provided'}\`;
              
              if (!userCode.trim()) {
                console.log('📝 No JavaScript code provided by user');
                return;
              }
              
              console.log('🚀 Executing user JavaScript...');
              
              try {
                // Create a function from the user's code
                const userFunction = new Function(userCode);
                
                // Execute on next tick to ensure DOM is ready
                setTimeout(() => {
                  try {
                    userFunction();
                    console.log('✅ User JavaScript executed successfully');
                  } catch (execError) {
                    // This will be caught by the global error handler
                    throw execError;
                  }
                }, 0);
                
              } catch (syntaxError) {
                // Handle syntax errors (they happen during Function creation)
                const errorDetails = \`
Syntax Error: \${syntaxError.message}
Type: SyntaxError
File: User JavaScript
Line: Unable to determine (syntax error during parsing)
Column: Unable to determine

Problematic Code Snippet:
\${userCode.substring(Math.max(0, syntaxError.position - 50), Math.min(userCode.length, syntaxError.position + 50))}

Full User Code:
\${userCode}
                \`.trim();
                
                document.getElementById('error-details').textContent = errorDetails;
                document.getElementById('error-type').textContent = 'SyntaxError';
                document.getElementById('error-file').textContent = 'User JavaScript';
                document.getElementById('preview-error-overlay').style.display = 'flex';
                
                console.error('🚨 Syntax error in user code:', syntaxError);
              }
            })();
            
            // CSS Error handling (for dynamically added styles)
            const styleSheet = document.getElementById('user-css');
            if (styleSheet && styleSheet.sheet) {
              try {
                // This will throw if there are CSS syntax errors
                const rules = styleSheet.sheet.cssRules || styleSheet.sheet.rules;
                console.log(\`✅ CSS loaded with \${rules?.length || 0} rules\`);
              } catch (cssError) {
                console.warn('⚠️ Potential CSS syntax error:', cssError);
                // CSS errors are non-blocking, so we just log them
              }
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
