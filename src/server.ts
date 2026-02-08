import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createServer } from 'http';
import { createClient } from './redis-client';
import { AppManager } from './app-manager';
import { UserApp, PreviewSession } from './types';

const app = express();
const mainServer = createServer(app);
const redis = createClient();
const appManager = new AppManager();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 1. Create REAL interactive app preview
app.post('/api/preview/create', async (req, res) => {
    try {
        const { userId, html, css, js, backendCode } = req.body;
        
        // Generate unique IDs
        const appId = `app_${uuidv4().substr(0, 8)}`;
        const sessionId = `session_${uuidv4().substr(0, 8)}`;
        
        // Create user app object
        const userApp: UserApp = {
            id: appId,
            userId,
            html,
            css,
            js,
            backendCode,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 60 * 1000 // 30 minutes
        };

        // Store in Redis
        await redis.setex(`app:${appId}`, 1800, JSON.stringify(userApp));
        
        // Get public URL (using Render's external URL or localhost)
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
        const previewUrl = `${baseUrl}/preview/${appId}`;
        
        // Create session
        const session: PreviewSession = {
            sessionId,
            appId,
            publicUrl: previewUrl,
            status: 'creating'
        };
        
        await redis.setex(`session:${sessionId}`, 1800, JSON.stringify(session));
        
        // Create REAL app server
        try {
            await appManager.createAppServer(appId, userApp);
            session.status = 'live';
            await redis.setex(`session:${sessionId}`, 1800, JSON.stringify(session));
        } catch (error) {
            console.error(`Failed to start app server for ${appId}:`, error);
            session.status = 'failed';
            await redis.setex(`session:${sessionId}`, 300, JSON.stringify(session));
            throw new Error('Failed to start app server');
        }

        console.log(`🎬 Created REAL app: ${appId} for user: ${userId}`);
        console.log(`🔗 Public URL: ${previewUrl}`);

        res.json({
            success: true,
            sessionId,
            appId,
            previewUrl, // REAL URL users can access
            expiresAt: userApp.expiresAt,
            message: 'Your real, interactive app is now live!'
        });

    } catch (error) {
        console.error('Error creating app:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create app',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// 2. Reverse proxy to user apps
app.use('/preview/:appId', async (req, res, next) => {
    const appId = req.params.appId;
    const port = appManager.getAppPort(appId);
    
    if (!port) {
        // Try to load from Redis and restart
        const appData = await redis.get(`app:${appId}`);
        if (!appData) {
            return res.status(404).json({ error: 'App not found or expired' });
        }
        
        try {
            const userApp: UserApp = JSON.parse(appData);
            await appManager.createAppServer(appId, userApp);
            // Redirect to retry
            return res.redirect(req.originalUrl);
        } catch (error) {
            return res.status(500).json({ error: 'App server unavailable' });
        }
    }
    
    // Proxy to the user's app server
    const proxy = createProxyMiddleware({
        target: `http://localhost:${port}`,
        changeOrigin: true,
        pathRewrite: (path) => {
            return path.replace(`/preview/${appId}`, '');
        }
    });
    
    proxy(req, res, next);
});

// 3. Check app status
app.get('/api/preview/status/:sessionId', async (req, res) => {
    const session = await redis.get(`session:${req.params.sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    const sessionData: PreviewSession = JSON.parse(session);
    res.json(sessionData);
});

// 4. Health check with stats
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        activeApps: appManager.getActiveAppCount(),
        maxConcurrentApps: parseInt(process.env.MAX_CONCURRENT_APPS || '5'),
        timestamp: new Date().toISOString() 
    });
});

// 5. Example frontend integration endpoint
app.get('/api/example-frontend-code', (req, res) => {
    res.send(`
        <h2>How to integrate with your AI builder:</h2>
        <pre><code>
// When user clicks "Preview" in your AI builder:
async function launchPreview(userGeneratedCode) {
    const response = await fetch('https://your-api.onrender.com/api/preview/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: 'current-user-id',
            html: userGeneratedCode.html,
            css: userGeneratedCode.css,
            js: userGeneratedCode.js
        })
    });
    
    const result = await response.json();
    
    if (result.success) {
        // Display the REAL app in an iframe
        const iframe = document.getElementById('preview-frame');
        iframe.src = result.previewUrl;
        
        // OR open in new tab:
        // window.open(result.previewUrl, '_blank');
        
        console.log('🎉 User can now access REAL app at:', result.previewUrl);
    }
}
        </code></pre>
    `);
});

const PORT = process.env.PORT || 10000;
mainServer.listen(PORT, () => {
    console.log(`
    🚀 PREVIEW ENGINE API RUNNING ON PORT ${PORT}
    ============================================
    Features:
    ✅ REAL interactive web apps (not screenshots)
    ✅ Users can sign in, click buttons, use forms
    ✅ Runs on Render Free Tier (Web Service)
    ✅ Automatic cleanup after 30 minutes
    ✅ Max ${process.env.MAX_CONCURRENT_APPS || 5} concurrent apps
    ✅ No Background Worker needed
    
    Endpoints:
    POST   /api/preview/create    - Create new preview
    GET    /preview/{appId}       - Access user's app
    GET    /api/preview/status/{sessionId} - Check status
    GET    /health                - Health check
    
    Your AI builder will create REAL apps that users can fully interact with!
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    redis.quit();
    process.exit(0);
});
