import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Server as HttpServer } from "http";


/**
 * WorkbenchToolsMcpServer provides a standardized MCP interface for workbench tools.
 * It exposes client-side tools via the MCP protocol and supports streaming responses.
 */
export class WorkbenchToolsMcpServer {
  private server: McpServer;
  private app: express.Application;
  private port: number;
  private httpServer: HttpServer | null = null;
  private transports: Record<string, StreamableHTTPServerTransport> = {};

  /**
   * Creates a new WorkbenchToolsMcpServer
   * @param port - The HTTP port to listen on
   */
  constructor(port: number) {
    this.port = port;
    this.app = express();
    this.app.use(express.json());

    // Create the MCP server
    this.server = new McpServer({
      name: 'WorkbenchTools',
      version: '1.0.0',
    });

    // Add a simple echo tool for testing
    this.server.tool(
      'echo',
      { message: z.string() },
      async ({ message }) => ({
        content: [{ type: 'text', text: `Echo: ${message}` }],
      })
    );

    this.setupRoutes();
  }

  /**
   * Sets up the HTTP routes for the MCP server
   */
  private setupRoutes() {
    // Handle POST requests for client-to-server communication
    this.app.post('/mcp', async (req, res) => {
      // Check for existing session ID
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this.transports[sessionId]) {
        // Reuse existing transport
        transport = this.transports[sessionId];
      } else {
        // Create a new transport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            this.transports[sessionId] = transport;
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete this.transports[transport.sessionId];
          }
        };

        // Connect to the MCP server
        await this.server.connect(transport);
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      
      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    this.app.get('/mcp', handleSessionRequest);

    // Handle DELETE requests for session termination
    this.app.delete('/mcp', handleSessionRequest);

    this.app.get('/', (_req, res) => {res.send("WorkbenchToolsMcpServer up and running")})
  }

  /**
   * Starts the MCP server
   * @returns A promise that resolves when the server is started
   */
  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = this.app.listen(this.port, () => {
        console.log(`WorkbenchToolsMcpServer listening on port ${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stops the MCP server
   */
  public async stop(): Promise<void> {
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

new WorkbenchToolsMcpServer(9200).start()