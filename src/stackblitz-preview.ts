import { CodeSandbox } from '@codesandbox/sdk';
import { v4 as uuidv4 } from 'uuid';

// Initialize the CodeSandbox SDK
const csb = new CodeSandbox();

export async function createStackBlitzPreview(
  html: string = '',
  css: string = '',
  js: string = '',
  files: Record<string, string> = {}
) {
  try {
    const projectId = `preview-${uuidv4().slice(0, 8)}`;

    // Prepare files in the format the API expects
    const sandboxFiles: Record<string, { content: string }> = {
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
    };

    // Add any additional files
    Object.entries(files).forEach(([name, content]) => {
      sandboxFiles[name] = { content };
    });

    // 🔥 CRITICAL FIX: Cast the entire options object to 'any'
    // This bypasses TypeScript's incorrect type definitions
    const sandbox = await csb.sandboxes.create({ files: sandboxFiles } as any);

    // The SDK returns an object with an 'id' – cast to any to access it
    const sandboxId = (sandbox as any).id;

    if (!sandboxId) {
      throw new Error('Failed to get sandbox ID from CodeSandbox');
    }

    // Construct the preview URL manually
    const previewUrl = `https://${sandboxId}.csb.app`;

    // Generate embed HTML
    const embedHtml = `<iframe 
      src="${previewUrl}" 
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