export type { RuntimeContainer } from "@piddie/shared-types";
export * from "./types";
export * from "./RuntimeEnvironmentManager";
export * from "./factory/RuntimeEnvironmentFactory";
export { WebContainerProvider } from "./providers/WebContainerProvider";
export { RuntimeEnvironmentMCPServer } from "./mcp/RuntimeEnvironmentMCPServer";
import {
  RuntimeEnvironmentFactory,
  RuntimeType
} from "./factory/RuntimeEnvironmentFactory";
import { WebContainerProvider } from "./providers/WebContainerProvider";

// Register the WebContainerProvider implementation
RuntimeEnvironmentFactory.registerProvider(
  RuntimeType.WEB_CONTAINER,
  WebContainerProvider
);
