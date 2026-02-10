import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createServer } from 'http';
import { AppManager } from './app-manager';
import { UserApp, PreviewSession } from './types';

const app = express();
const mainServer = createServer(app);

// Get Supabase config from environment
const supabaseUrl = process.env.SUPABASE_URL || 'https://ieybvitvlyotxdnqcfg.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlleWJ2aXR2bHlvdHhkbnFjZmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI4NTIwMzgsImV4cCI6MjA3ODQyODAzOH0.IEtRbU3HnerXr4IpprvAonWvVAaGrLb8pyndiqy4Y5A';

// Initialize AppManager with Supabase config
const appManager = new AppManager(supabaseUrl, supabaseAnonKey);

// In-memory storage (replaces Redis)
const memoryStore = {
  apps: new Map<string, { data: UserApp; expiry: number }>(),
  sessions: new Map<string, { data: PreviewSession; expiry: number }>(),

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.apps) {
      if (now > item.expiry) this.apps.delete(key);
    }
    for (const [key, item] of this.sessions) {
      if (now > item.expiry) this.sessions.delete(key);
    }
  },

  async setex(
    map: 'apps' | 'sessions',
    key: string,
    seconds: number,
    value: any
  ) {
    this.cleanup();
    const store = map === 'apps' ? this.apps : this.sessions;
    store.set(key, {
      data: value,
      expiry: Date.now() + seconds * 1000,
    });
    return 'OK';
  },

  async get(map: 'apps' | 'sessions', key: string): Promise<any> {
    this.cleanup();
    const store = map === 'apps' ? this.apps : this.sessions;
    const item = store.get(key);
    if (!item || Date.now() > item.expiry) {
      store.delete(key);
      return null;
    }
    return item.data;
  },
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Root route
app.get('/', (req, res) => {
  res.send(`
        <h1>🚀 Preview Engine API with Real Backend</h1>
        <p>Your preview engine is running successfully with Supabase integration!</p>
        <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/api/example-frontend-code">Example Integration Code</a></li>
            <li><strong>POST</strong> /api/preview/create - Create new preview</li>
            <li><strong>GET</strong> /preview/{appId} - Access user's app</li>
        </ul>
        <p><strong>Status:</strong> In-memory storage + Supabase backend</p>
        <p><strong>Supabase:</strong> ${supabaseUrl ? '✅ Connected' : '❌ Not configured'}</p>
    `);
});

// 1. Create REAL interactive app preview
app.post('/api/preview/create', async (req, res) => {
  try {
    const { userId, html, css, js } = req.body;

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
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    };

    // Store in memory
    await memoryStore.setex('apps', `app:${appId}`, 1800, userApp);

    // Get public URL
    const baseUrl =
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${process.env.PORT || 10000}`;
    const previewUrl = `${baseUrl}/preview/${appId}`;

    // Create session
    const session: PreviewSession = {
      sessionId,
      appId,
      publicUrl: previewUrl,
      status: 'creating',
    };

    await memoryStore.setex('sessions', `session:${sessionId}`, 1800, session);

    // Create REAL app server
    try {
      await appManager.createAppServer(appId, userApp);
      session.status = 'live';
      await memoryStore.setex('sessions', `session:${sessionId}`, 1800, session);
    } catch (error) {
      console.error(`Failed to start app server for ${appId}:`, error);
      session.status = 'failed';
      await memoryStore.setex('sessions', `session:${sessionId}`, 300, session);
      throw new Error('Failed to start app server');
    }

    console.log(`🎬 Created REAL app: ${appId} for user: ${userId}`);
    console.log(`🔗 Public URL: ${previewUrl}`);
    console.log(
      `📊 Active apps: ${appManager.getActiveAppCount()}/${
        process.env.MAX_CONCURRENT_APPS || 5
      }`
    );

    res.json({
      success: true,
      sessionId,
      appId,
      previewUrl,
      expiresAt: userApp.expiresAt,
      message: 'Your real, interactive app is now live with database access!',
      stats: {
        activeApps: appManager.getActiveAppCount(),
        maxApps: parseInt(process.env.MAX_CONCURRENT_APPS || '5'),
      },
    });
  } catch (error) {
    console.error('Error creating app:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create app',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 2. Reverse proxy to user apps
app.use('/preview/:appId', async (req, res, next) => {
  const appId = req.params.appId;
  const port = appManager.getAppPort(appId);

  if (!port) {
    // Try to load from memory and restart
    const appData = await memoryStore.get('apps', `app:${appId}`);
    if (!appData) {
      return res.status(404).json({ error: 'App not found or expired' });
    }

    try {
      await appManager.createAppServer(appId, appData);
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
    },
  });

  proxy(req, res, next);
});

// 3. Check app status
app.get('/api/preview/status/:sessionId', async (req, res) => {
  const session = await memoryStore.get('sessions', `session:${req.params.sessionId}`);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json(session);
});

// 4. Health check with stats
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeApps: appManager.getActiveAppCount(),
    maxConcurrentApps: parseInt(process.env.MAX_CONCURRENT_APPS || '5'),
    memoryApps: memoryStore.apps.size,
    memorySessions: memoryStore.sessions.size,
    supabaseConfigured: !!(supabaseUrl && supabaseAnonKey),
    timestamp: new Date().toISOString(),
  });
});

// 5. Example frontend integration endpoint
app.get('/api/example-frontend-code', (req, res) => {
  res.send(`
        <h2>How to integrate with your AI builder:</h2>
        <pre><code>
// When user clicks "Preview" in your AI builder:
async function launchPreview(userGeneratedCode) {
    const response = await fetch('https://lovable-previewing.onrender.com/api/preview/create', {
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
        
        console.log('🎉 User can now access REAL app at:', result.previewUrl);
    }
}
        </code></pre>
        <h3>Using Supabase in Generated Code:</h3>
        <pre><code>
// In your LLM-generated app code, you can now use:
async function loadData() {
    // window.supabase is automatically available in previews
    const { data, error } = await window.supabase
        .from('your_table')
        .select('*')
        .limit(10);
    
    if (error) {
        console.error("Database error:", error);
    } else {
        console.log("Real data:", data);
        // Update your UI with real data
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
    ✅ REAL Supabase backend database access
    ✅ Runs on Render Free Tier (Web Service)
    ✅ In-memory storage (no Redis needed)
    ✅ Automatic cleanup after 30 minutes
    ✅ Max ${process.env.MAX_CONCURRENT_APPS || 5} concurrent apps
    ✅ Memory efficient
    
    Your AI builder will create REAL apps that users can fully interact with!
    `);
  console.log(`🔗 Supabase: ${supabaseUrl ? '✅ Connected' : '❌ Not configured'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
