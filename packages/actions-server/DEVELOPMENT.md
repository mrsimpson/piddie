# Actions Server Development Guide

## Overview

The Actions Server is a TypeScript-based Node.js application that uses CommonJS for development and can build to ESM for production if needed.

## Development Setup

### Running the Server

There are several ways to run the server during development:

1. **Development Mode with Auto-Restart**:

   ```
   pnpm dev
   ```

   This starts the server using `ts-node-dev` with watch mode, which automatically restarts the server when files change.

2. **Debug Mode with Node Inspector**:
   ```
   pnpm debug
   ```
   This starts the server with watch mode and Node's inspector enabled, allowing you to attach a debugger.

### VS Code Debugging

For VS Code users, a debug configuration is included in the workspace:

1. Open VS Code
2. Go to the "Run and Debug" panel
3. Select "Debug Actions-Server" from the dropdown
4. Press F5 or click the green play button

This will start the server with VS Code's debugger attached and watch mode enabled, allowing you to:

- Set breakpoints directly in TypeScript files
- Use watch expressions
- Inspect variables
- Use the debug console
- Auto-restart when files change

### Environment Variables

The server uses the following environment variables:

- `HTTP_PORT` - The port for the HTTP server (default: 9100)
- `WS_PORT` - The port for the WebSocket server (default: 9101)
- `NODE_ENV` - The environment mode (development/production)

## Build for Production

To build the server for production:

```
pnpm build
```

This compiles TypeScript to JavaScript in the `dist` directory.

## Module System Notes

For development, we use CommonJS to avoid dealing with ESM-specific requirements like adding `.js` extensions to imports. This simplifies development while still providing a great TypeScript experience with hot reloading.

If needed for production, the module system can be changed to ESM by updating the `type` field in `package.json` and adjusting the `module` and `moduleResolution` options in `tsconfig.json`.

## Troubleshooting

### Common Issues

1. **Hot Reload Not Working**: If changes aren't being detected:

   - Check if ts-node-dev process is running correctly
   - Try saving the file again or making a more substantial change
   - Restart the dev server if needed

2. **Debugger Not Attaching**: Make sure that:
   - No other instance of the server is running
   - Port 9229 (default inspector port) is available
   - You're using the proper VS Code debug configuration
