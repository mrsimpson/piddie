import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { Server as HttpServer } from "http";
import { ActionsProxy } from './ActionsProxy';

/**
 * WorkbenchToolsMcpServer provides a standardized MCP interface for workbench tools.
 * It acts as a proxy that routes MCP requests to the appropriate client's MCP server
 * in the ActionsProxy based on the clientId in the request.
 */
export class WorkbenchToolsMcpServer {
  private app: express.Application;
  private port: number;
  private httpServer: HttpServer | null = null;
  private actionsProxy: ActionsProxy;
  private clientSessions: Map<string, Map<string, StreamableHTTPServerTransport>> = new Map();

  /**
   * Creates a new WorkbenchToolsMcpServer
   * @param actionsProxy - The ActionsProxy instance to bridge with
   * @param port - The HTTP port to listen on
   */
  constructor(actionsProxy: ActionsProxy, port: number = 9200) {
    this.port = port;
    this.actionsProxy = actionsProxy;
    this.app = express();
    this.app.use(express.json());

    this.setupRoutes();
  }

  /**
   * Sets up the HTTP routes for the MCP server
   */
  private setupRoutes() {
    // Handle POST requests for client-to-server communication
    this.app.post('/mcp/:clientId', async (req, res) => {
      const clientId = req.params.clientId;

      // Check if the client exists in ActionsProxy
      const mcpServer = this.actionsProxy.getMcpServerForClient(clientId);
      if (!mcpServer) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `Client ${clientId} not found`,
          },
          id: null,
        });
        return;
      }

      // Check for existing session ID
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      // Get or create the sessions map for this client
      if (!this.clientSessions.has(clientId)) {
        this.clientSessions.set(clientId, new Map());
      }
      const clientSessionsMap = this.clientSessions.get(clientId)!;

      if (sessionId && clientSessionsMap.has(sessionId)) {
        // Reuse existing transport
        transport = clientSessionsMap.get(sessionId)!;
      } else {
        // Create a new transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            // Store the transport by session ID
            clientSessionsMap.set(newSessionId, transport);

            // Store in ActionsProxy for reconnection support
            this.actionsProxy.storeMcpServerTransport(clientId, transport);
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            clientSessionsMap.delete(transport.sessionId);
          }
        };

        // Connect to the client's MCP server
        await mcpServer.connect(transport);
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      const clientId = req.params.clientId;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!clientId || !sessionId) {
        res.status(400).send('Missing clientId or session ID');
        return;
      }
      
      const clientSessionsMap = this.clientSessions.get(clientId);
      if (!clientSessionsMap || !clientSessionsMap.has(sessionId)) {
        res.status(400).send('Invalid clientId or session ID');
        return;
      }

      const transport = clientSessionsMap.get(sessionId)!;
      await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    this.app.get('/mcp/:clientId', handleSessionRequest);

    // Handle DELETE requests for session termination
    this.app.delete('/mcp/:clientId', handleSessionRequest);

    // Status endpoint
    this.app.get('/', (_req, res) => {
      const clientCount = this.clientSessions.size;
      const sessionCount = Array.from(this.clientSessions.values())
        .reduce((total, sessions) => total + sessions.size, 0);

      res.send(`WorkbenchToolsMcpServer up and running with ${clientCount} clients and ${sessionCount} active sessions`);
    });

    // List available clients
    this.app.get('/clients', (_req, res) => {
      const clients = this.actionsProxy.getClientIds();
      res.json({ clients });
    });
  }

  /**
   * Starts the MCP server
   * @returns A promise that resolves when the server is started
   */
  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = this.app.listen(this.port, () => {
        console.log(`WorkbenchToolsMcpServer listening on port ${this.port}`);
        console.log(`Available clients: ${this.actionsProxy.getClientIds().join(', ') || 'none'}`);
        resolve();
      });
    });
  }

  /**
   * Stops the MCP server
   */
  public async stop(): Promise<void> {
    // Close all transports
    for (const [clientId, sessions] of this.clientSessions.entries()) {
      for (const [sessionId, transport] of sessions.entries()) {
        try {
          if (typeof transport.close === 'function') {
            await transport.close();
          }
        } catch (error) {
          console.error(`Error closing transport for client ${clientId}, session ${sessionId}:`, error);
        }
      }
    }

    // Clear all sessions
    this.clientSessions.clear();

    // Close the HTTP server
    if (this.httpServer) {
      return new Promise((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.httpServer = null;
            resolve();
          }
        });
      });
    }
    return Promise.resolve();
  }
}

// Only start the server if this file is executed directly
if (require.main === module) {
  // Create ActionsProxy instance with default port
  const actionsProxy = new ActionsProxy(19101);

  // Create and start the WorkbenchToolsMcpServer
  const mcpServer = new WorkbenchToolsMcpServer(actionsProxy, 9200);
  mcpServer.start().catch(error => {
    console.error('Failed to start WorkbenchToolsMcpServer:', error);
    process.exit(1);
  });
}