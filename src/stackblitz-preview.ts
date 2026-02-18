import { CodeSandbox } from '@codesandbox/sdk';
import { v4 as uuidv4 } from 'uuid';

const csb = new CodeSandbox();

// Framework detection helpers
function detectFramework(html: string, js: string): 'react' | 'vue' | 'angular' | 'plain' {
  const combined = (html + ' ' + js).toLowerCase();
  if (combined.includes('react') || combined.includes('jsx') || combined.includes('usestate') || combined.includes('useeffect')) {
    return 'react';
  }
  if (combined.includes('vue') || combined.includes('v-bind') || combined.includes('v-model') || combined.includes('v-for')) {
    return 'vue';
  }
  if (combined.includes('angular') || combined.includes('ng-') || combined.includes('component(')) {
    return 'angular';
  }
  return 'plain';
}

export async function createStackBlitzPreview(
  html: string = '',
  css: string = '',
  js: string = '',
  files: Record<string, string> = {}
) {
  try {
    const projectId = `preview-${uuidv4().slice(0, 8)}`;
    const framework = detectFramework(html, js);

    // Base files that every sandbox needs
    let sandboxFiles: Record<string, { content: string }> = {};

    // Common error handler (always injected)
    const errorHandlerContent = `
      (function() {
        // Create a floating error container
        let errorContainer = document.getElementById('preview-error-container');
        if (!errorContainer) {
          errorContainer = document.createElement('div');
          errorContainer.id = 'preview-error-container';
          errorContainer.style.cssText = 'position:fixed; top:10px; right:10px; max-width:400px; z-index:9999; font-family:monospace;';
          document.body.appendChild(errorContainer);
        }

        // Capture runtime errors
        window.addEventListener('error', function(event) {
          const errorDiv = document.createElement('div');
          errorDiv.style.cssText = 'background:#fee; color:#c00; padding:10px; margin:5px; border-left:4px solid #c00; border-radius:4px; box-shadow:0 2px 5px rgba(0,0,0,0.2);';
          errorDiv.innerHTML = \`
            <strong>🚨 Error</strong><br>
            \${event.error?.message || event.message}<br>
            <small style="color:#666;">at \${event.filename || 'unknown'}:\${event.lineno || '?'}</small>
            <button onclick="this.parentElement.remove()" style="float:right; background:none; border:none; cursor:pointer;">✕</button>
          \`;
          errorContainer.appendChild(errorDiv);
          
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
          const errorDiv = document.createElement('div');
          errorDiv.style.cssText = 'background:#fee; color:#c00; padding:10px; margin:5px; border-left:4px solid #c00; border-radius:4px;';
          errorDiv.innerHTML = \`
            <strong>⚠️ Promise Rejection</strong><br>
            \${event.reason?.message || 'Unhandled rejection'}<br>
            <button onclick="this.parentElement.remove()" style="float:right; background:none; border:none; cursor:pointer;">✕</button>
          \`;
          errorContainer.appendChild(errorDiv);
          
          window.parent.postMessage({
            type: 'preview-error',
            error: {
              message: event.reason?.message || 'Unhandled Promise Rejection',
              stack: event.reason?.stack
            }
          }, '*');
        });

        // Capture console methods
        const originalConsole = { ...console };
        ['log', 'warn', 'error', 'info', 'debug'].forEach(method => {
          console[method] = function(...args) {
            window.parent.postMessage({
              type: 'preview-console',
              method,
              args: args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
              ),
              timestamp: Date.now()
            }, '*');
            originalConsole[method].apply(console, args);
          };
        });

        // Detect if the app never rendered
        window.addEventListener('load', function() {
          setTimeout(function() {
            if (!document.getElementById('root')?.children.length && 
                !document.querySelector('[data-testid="app-loaded"]')) {
              console.warn('⚠️ App may have failed to render – check for errors above');
            }
          }, 3000);
        });
      })();
    `;

    // Build files based on detected framework
    switch (framework) {
      case 'react':
        sandboxFiles = {
          'public/index.html': {
            content: html || '<div id="root"></div>'
          },
          'src/App.js': {
            content: js || 'function App() { return <div>Hello React</div>; }\nexport default App;'
          },
          'src/index.js': {
            content: `
              import React from 'react';
              import ReactDOM from 'react-dom/client';
              import App from './App';
              const root = ReactDOM.createRoot(document.getElementById('root'));
              root.render(<App />);
            `
          },
          'package.json': {
            content: JSON.stringify({
              name: projectId,
              version: '1.0.0',
              private: true,
              dependencies: {
                react: '^18.2.0',
                'react-dom': '^18.2.0',
                'react-scripts': '5.0.1'
              },
              scripts: {
                start: 'react-scripts start',
                build: 'react-scripts build'
              },
              eslintConfig: {
                extends: ['react-app']
              },
              browserslist: {
                production: ['>0.2%', 'not dead', 'not op_mini all'],
                development: ['last 1 chrome version', 'last 1 firefox version', 'last 1 safari version']
              }
            }, null, 2)
          },
          'error-handler.js': { content: errorHandlerContent }
        };
        // Inject error handler into index.html
        sandboxFiles['public/index.html'].content += '\n<script src="../error-handler.js"></script>';
        break;

      case 'vue':
        sandboxFiles = {
          'public/index.html': {
            content: html || '<div id="app"></div>'
          },
          'src/App.vue': {
            content: js || '<template><div>Hello Vue</div></template>\n<script>\nexport default { name: "App" }\n</script>'
          },
          'src/main.js': {
            content: `
              import { createApp } from 'vue';
              import App from './App.vue';
              createApp(App).mount('#app');
            `
          },
          'package.json': {
            content: JSON.stringify({
              name: projectId,
              version: '1.0.0',
              private: true,
              scripts: {
                serve: 'vue-cli-service serve',
                build: 'vue-cli-service build'
              },
              dependencies: {
                'vue': '^3.2.0',
                'core-js': '^3.8.3'
              },
              devDependencies: {
                '@vue/cli-service': '~5.0.0'
              }
            }, null, 2)
          },
          'vue.config.js': {
            content: 'module.exports = { publicPath: "/" }'
          },
          'error-handler.js': { content: errorHandlerContent }
        };
        sandboxFiles['public/index.html'].content += '\n<script src="../error-handler.js"></script>';
        break;

      case 'angular':
        // Simplified Angular setup (using Angular CLI structure)
        sandboxFiles = {
          'src/index.html': {
            content: html || '<app-root></app-root>'
          },
          'src/main.ts': {
            content: `
              import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
              import { AppModule } from './app/app.module';
              platformBrowserDynamic().bootstrapModule(AppModule).catch(err => console.error(err));
            `
          },
          'src/app/app.module.ts': {
            content: `
              import { NgModule } from '@angular/core';
              import { BrowserModule } from '@angular/platform-browser';
              import { AppComponent } from './app.component';
              @NgModule({
                declarations: [AppComponent],
                imports: [BrowserModule],
                providers: [],
                bootstrap: [AppComponent]
              })
              export class AppModule { }
            `
          },
          'src/app/app.component.ts': {
            content: js || `
              import { Component } from '@angular/core';
              @Component({
                selector: 'app-root',
                template: '<div>Hello Angular</div>'
              })
              export class AppComponent { }
            `
          },
          'package.json': {
            content: JSON.stringify({
              name: projectId,
              version: '1.0.0',
              private: true,
              scripts: {
                ng: 'ng',
                start: 'ng serve'
              },
              dependencies: {
                '@angular/animations': '^15.0.0',
                '@angular/common': '^15.0.0',
                '@angular/compiler': '^15.0.0',
                '@angular/core': '^15.0.0',
                '@angular/forms': '^15.0.0',
                '@angular/platform-browser': '^15.0.0',
                '@angular/platform-browser-dynamic': '^15.0.0',
                '@angular/router': '^15.0.0',
                'rxjs': '~7.5.0',
                'tslib': '^2.3.0',
                'zone.js': '~0.12.0'
              },
              devDependencies: {
                '@angular-devkit/build-angular': '^15.0.0',
                '@angular/cli': '^15.0.0',
                '@angular/compiler-cli': '^15.0.0',
                'typescript': '~4.8.2'
              }
            }, null, 2)
          },
          'angular.json': {
            content: JSON.stringify({
              version: 1,
              projects: {
                [projectId]: {
                  projectType: 'application',
                  root: '',
                  sourceRoot: 'src',
                  architect: {
                    build: {
                      builder: '@angular-devkit/build-angular:browser',
                      options: {
                        outputPath: 'dist',
                        index: 'src/index.html',
                        main: 'src/main.ts',
                        polyfills: 'src/polyfills.ts',
                        tsConfig: 'tsconfig.json'
                      }
                    },
                    serve: {
                      builder: '@angular-devkit/build-angular:dev-server',
                      options: { browserTarget: `${projectId}:build` }
                    }
                  }
                }
              }
            }, null, 2)
          },
          'tsconfig.json': {
            content: JSON.stringify({
              compileOnSave: false,
              compilerOptions: {
                baseUrl: './',
                outDir: './dist/out-tsc',
                forceConsistentCasingInFileNames: true,
                strict: true,
                noImplicitOverride: true,
                noPropertyAccessFromIndexSignature: true,
                noImplicitReturns: true,
                noFallthroughCasesInSwitch: true,
                sourceMap: true,
                declaration: false,
                downlevelIteration: true,
                experimentalDecorators: true,
                moduleResolution: 'node',
                importHelpers: true,
                target: 'ES2022',
                module: 'ES2022',
                useDefineForClassFields: false,
                lib: ['ES2022', 'dom']
              },
              angularCompilerOptions: {
                enableI18nLegacyMessageIdFormat: false,
                strictInjectionParameters: true,
                strictInputAccessModifiers: true,
                strictTemplates: true
              }
            }, null, 2)
          },
          'error-handler.js': { content: errorHandlerContent }
        };
        sandboxFiles['src/index.html'].content += '\n<script src="error-handler.js"></script>';
        break;

      default: // plain JS
        sandboxFiles = {
          'index.html': { 
            content: (html || '<div id="root"></div>') + '\n<script src="error-handler.js"></script>' 
          },
          'style.css': { content: css || '' },
          'index.js': { content: js || 'console.log("Preview ready ✅");' },
          'package.json': {
            content: JSON.stringify({
              name: projectId,
              version: '1.0.0',
              scripts: { start: 'serve .' },
              dependencies: { serve: '^14.0.0' },
            }, null, 2)
          },
          'error-handler.js': { content: errorHandlerContent }
        };
        break;
    }

    // Add any additional files from the LLM (overwrites defaults if same name)
    Object.entries(files).forEach(([name, content]) => {
      sandboxFiles[name] = { content };
    });

    // Determine the correct template for CodeSandbox
    let template: string;
    switch (framework) {
      case 'react': template = 'create-react-app'; break;
      case 'vue': template = 'vue-cli'; break;
      case 'angular': template = 'angular-cli'; break;
      default: template = 'node';
    }

    // Create the sandbox with explicit template
    const sandbox = await csb.sandboxes.create({ 
      files: sandboxFiles,
      template: template
    } as any);

    const sandboxId = (sandbox as any).id;
    if (!sandboxId) throw new Error('Failed to get sandbox ID from CodeSandbox');

    // Build embed URL with parameters that optimize for preview
    const embedUrl = `https://codesandbox.io/embed/${sandboxId}?view=preview&hidenavigation=1&fontsize=12&codemirror=1&highlights=0&editorsize=0&theme=dark`;

    // Enhanced iframe with onload message and better sandbox attributes
    const embedHtml = `<iframe 
      src="${embedUrl}" 
      style="width:100%; height:600px; border:0; border-radius: 8px; background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-storage-access-by-user-activation allow-popups-to-escape-sandbox"
      allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"
      loading="lazy"
      title="AI Live Preview"
      onload="this.contentWindow.postMessage({ type: 'preview-loaded' }, '*')"
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
