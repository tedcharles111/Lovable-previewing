import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { createStackBlitzPreview } from './stackblitz-preview';

dotenv.config();

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    webcontainer: !!process.env.WEBCONTAINER_CLIENT_ID,
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get('/', (req, res) => {
  res.send(`
    <h1>🚀 Preview Engine (WebContainer)</h1>
    <p>POST to <code>/api/preview</code> with JSON <code>{ html, css, js }</code></p>
    <p><a href="/health">Health Check</a></p>
  `);
});

// 🔥 THE ONLY PREVIEW ENDPOINT YOU NEED
app.post('/api/preview', async (req, res) => {
  try {
    const { html, css, js, files } = req.body;

    const result = await createStackBlitzPreview(html, css, js, files);

    if (!result.success) {
      throw new Error(result.error || 'Preview failed');
    }

    res.json({
      success: true,
      sessionId: `session_${uuidv4().slice(0, 8)}`,
      previewUrl: result.previewUrl,
      embedHtml: result.embedHtml,
      message: '✅ Preview ready in < 2 seconds',
    });
  } catch (error) {
    console.error('❌ Preview error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Preview engine running on port ${PORT}`);
  console.log(`🔑 WebContainer: ${process.env.WEBCONTAINER_CLIENT_ID ? 'configured' : 'MISSING'}`);
});
