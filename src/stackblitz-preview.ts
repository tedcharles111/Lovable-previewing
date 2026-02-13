import { CodeSandbox } from '@codesandbox/sdk';
import { v4 as uuidv4 } from 'uuid';

// Initialize the CodeSandbox SDK (no browser globals needed)
const csb = new CodeSandbox();

export async function createStackBlitzPreview(
  html: string = '',
  css: string = '',
  js: string = '',
  files: Record<string, string> = {}
) {
  try {
    const projectId = `preview-${uuidv4().slice(0, 8)}`;

    // Prepare files for CodeSandbox
    const sandboxFiles = {
      'index.html': { content: html || '<div id="root"></div>' },
      'style.css': { content: css || '' },
      'index.js': { content: js || 'console.log("Preview ready ✅");' },
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
      ...Object.fromEntries(
        Object.entries(files).map(([name, content]) => [name, { content }])
      ),
    };

    // Create a sandbox (this is a server‑side API call)
    const sandbox = await csb.sandbox.create({
      files: sandboxFiles,
    });

    // Get the preview URL
    const previewUrl = sandbox.previewUrl; // e.g., https://xxxx.csb.app

    // Generate embed HTML
    const embedHtml = `<iframe 
      src="${previewUrl}?view=preview&hidenavigation=1" 
      style="width:100%; height:600px; border:0; border-radius: 8px; background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-storage-access-by-user-activation"
      allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
      loading="lazy"
      title="AI Live Preview"
    ></iframe>`;

    return {
      success: true,
      previewUrl,
      embedHtml,
      projectId,
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
