import { CodeSandbox } from '@codesandbox/sdk';
import { v4 as uuidv4 } from 'uuid';

const csb = new CodeSandbox();

export async function createStackBlitzPreview(
  html: string = '',
  css: string = '',
  js: string = '',
  files: Record<string, string> = {}
) {
  try {
    const projectId = `preview-${uuidv4().slice(0, 8)}`;

    // Build sandbox files with an error‑handler script injected
    const sandboxFiles: Record<string, { content: string }> = {
      'index.html': { 
        content: (html || '<div id="root"></div>') + '\n<script src="error-handler.js"></script>' 
      },
      'style.css': { content: css || '' },
      'index.js': { content: js || 'console.log("Preview ready ✅");' },
      'error-handler.js': {
        content: `
          // Capture runtime errors
          window.addEventListener('error', function(event) {
            window.parent.postMessage({ 
              type: 'preview-error', 
              error: {
                message: event.error?.message || event.message,
                stack: event.error?.stack,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
              }
            }, '*');
            return false;
          });

          // Capture unhandled promise rejections
          window.addEventListener('unhandledrejection', function(event) {
            window.parent.postMessage({
              type: 'preview-error',
              error: {
                message: event.reason?.message || 'Unhandled Promise Rejection',
                stack: event.reason?.stack
              }
            }, '*');
          });

          // Capture console.log, warn, error, etc.
          const originalConsole = { ...console };
          ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
            console[method] = function(...args) {
              window.parent.postMessage({
                type: 'preview-console',
                method,
                args: args.map(arg => 
                  typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ),
                timestamp: Date.now()
              }, '*');
              originalConsole[method].apply(console, args);
            };
          });
        `
      },
      'package.json': {
        content: JSON.stringify(
          {
            name: projectId,
            version: '1.0.0',
            scripts: { start: 'serve .' },
            dependencies: { serve: '^14.0.0' },
          },
          null,
          2
        ),
      },
    };

    // Add any additional files from the LLM
    Object.entries(files).forEach(([name, content]) => {
      sandboxFiles[name] = { content };
    });

    // Create the sandbox (server‑side, works in Node.js)
    const sandbox = await csb.sandboxes.create({ files: sandboxFiles } as any);
    const sandboxId = (sandbox as any).id;

    if (!sandboxId) {
      throw new Error('Failed to get sandbox ID from CodeSandbox');
    }

    const embedUrl = `https://codesandbox.io/embed/${sandboxId}?view=preview&hidenavigation=1&fontsize=12&codemirror=1`;

    const embedHtml = `<iframe 
      src="${embedUrl}" 
      style="width:100%; height:600px; border:0; border-radius: 8px; background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-storage-access-by-user-activation"
      allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
      loading="lazy"
      title="AI Live Preview"
    ></iframe>`;

    return {
      success: true,
      previewUrl: embedUrl,
      embedHtml,
      projectId,
      sandboxId,
    };
  } catch (error) {
    console.error('❌ CodeSandbox preview creation failed:', error);
    return {
      success: false,
      previewUrl: '',
      embedHtml: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
