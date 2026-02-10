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

    // Serve the user's REAL application with Supabase integration
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
        <!-- END SUPABASE INJECTION -->
        `
        : '<!-- Supabase not configured -->';

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appData.id} - Live Preview</title>
          <style>${appData.css}</style>
          ${supabaseInjection}
        </head>
        <body>
          ${appData.html}
          <script>
            // User's own JavaScript runs here
            // window.supabase is now available for real database operations
            ${appData.js}
          </script>
        </body>
        </html>
      `);
    });

    // Note: Removed mock API endpoints (/api/login, /api/user, /api/data)
    // Real backend functionality is now provided via Supabase client

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
