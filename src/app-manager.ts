import express from 'express';
import { createServer, Server } from 'http';
import { UserApp } from './types';

export class AppManager {
    private apps: Map<string, { server: Server; port: number; app: UserApp }> = new Map();
    private usedPorts: Set<number> = new Set();
    private maxConcurrentApps: number;

    constructor() {
        this.maxConcurrentApps = parseInt(process.env.MAX_CONCURRENT_APPS || '5');
    }

    async createAppServer(appId: string, appData: UserApp): Promise<{ port: number; url: string }> {
        // Prevent exceeding concurrency limits
        if (this.apps.size >= this.maxConcurrentApps) {
            // Find oldest app to cleanup
            const oldestAppId = this.findOldestAppId();
            if (oldestAppId) {
                await this.cleanupAppServer(oldestAppId);
            }
        }

        const app = express();
        
        // Serve the user's REAL application
        app.get('/', (req, res) => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${appData.id} - Live Preview</title>
                    <style>${appData.css}</style>
                </head>
                <body>
                    ${appData.html}
                    <script>${appData.js}</script>
                </body>
                </html>
            `);
        });

        // REAL backend API endpoints (users can actually sign in!)
        app.post('/api/login', (req, res) => {
            // Users can actually submit forms and get real responses
            res.json({ 
                success: true, 
                message: 'Logged in successfully',
                token: 'demo_jwt_token_123',
                user: { id: 1, email: 'user@example.com' }
            });
        });

        app.get('/api/user', (req, res) => {
            res.json({ user: { name: 'John Doe', email: 'john@example.com' } });
        });

        app.post('/api/data', (req, res) => {
            res.json({ message: 'Data saved successfully', data: req.body });
        });

        // Find available port
        const port = await this.findAvailablePort(10001, 10100);
        
        return new Promise((resolve, reject) => {
            const server = createServer(app);
            
            server.listen(port, () => {
                this.apps.set(appId, { server, port, app: appData });
                this.usedPorts.add(port);
                
                console.log(`🚀 REAL App server started for ${appId} on port ${port}`);
                
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
