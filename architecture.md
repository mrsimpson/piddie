# Prompt-Driven-Development Environment: Architecture Documentation

## Project Overview

This document describes the architecture of a web-based IDE that implements a prompt-first development paradigm. The system allows developers to create, modify, and execute code primarily through natural language interactions with Large Language Models (LLMs).

### Core Purpose
- Enable prompt-first development workflow
- Provide a web-based IDE interface
- Facilitate LLM-driven code generation and modification
- Support code execution capabilities

### Key Assumptions
1. Multiple LLM providers should be supported without increasing complexity
2. The system should be extensible for future agent implementations
3. Prompt construction requires context from the entire project
4. Users may want to customize prompt behavior specifically for a project
5. A seamless interaction between the local file system and the browser file system as well as easy revisioning is essential for a good DX

## System Overview

### Component Architecture

```mermaid
graph TD
    subgraph "User Interface"
        UI[Web IDE UI]
        ED[Monaco Editor]
        PV[Preview Panel]
        TR[Terminal]
    end

    subgraph "Core Systems"
        CHM[Chat Manager]
        CM[Context Manager]
        AM[Actions Manager]
        WM[Workspace Manager]
    end

    subgraph "File Management"
        LFS[Lightning FS]
        IG[isomorphic-git]
        FSW[File Sync Watcher]
    end

    subgraph "Execution Environment"
        WC[WebContainer]
        SH[Shell Handler]
    end

    UI --> CHM
    UI --> WM
    UI --> SM
    ED --> LFS
    
    CHM --> AM
    AM --> LFS
    AM --> WC
    
    LFS --> IG
    LFS --> FSW
    FSW --> LocalFS[Local File System]
    
    WC --> SH
    WC --> PV
    WC --> TR
    
    style LocalFS fill:#f9f,stroke:#333
```

### Key Interaction Flows

#### 1. LLM-Driven File Modification Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as Web IDE UI
    participant CHM as Chat Manager
    participant AM as Actions Manager
    participant LFS as Lightning FS
    participant IG as isomorphic-git
    participant WC as WebContainer
    
    User->>UI: Submit Message
    UI->>CHM: Forward Message
    
    activate CHM
    CHM->>CHM: Request Context
    CHM->>LLM: Send Message
    LLM-->>CHM: Response
    CHM->>AM: Execute Actions
    
    activate AM
    AM->>IG: Create Safety Commit
    AM->>LFS: Apply File Changes
    AM->>IG: Create Result Commit
    AM->>WC: Sync Changes
    WC-->>AM: Sync Complete
    deactivate AM
    
    CHM-->>UI: Update Complete
    deactivate CHM
```

#### 2. Editor to Disk Flow

```mermaid
sequenceDiagram
    actor User
    participant ED as Monaco Editor
    participant LFS as Lightning FS
    participant CM as Context Manager
    participant FSW as File Sync Watcher
    participant LD as Local Disk
    
    User->>ED: Edit File
    ED->>LFS: Save Changes
    
    par File Sync
        LFS->>FSW: Notify Change
        FSW->>LD: Sync to Disk
    and Context Update
        LFS->>CM: Record Change
        CM->>CM: Update Context
    end
    
    Note over CM: Change available for next LLM interaction
```

## System Components

### 1. Chat and Context System

#### Purpose
Manages the chat interaction flow with LLMs and maintains comprehensive context through the Context Manager.

#### Components

1. **Chat Manager**
   - Core Responsibilities:
     - Handle message processing and LLM interaction
     - Coordinate with Context Manager for context needs
     - Process and validate LLM responses
   - Interface:
   ```typescript
   interface ChatManager {
     // Core chat/LLM interaction
     handleMessage(message: string): Promise<LLMResponse>;
   }
   ```

2. **Context Manager**
   - Core Responsibilities:
     - Full ownership of all context including system/project prompts
     - Control all context sources and their integration
     - Handle context optimization and relevance
   - Interface:
   ```typescript
   interface ContextManager {
     // Prompt configuration
     setSystemPrompt(prompt: string): void;
     setProjectPrompt(prompt: string): void;
     
     // Context assembly
     getContext(options?: ContextOptions): Promise<Context>;
     
     // Context sources
     addContextSource(source: ContextSource): void;
     removeContextSource(sourceId: string): void;
     
     // Source configuration
     configureSource(sourceId: string, config: SourceConfig): void;
     setPriority(sourceId: string, priority: number): void;
     
     // Context state management
     updateContext(source: string, data: any): void;
     invalidateContext(source?: string): void;
     
     // Context optimization
     pruneContext(maxTokens: number): void;
     
     // Context types
     addFileContext(file: FileInfo): void;
     addDocContext(doc: Documentation): void;
     addChatHistory(messages: Message[]): void;
     addWorkspaceState(state: WorkspaceState): void;
   }
   ```

#### Interaction Flow

```mermaid
sequenceDiagram
    actor User
    participant IDE as Web IDE UI
    participant CHM as Chat Manager
    participant CM as Context Manager
    participant Sources as Context Sources
    participant LLM as LLM Provider

    User->>IDE: Submit Message
    IDE->>CHM: Forward Message

    activate CHM
    CHM->>CM: Request Context
    
    activate CM
    CM->>CM: Load System/Project Prompts
    
    par Context Collection
        CM->>Sources: Request File Context
        CM->>Sources: Request Doc Context
        CM->>Sources: Request Chat History
        CM->>Sources: Request Workspace State
    end
    
    CM->>CM: Assemble & Optimize
    CM-->>CHM: Return Full Context
    deactivate CM
    
    CHM->>LLM: Send Message with Context
    LLM-->>CHM: Response
    
    CHM-->>IDE: Return Result
    deactivate CHM
```

#### Key Features

1. **Clear Separation of Responsibilities**
   - Prompt Manager focuses solely on chat/LLM interaction
   - Context Manager has complete control over all context-related operations

2. **Comprehensive Context Management**
   - Full ownership of all context sources
   - Dynamic source prioritization
   - Intelligent context assembly
   - Token budget management

3. **Flexible Context Sources**
   - File context (open files, project files)
   - Documentation context
   - Chat history
   - Workspace state
   - Custom context providers

### 2. LLM Integration Layer

#### Purpose
Provides unified access to multiple LLM providers while maintaining a consistent interface.

#### Components
1. **litellm Proxy**
   - Responsibilities:
     - Abstract different LLM providers
     - Provide OpenAI-compatible interface
     - Handle rate limiting and errors
     - Manage API authentication

2. **LangChain.js Integration**
   - Responsibilities:
     - Manage prompt templates
     - Handle conversation chains
     - Provide foundation for future agents
     - Manage conversation context

## Data Flow

### Chat Processing Flow
1. User submits message through IDE interface
2. Chat Manager:
   - Coordinates with Context Manager
   - Processes message with LLM
   - Handles response processing
3. LangChain processes message
4. litellm forwards to appropriate LLM
5. Response returned to IDE

### File Filtering Flow
1. Project files passed through filter chain
2. Each filter:
   - Applies its specific filtering logic
   - Passes results to next filter
   - Returns final filtered set

## Security Considerations

1. **Prompt Security**
   - Need for prompt sanitization
   - Content filtering requirements
   - Rate limiting implementation

2. **File Access**
   - Secure file access patterns
   - Prevention of unauthorized file access
   - Handling of sensitive file content

## Future Extensibility

The architecture is designed to support:
1. Additional file filters
2. New LLM providers
3. Advanced agent implementations
4. Custom prompt templates
5. Enhanced context management

## Performance Considerations

1. **File Filtering**
   - Efficient chain execution
   - Caching of filtered results
   - Incremental updates

2. **LLM Integration**
   - Response time optimization
   - Token usage management
   - Request batching capabilities

## Diagrams

### Component Overview

```mermaid
graph TD
    subgraph "Frontend"
        UI[Web IDE UI]
        PM[Prompt Manager]
    end

    subgraph "Prompt Management"
        PM --> |uses| FF[File Filters]
        PM --> |loads| SP[System Prompt]
        PM --> |loads| UP[User Prompt/.llmprompt]
        PM --> |builds| FP[Final Prompt]
        
        FF --> |chain| EF[Extension Filter]
        FF --> |chain| IF[Ignore Filter]
        FF --> |chain| SF[Size Filter]
    end

    subgraph "LLM Integration"
        LC[LangChain.js]
        LP[litellm Proxy]
        LC --> LP
        LP --> |abstracts| LLMs[LLM Providers]
    end

    UI --> PM
    PM --> |sends prompt| LC
```

### Message Processing Sequence

```mermaid
sequenceDiagram
    actor User
    participant IDE as Web IDE UI
    participant PM as Prompt Manager
    participant FF as File Filters
    participant LC as LangChain
    participant LP as litellm Proxy
    participant LLM as LLM Provider

    User->>IDE: Submit Message
    IDE->>PM: Forward Message

    %% Context Collection Phase
    activate PM
    PM->>PM: Load System Prompt
    PM->>PM: Check for .llmprompt
    PM->>FF: Request File Filtering
    activate FF
    FF->>FF: Apply Extension Filter
    FF->>FF: Apply Ignore Patterns
    FF->>FF: Apply Size Limits
    FF-->>PM: Return Filtered Files
    deactivate FF

    %% Prompt Assembly Phase
    PM->>PM: Assemble Final Prompt
    note right of PM: Combines:
    note right of PM: 1. System Prompt
    note right of PM: 2. Filtered Files
    note right of PM: 3. .llmprompt (if exists)
    note right of PM: 4. User Message

    %% LLM Processing Phase
    PM->>LC: Send Assembled Prompt
    deactivate PM
    activate LC
    LC->>LP: Forward to litellm
    activate LP
    LP->>LLM: Make API Call
    activate LLM
    LLM-->>LP: Return Response
    deactivate LLM
    LP-->>LC: Forward Response
    deactivate LP
    LC-->>IDE: Process & Return Result
    deactivate LC
    IDE-->>User: Display Response
```

### File Filter Chain Structure

```mermaid
graph LR
    Input[Project Files] --> EF[Extension Filter]
    EF --> IF[Ignore Pattern Filter]
    IF --> SF[Size Filter]
    SF --> Output[Filtered Files]

    style Input fill:#f9f,stroke:#333,stroke-width:2px
    style Output fill:#9ff,stroke:#333,stroke-width:2px
```

The diagrams illustrate:

1. **Component Overview**: Shows the main architectural components and their relationships
2. **Message Processing Sequence**: Details the step-by-step flow of a user message through the system
3. **File Filter Chain**: Demonstrates the chain of responsibility pattern used in file filtering

Key interactions shown:
- User message flow through the system
- Context collection and prompt assembly process
- File filtering pipeline
- LLM integration chain
- Response processing and return path

## File Management System

### Purpose
Provides a robust file management system that works primarily in the browser while maintaining synchronization with the local file system. Uses isomorphic-git and Lightning FS to handle version control and browser-based file storage.

### Components

#### 1. Browser File System (Lightning FS)
- Responsibilities:
  - Provide POSIX-like file system in the browser
  - Store file contents in IndexedDB
  - Handle file read/write operations
  - Manage file metadata
  - Support concurrent operations
- Key Features:
  - Persistent storage across sessions
  - File watching capabilities
  - Directory operations
  - Atomic write operations

#### 2. Git Management (isomorphic-git)
- Responsibilities:
  - Track file versions
  - Handle branching and merging
  - Manage commit history
  - Resolve conflicts
- Operations:
  - Clone repositories
  - Create/manage branches
  - Stage/commit changes
  - Push/pull changes
  - Generate diffs

#### 3. Sync Manager
- Responsibilities:
  - Coordinate synchronization between local and browser filesystem
  - Track file modification states
  - Queue and batch sync operations
  - Handle sync conflicts
- States to Track:
  - In sync
  - Local ahead
  - Browser ahead
  - Conflict
  - Syncing

#### 4. File Watcher
- Responsibilities:
  - Monitor local file system changes
  - Detect browser file system changes
  - Trigger sync operations
  - Maintain change history
- Watch Targets:
  - Local file modifications
  - Browser file modifications
  - Git repository changes
  - Conflict states

### File Synchronization Flow

```mermaid
sequenceDiagram
    participant LD as Local Disk
    participant LS as Local Server
    participant SW as Sync Watcher
    participant SM as Sync Manager
    participant LFS as Lightning FS
    participant IG as isomorphic-git
    
    Note over LD,IG: Local File Edit Flow
    
    LD->>LS: File changed
    LS->>SW: Change notification
    activate SW
    SW->>SM: Report change
    
    activate SM
    SM->>LD: Read updated file
    LD-->>SM: File content
    
    SM->>IG: Generate diff
    IG-->>SM: Diff result
    
    alt No Conflicts
        SM->>LFS: Apply changes
        SM->>IG: Stage changes
        IG->>IG: Create commit
    else Conflicts Detected
        SM->>LFS: Mark conflict
        SM->>SW: Notify conflict
    end
    
    deactivate SM
    SW->>LS: Acknowledge sync
    deactivate SW
```

### Editor to File System Flow

#### Purpose
Handles file changes initiated through the Monaco Editor, ensuring proper synchronization with both the browser-based file system and local storage.

```mermaid
sequenceDiagram
    participant ME as Monaco Editor
    participant EM as Editor Manager
    participant LFS as Lightning FS
    participant CHM as Chat Manager
    participant IG as isomorphic-git
    participant SW as Sync Watcher
    participant LS as Local Storage

    ME->>EM: File Changed
    
    par File System Update
        EM->>LFS: Write Changes
        LFS->>IG: Stage Changes
        IG->>IG: Create Commit
    and Context Update
        EM->>CHM: Update File Context
        CHM->>CHM: Update Context Cache
    end
    
    LFS-->>SW: Change Detected
    SW->>LS: Sync Changes
```

#### Key Features

1. **Change Management**
   - Debounced save operations
   - Atomic file writes
   - Change detection
   - Editor state synchronization

2. **Git Integration**
   - Optional auto-commit
   - Change staging
   - Commit message generation
   - History tracking

3. **Sync Behavior**
   - Immediate local sync
   - Conflict detection
   - Change queuing
   - Error recovery

#### Implementation Example
```typescript
interface EditorFileSync {
  // Handle editor content changes
  handleChange(path: string, content: string): Promise<void>;
  
  // Sync to file systems
  syncToFileSystems(change: FileChange): Promise<void>;
  
  // Optional git operations
  createCommitForChange(change: FileChange): Promise<string>;
}

// Example usage
editor.onDidChangeContent(async (change) => {
  await editorFileSync.handleChange(
    currentFile.path,
    editor.getValue()
  );
});
```

#### Manual Change Tracking
```typescript
interface ManualChange {
  type: 'MODIFY';
  path: string;
  content: string;
  previousContent: string;
  timestamp: Date;
}

// In Chat Manager
interface ChatManager {
  // Core chat/LLM interaction
  handleMessage(message: string): Promise<LLMResponse>;
}

// Example integration with Editor
editor.onDidChangeContent(async (change) => {
  // Handle file system sync
  await editorFileSync.handleChange(
    currentFile.path,
    editor.getValue()
  );

  // Record change in Context Manager for context
  contextManager.recordManualChanges([{
    type: 'MODIFY',
    path: currentFile.path,
    content: editor.getValue(),
    previousContent: previousContent,
    timestamp: new Date()
  }]);
});
```

This ensures:
1. Changes are available as context for next LLM interaction
2. Context Manager maintains full conversation context
3. Clear separation between action execution (Actions Manager) and context tracking (Context Manager)
4. Changes are properly timestamped for chronological context

### Conflict Resolution Flow

```mermaid
graph TD
    subgraph "Conflict Detection"
        A[File Change] --> B{Check Versions}
        B -->|Different Base| C[Mark Conflict]
        B -->|Same Base| D[Fast-forward]
    end
    
    subgraph "Resolution"
        C --> E{Resolution Strategy}
        E -->|Auto-merge| F[Merge Changes]
        E -->|Manual| G[User Resolution]
        E -->|Keep Local| H[Use Local Version]
        E -->|Keep Remote| I[Use Remote Version]
    end
    
    subgraph "Sync"
        F --> J[Update Lightning FS]
        G --> J
        H --> J
        I --> J
        J --> K[Commit Changes]
    end
```

### Key Interactions

1. **Local to Browser Sync**
   - Local file system changes detected
   - Changes read and diffed
   - Applied to Lightning FS
   - Git commit created
   - Sync state updated

2. **Browser to Local Sync**
   - Browser file system changes detected
   - Changes written to local file system
   - Git commit created
   - Sync state updated

3. **Conflict Handling**
   - Conflicts detected during sync
   - Resolution strategy determined
   - Changes merged or user prompted
   - Final state committed to both systems

### Performance Considerations

1. **Change Batching**
   - Group multiple changes into single sync operation
   - Debounce rapid changes
   - Optimize commit frequency

2. **Caching Strategy**
   - Cache frequently accessed files
   - Maintain diff history
   - Store recent conflict resolutions

3. **Resource Management**
   - Limit concurrent operations
   - Implement file size restrictions
   - Handle large repository performance

## LLM Change Management

### Purpose
Manages file changes resulting from LLM interactions through the Actions Manager, ensuring atomic operations and proper version control traceability.

### Integration with Actions Manager

#### File Change Handler
- Responsibilities:
  - Process file change actions from LLM responses
  - Manage atomic batch operations
  - Handle git operations
  - Maintain change metadata
- Key Features:
  - Atomic batch processing
  - Rollback capability
  - Change validation
  - Git integration

### File Change Action Flow

```mermaid
sequenceDiagram
    participant LLM as LLM
    participant CHM as Chat Manager
    participant AM as Actions Manager
    participant FCH as File Change Handler
    participant LFS as Lightning FS
    participant IG as isomorphic-git
    
    LLM-->>CHM: Response
    activate CHM
    CHM->>AM: Parse Response
    
    activate AM
    AM->>FCH: Execute File Changes
    
    activate FCH
    Note over FCH: Collect all changes
    
    loop For each file change
        FCH->>LFS: Stage change
    end
    
    FCH->>IG: Prepare commit
    Note over FCH: Create commit message with:
    Note over FCH: - Action metadata
    Note over FCH: - LLM info
    Note over FCH: - Full prompt
    
    alt Changes Valid
        FCH->>IG: Create commit
        IG-->>FCH: Commit success
        FCH-->>AM: Action complete
    else Invalid Changes
        FCH->>LFS: Rollback changes
        FCH-->>AM: Action failed
    end
    deactivate FCH
    
    AM-->>CHM: Action Results
    deactivate AM
    CHM-->>User: Final Response
    deactivate CHM
```

### File Change Action Structure
```typescript
interface FileChangeAction extends Action {
  type: 'FILE_CHANGE';
  payload: {
    changes: Array<{
      type: 'CREATE' | 'MODIFY' | 'DELETE';
      path: string;
      content?: string;
    }>;
    commitMessage?: string;
  };
  metadata: ActionMetadata & {
    model: string;
    temperature?: number;
  };
}
```

### Commit Message Structure
```
feat(ai): [action-id] AI-assisted changes

Action: FILE_CHANGE
Prompt: [Full prompt text]

Changes:
- Modified file1.ts
- Created file2.ts
- Deleted file3.ts

Metadata:
- Model: [model-name]
- Temperature: [temp-value]
- Action ID: [unique-action-id]
- Timestamp: [ISO datetime]
```

### Key Features

1. **Action Integration**
   - File changes handled as formal actions
   - Consistent action lifecycle management
   - Integration with other action types
   - Standardized error handling

2. **Atomic Operations**
   - All changes in an action treated as single unit
   - Automatic rollback on action failure
   - Consistent repository state guaranteed

3. **Change Traceability**
   - Action metadata in commit history
   - LLM information preserved
   - Clear audit trail of changes

## Actions Management

### Purpose
Interprets and executes various types of actions derived from LLM responses, providing a pluggable system for different operation types.

### Components

#### 1. Actions Manager
- Responsibilities:
  - Parse LLM responses into executable actions
  - Coordinate action execution
  - Handle action results
  - Manage action lifecycle
- Key Features:
  - Pluggable action handlers
  - Action validation
  - Result aggregation
  - Error handling

#### 2. Action Handlers
1. **File Change Handler**
   - Manages file operations and git commits
   - Implements atomic changes
   - Handles rollbacks
   - Creates git commits with metadata

2. **Code Execution Handler**
   - Runs code in sandbox
   - Captures output
   - Manages execution context

3. **Configuration Handler**
   - Updates IDE settings
   - Manages project configuration
   - Handles environment variables

### Action Flow

```mermaid
sequenceDiagram
    participant LLM as LLM
    participant CHM as Chat Manager
    participant AM as Actions Manager
    participant FCH as File Change Handler
    participant CEH as Code Execution Handler
    participant CH as Config Handler
    
    LLM-->>CHM: Response
    activate CHM
    CHM->>AM: Parse & Execute Actions
    
    activate AM
    Note over AM: Analyze Response
    
    alt File Changes Detected
        AM->>FCH: Execute File Changes
        activate FCH
        FCH-->>AM: Changes Result
        deactivate FCH
    end
    
    alt Code Execution Required
        AM->>CEH: Execute Code
        activate CEH
        CEH-->>AM: Execution Result
        deactivate CEH
    end
    
    alt Config Changes Needed
        AM->>CH: Update Config
        activate CH
        CH-->>AM: Config Result
        deactivate CH
    end
    
    AM-->>CHM: Action Results
    deactivate AM
    CHM-->>User: Final Response
    deactivate CHM
```

### Action Interface
```typescript
interface Action {
  type: ActionType;
  payload: unknown;
  metadata: ActionMetadata;
}

interface ActionHandler<T = unknown> {
  canHandle(action: Action): boolean;
  execute(action: Action): Promise<T>;
  validate(action: Action): Promise<boolean>;
  rollback(action: Action): Promise<void>;
}

interface ActionMetadata {
  source: string;  // LLM identifier
  timestamp: Date;
  prompt: string;
  confidence?: number;
}
```

### Key Features

1. **Extensibility**
   - Pluggable action handler system
   - Custom action type support
   - Middleware capabilities
   - Action composition

2. **Validation & Safety**
   - Pre-execution validation
   - Action authorization
   - Resource limits
   - Rollback support

3. **Monitoring & Logging**
   - Action execution tracking
   - Performance metrics
   - Error reporting
   - Audit trail

## Preview System

### Purpose
Provides a development environment with live preview capabilities by running code through WebContainers, managing shell interactions, and displaying the running application.

### Components

#### 1. WebContainer Manager
- Responsibilities:
  - Boot and manage WebContainer instance
  - Mount file system from Lightning FS
  - Handle container lifecycle
  - Manage environment setup
  - Subscribe to Lightning FS events
  - Handle incremental file updates
  - Manage file system synchronization
- Key Features:
  - Single container instance per session
  - File system synchronization
  - Environment persistence
  - Resource cleanup
  - Direct FS event subscription
  - Incremental sync support
  - Change debouncing

#### 2. Shell Handler
- Responsibilities:
  - Manage terminal instance
  - Execute commands
  - Stream command output
  - Handle user input
- Features:
  - Command history
  - Output streaming
  - Error handling
  - Interactive shell support

#### 3. Preview Component
- Responsibilities:
  - Display running application
  - Handle preview refresh
  - Manage preview state
  - Handle preview errors
- Features:
  - Iframe isolation
  - Port management
  - Live reload
  - Error overlay

### Integration Flow

```mermaid
sequenceDiagram
    participant LFS as Lightning FS
    participant WCM as WebContainer Manager
    participant SH as Shell Handler
    participant PC as Preview Component
    
    Note over LFS,PC: Initial Setup
    WCM->>LFS: Mount & Subscribe to Events
    WCM->>WCM: Boot WebContainer
    WCM->>WCM: Initial File System Sync
    
    Note over LFS,PC: File Change Flow
    LFS->>WCM: File System Event
    WCM->>WCM: Debounce Changes
    WCM->>WCM: Sync to Container
    
    alt Build Required
        WCM->>SH: Trigger Build
        SH-->>PC: Update Preview
    end
```

### Key Interactions

1. **File System to WebContainer**
```typescript
interface WebContainerSync {
  syncFiles(): Promise<void>;
  watchChanges(): void;
  handleFileUpdates(path: string): Promise<void>;
}
```

2. **Shell Command Execution**
```typescript
interface ShellExecution {
  executeCommand(command: string): Promise<CommandResult>;
  startDevServer(): Promise<void>;
  killProcess(pid: number): Promise<void>;
}
```

3. **Preview Management**
```typescript
interface PreviewManager {
  updatePreview(url: string): void;
  handlePreviewError(error: Error): void;
  reload(): Promise<void>;
}
```

### Development Workflow

1. **Initial Setup**
   - Mount Lightning FS contents to WebContainer
   - Initialize development environment
   - Start shell instance

2. **File Changes**
   - Detect changes in Lightning FS
   - Sync to WebContainer
   - Trigger rebuild if needed
   - Update preview

3. **Command Execution**
   - User enters command in shell
   - Execute in WebContainer
   - Stream output to terminal
   - Update preview if needed

### Error Handling

1. **Container Errors**
   - Container boot failures
   - Resource exhaustion
   - Environment issues

2. **Preview Errors**
   - Build failures
   - Runtime errors
   - Connection issues

3. **Shell Errors**
   - Command execution failures
   - Process termination
   - Permission issues

### Performance Considerations

1. **Resource Management**
   - Memory usage monitoring
   - Process cleanup
   - Cache management

2. **Preview Optimization**
   - Debounced updates
   - Incremental builds
   - Resource preloading

3. **File System Performance**
   - Efficient change detection
   - Batched updates
   - Selective synchronization

## Code Editor System

### Purpose
Provides a full-featured code editing experience integrated with the file system and preview capabilities.

### Components

#### 1. Monaco Editor Manager
- Responsibilities:
  - Initialize and configure Monaco instances
  - Handle file opening/closing
  - Manage editor state
  - Coordinate with Lightning FS
  - Handle language services
- Key Features:
  - Multi-file editing
  - Split views
  - Minimap
  - IntelliSense
  - Custom language services

#### 2. Editor Integration Services
1. **File System Integration**
   - Direct integration with Lightning FS
   - File change notifications
   - Save operations
   - File creation/deletion

2. **Navigation Services**
   - Built-in Monaco Features:
     - In-file symbol navigation
     - Basic go-to-definition
     - File-level search
     - Simple outline view
   - Extended Capabilities:
     - Recent files tracking
     - Navigation history (back/forward)
     - Custom file tree integration
     - Project-wide search

3. **Future Navigation Enhancements**
   > Note: To be implemented with LSP
   - Cross-file references
   - Project-wide symbol search
   - Advanced go-to-definition
   - Type hierarchy navigation

4. **Extension System**
   - Custom commands
   - Keybindings
   - Themes
   - Snippets

### Editor Integration Flow

```mermaid
sequenceDiagram
    participant LFS as Lightning FS
    participant EM as Editor Manager
    participant ME as Monaco Editor
    participant LS as Language Services
    
    Note over LFS,LS: File Open Flow
    LFS->>EM: File Content
    EM->>ME: Initialize Editor
    ME->>LS: Request Language Services
    LS-->>ME: Provide Completions/Hints
    
    Note over LFS,LS: Save Flow
    ME->>EM: Content Changed
    EM->>LFS: Save File
    LFS-->>EM: File Saved
    
    Note over LFS,LS: Sync Flow
    LFS->>EM: External Change
    EM->>ME: Update Content
```

### Key Features

1. **Editor Capabilities**
   - Syntax highlighting
   - Code completion
   - Error detection
   - Find/Replace
   - Multiple cursors
   - Code folding

2. **Integration Features**
   - Direct file system access
   - Git decoration support
   - Preview integration
   - Terminal integration

3. **Performance Features**
   - Large file handling
   - Lazy loading
   - Worker-based processing
   - Memory management

### Language Services Architecture

#### 1. Initial Implementation: Built-in Monaco Services
- Basic IntelliSense
- Syntax highlighting
- Simple completions
- File-level analysis
- TypeScript/JavaScript language support
- Basic diagnostics

#### 2. Future Enhancements

##### Language Server Protocol (LSP)
> Note: Planned for future implementation
- Advanced capabilities through LSP:
  - Project-wide analysis
  - Advanced type checking
  - Dependency resolution
  - Cross-file refactoring

##### Custom Intelligence System
> Note: Planned for future implementation
- LLM-enhanced capabilities:
  - Context-aware suggestions
  - Natural language interactions
  - Project-specific intelligence
  - Smart diagnostics
  - Interactive assistance

### Initial Language Support Scope
1. **JavaScript/TypeScript**
   - Built-in Monaco support
   - Type definitions
   - Basic refactoring
   - Syntax validation

2. **Common Web Languages**
   - HTML
   - CSS
   - JSON
   - Markdown

3. **Basic Support for Others**
   - Syntax highlighting
   - Basic formatting
   - Simple completions

## Project Management System

### Purpose
Manages multiple independent projects with local-first storage and optional remote synchronization.

### Components

#### 1. Project Manager
- Responsibilities:
  - Manage project lifecycle
  - Handle project configuration
  - Coordinate project resources
  - Manage project metadata
- Key Features:
  - Multi-project support
  - Project isolation
  - Configuration management
  - Resource management

#### 2. Storage System
1. **Local Storage Layer**
   - IndexedDB (via Dexie.js):
     - Project data
     - Chat histories
     - Administrative data
   - Lightning FS:
     - Project files
     - Git objects
   - Key Features:
     - Type-safe queries
     - Observable data
     - Index management
     - Transaction support

### Storage Architecture

> Note: Remote synchronization and PostgreSQL integration are planned for future implementation.

```mermaid
graph TD
    subgraph "Local Storage"
        subgraph "IndexedDB (Dexie)"
            PD[Project Data]
            CH[Chat History]
        end
        LFS[Lightning FS] --> PF[Project Files]
    end
    
    subgraph future_sync["Future: Sync Layer"]
        SE[Sync Engine]
        CT[Change Tracker]
        SQ[Sync Queue]
    end
    
    subgraph future_remote["Future: Remote Storage"]
        PG[PostgreSQL]
    end
    
    PD -.-> SE
    CH -.-> SE
    LFS -.-> SE
    SE -.-> PG
    SE -.-> CT
    CT -.-> SQ
    SQ -.-> SE

    style SE stroke-dasharray: 5 5
    style CT stroke-dasharray: 5 5
    style SQ stroke-dasharray: 5 5
    style PG stroke-dasharray: 5 5
    style future_sync stroke-dasharray: 5 5
    style future_remote stroke-dasharray: 5 5
```

### Initial Storage Implementation
1. **Local Storage Layer**
   - IndexedDB (via Dexie.js):
     - Project data
     - Chat histories
     - Administrative data
   - Lightning FS:
     - Project files
     - Git objects
   - Key Features:
     - Type-safe queries
     - Observable data
     - Index management
     - Transaction support

### Future Storage Enhancements
> Note: Planned for future implementation

1. **Sync Engine**
   - Bidirectional sync
   - Change tracking
   - Conflict resolution
   - Queue management

2. **Remote Storage**
   - PostgreSQL integration
   - Multi-user support
   - Data backup
   - Cross-device sync

### Data Models
```typescript
// Dexie Database Schema
class ProjectDatabase extends Dexie {
  projects: Table<Project>;
  chatHistory: Table<ChatMessage>;
  syncQueue: Table<SyncRecord>;

  constructor() {
    super('ProjectDB');
    this.version(1).stores({
      projects: 'id, name, lastAccessed',
      chatHistory: 'id, projectId, timestamp',
      syncQueue: 'id, entityType, status'
    });
  }
}

interface Project {
  id: string;
  name: string;
  rootPath: string;
  created: Date;
  lastAccessed: Date;
  config: ProjectConfig;
  syncStatus: SyncStatus;
}
```

### Key Features

1. **Project Isolation**
   - Separate root directories
   - Independent git repositories
   - Isolated chat histories
   - Project-specific configuration

2. **Local-First Operations**
   - Offline capability
   - Local data persistence
   - Fast operations
   - Data integrity

3. **Sync Capabilities**
   - Bidirectional sync
   - Conflict resolution
   - Change tracking
   - Queue management

### Data Models

```typescript
interface ProjectMetadata {
  id: string;
  name: string;
  created: Date;
  lastAccessed: Date;
  syncStatus: SyncStatus;
}

interface ChatMessage {
  id: string;
  projectId: string;
  timestamp: Date;
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  branchId: string;
  parentMessageId?: string;
  originalMessageId?: string;
  version: number;
  isLatest: boolean;
}

interface ChatBranch {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  parentBranchId?: string;
  rootMessageId: string;
  isActive: boolean;
}
```

### Sync Flow

```mermaid
sequenceDiagram
    participant LC as Local Changes
    participant CT as Change Tracker
    participant SQ as Sync Queue
    participant SE as Sync Engine
    participant PG as PostgreSQL

    LC->>CT: Record Change
    CT->>SQ: Queue Change
    
    loop Sync Process
        SQ->>SE: Get Next Change
        SE->>PG: Sync Change
        
        alt Sync Success
            PG-->>SE: Confirm
            SE->>SQ: Mark Complete
        else Conflict
            PG-->>SE: Report Conflict
            SE->>SQ: Mark for Resolution
        end
    end
```

### Chat Branching Flow

```mermaid
graph TD
    M1[Message 1] --> M2[Message 2]
    M2 --> M3[Message 3]
    M2 --> E1[Edit of Message 2]
    E1 --> B1[New Branch Message 1]
    M3 --> M4[Message 4]
    B1 --> B2[New Branch Message 2]

    style E1 fill:#f9f,stroke:#333
    style B1 fill:#9ef,stroke:#333
    style B2 fill:#9ef,stroke:#333
```

### Branching Scenarios

1. **Message Editing**
   - Creates new branch from edited message
   - Maintains reference to original
   - Previous branch remains intact
   - New messages continue in new branch

2. **Branch Management**
   - Multiple active branches
   - Branch switching
   - Branch merging (future enhancement)
   - Branch archiving

3. **Message Relationships**
   - Parent-child relationships
   - Branch lineage tracking
   - Version history
   - Cross-branch references

### Project Scaffolding Action

#### Purpose
Provides AI-driven project initialization and scaffolding through the Actions system, allowing natural language description of desired project structure.

#### Scaffolding Handler
```typescript
interface ScaffoldingAction extends Action {
  type: 'SCAFFOLD_PROJECT';
  payload: {
    description: string;      // User's project description
    preferences?: {
      framework?: string;
      testing?: string;
      styling?: string;
      // ... other preferences
    };
    constraints?: {
      maxFiles?: number;
      requiredFeatures?: string[];
      // ... other constraints
    }
  };
  metadata: ActionMetadata;
}
```

#### Scaffolding Flow

```mermaid
sequenceDiagram
    participant User
    participant CHM as Chat Manager
    participant AM as Actions Manager
    participant SH as Scaffolding Handler
    participant FCH as File Change Handler
    participant LFS as Lightning FS

    User->>CHM: "Create a React app with TypeScript and testing"
    CHM->>AM: Create Scaffold Action
    
    activate AM
    AM->>SH: Execute Scaffolding
    
    activate SH
    Note over SH: Generate Project Structure
    
    SH->>FCH: Create Project Files
    activate FCH
    
    loop For each scaffold file
        FCH->>LFS: Create File
    end
    
    FCH->>LFS: Create package.json
    FCH->>LFS: Create config files
    FCH->>LFS: Create initial source files
    
    FCH-->>SH: Files Created
    deactivate FCH
    
    SH-->>AM: Scaffold Complete
    deactivate SH
    
    AM-->>User: Project Ready
    deactivate AM
```

#### Key Features

1. **Intelligent Structure Generation**
   - Framework detection
   - Best practice adherence
   - Convention following
   - Dependency management

2. **Context-Aware Scaffolding**
   - Project type recognition
   - Technology stack awareness
   - Testing framework selection
   - Style system integration

3. **Progressive Enhancement**
   - Start with basic structure
   - Add features through conversation
   - Refine through iterations
   - Adapt to user preferences

4. **Template Learning**
   - Learn from existing projects
   - Adapt to user patterns
   - Improve over time
   - Share common patterns

## Workspace State Management

### Purpose
Manages the overall IDE workspace state, persisting user preferences and session information across browser refreshes.

### Components

#### 1. Workspace State Manager
- Responsibilities:
  - Layout configuration (split panels, sizes)
  - Open files and tabs
  - Terminal sessions
  - Preview states
  - Active project context
  - Recent files/actions
  - Scroll positions
  - Collapsed folders in file tree
  - Panel visibility states

```typescript
interface WorkspaceState {
  layout: {
    panels: PanelConfig[];
    activePanel: string;
    splitConfiguration: SplitConfig;
  };
  openFiles: {
    paths: string[];
    active: string;
    pinned: string[];
    scrollPositions: Record<string, number>;
  };
  terminals: {
    sessions: TerminalSession[];
    activeSession: string;
  };
  preview: {
    isVisible: boolean;
    url?: string;
    size: PreviewSize;
  };
  fileExplorer: {
    expandedFolders: string[];
    selectedItems: string[];
  };
}
```

### State Persistence Flow

```mermaid
sequenceDiagram
    participant UI as IDE UI
    participant WM as Workspace Manager
    participant IDB as IndexedDB
    
    Note over UI,IDB: State Change
    UI->>WM: State Update
    WM->>WM: Debounce Changes
    WM->>IDB: Persist State
    
    Note over UI,IDB: Session Restore
    UI->>WM: Initialize Workspace
    WM->>IDB: Load State
    WM->>UI: Restore Layout
    WM->>UI: Reopen Files
    WM->>UI: Restore Terminal Sessions
```

### Key Features

1. **State Persistence**
   - Automatic state saving
   - Session recovery
   - Layout persistence
   - Cross-session continuity

2. **Layout Management**
   - Panel configurations
   - Split views
   - Size preferences
   - View states

3. **Session Context**
   - Open files tracking
   - Active terminals
   - Preview states
   - Recent actions

## Status & Notification System

### Purpose
Provides a centralized system for managing, aggregating, and displaying status updates and notifications from various system components, with special handling for long-running and streaming operations.

### Components

#### 1. Status Manager
- Responsibilities:
  - Aggregate status updates
  - Manage notification lifecycle
  - Handle stream subscriptions
  - Coordinate status display
- Key Features:
  - Stream aggregation
  - Priority management
  - Status persistence
  - Progress tracking

```typescript
interface StatusManager {
  // Core status management
  createStatus(config: StatusConfig): StatusHandle;
  updateStatus(id: string, update: StatusUpdate): void;
  completeStatus(id: string, result?: any): void;
  
  // Stream handling
  createStreamStatus<T>(stream: Observable<T>, config: StreamStatusConfig): StatusHandle;
  attachToStream<T>(statusId: string, stream: Observable<T>): void;
  
  // Subscriptions
  subscribeToStatus(id: string): Observable<StatusUpdate>;
  subscribeToType(type: StatusType): Observable<StatusUpdate>;
}

interface StatusConfig {
  type: StatusType;
  title: string;
  message: string;
  priority?: Priority;
  progress?: number;
  cancelable?: boolean;
  persistent?: boolean;
}

type StatusType = 
  | 'llm-processing'
  | 'file-operation'
  | 'git-operation'
  | 'build-process'
  | 'preview-update'
  | 'terminal-operation';
```

#### 2. Notification Hub
```typescript
interface NotificationHub {
  // Notification display
  show(notification: Notification): void;
  dismiss(id: string): void;
  update(id: string, update: Partial<Notification>): void;
  
  // Grouping & organization
  groupNotifications(criteria: GroupingCriteria): void;
  setDisplayStrategy(strategy: DisplayStrategy): void;
}

interface Notification extends StatusConfig {
  id: string;
  timestamp: Date;
  actions?: NotificationAction[];
  progress?: {
    current: number;
    total?: number;
    status?: string;
  };
}
```

### Status Flow

```mermaid
sequenceDiagram
    participant C as Component
    participant SM as Status Manager
    participant NH as Notification Hub
    participant UI as UI Components
    
    C->>SM: Create Status
    activate SM
    SM->>NH: Create Notification
    NH->>UI: Display Status
    
    loop Stream Updates
        C->>SM: Update Status
        SM->>NH: Update Notification
        NH->>UI: Refresh Display
    end
    
    C->>SM: Complete Status
    SM->>NH: Update Final State
    NH->>UI: Show Completion
    deactivate SM
```

### Integration Examples

1. **LLM Processing**
```typescript
// Example of LLM processing status
statusManager.createStreamStatus(
  llmResponse$,
  {
    type: 'llm-processing',
    title: 'Processing Request',
    message: 'Generating code changes...',
    priority: 'high'
  }
);
```

2. **Build Process**
```typescript
// Example of build process with progress
const status = statusManager.createStatus({
  type: 'build-process',
  title: 'Building Project',
  message: 'Compiling...',
  progress: 0
});

buildProcess.on('progress', (progress) => {
  status.update({ progress });
});
```

3. **File Write Stream**
```typescript
// Example of file write operation with streaming status
const writeStatus = statusManager.createStreamStatus(
  fileWriteStream$,
  {
    type: 'file-operation',
    title: 'Saving large file',
    message: 'Writing to disk...',
    priority: 'normal',
    cancelable: true
  }
);

// Example stream implementation
interface WriteProgress {
  bytesWritten: number;
  totalBytes: number;
  fileName: string;
}

const fileWriteStream$ = new Observable<WriteProgress>(observer => {
  let written = 0;
  const total = file.size;
  
  const chunk$ = from(file.chunks).pipe(
    mergeMap(async chunk => {
      await LFS.write(chunk);
      written += chunk.length;
      observer.next({
        bytesWritten: written,
        totalBytes: total,
        fileName: file.name
      });
    }),
    finalize(() => observer.complete())
  );

  // Allow cancellation
  return () => chunk$.unsubscribe();
});

// Status updates automatically as stream emits
writeStatus.progress$.subscribe(({ bytesWritten, totalBytes }) => {
  const percentage = Math.round((bytesWritten / totalBytes) * 100);
  updateStatusBar(`Writing ${percentage}% complete`);
});
```

The status system will:
- Show write progress in real-time
- Allow operation cancellation
- Update UI components automatically
- Handle errors gracefully

## Error Handling Strategy

### Purpose
Provides a simple, git-based approach to error handling and recovery, particularly focused on LLM interactions.

### Core Concepts

1. **Safety Commits**
   - Create automatic safety points before LLM changes
   - Store interaction metadata in commit messages
   - Enable clean rollback points

2. **Error Recovery**
   - Reset to last known good state via git
   - Clean up any partial changes
   - Provide clear user feedback

### Implementation

```typescript
interface LLMActionSafety {
  // Create safety point before LLM changes
  createSafetyCommit(): Promise<string>; // returns commit hash
  
  // Roll back to last safe state
  rollback(commitHash: string): Promise<void>;
}

// Example Usage
async function handleLLMAction(prompt: string) {
  const safetyCommit = await createSafetyCommit();
  
  try {
    const result = await executeLLMAction(prompt);
    return result;
  } catch (error) {
    await rollback(safetyCommit);
    throw new Error(`LLM action failed: ${error.message}`);
  }
}
```

### Error Categories

1. **Recoverable via Git**
   - Failed LLM actions
   - Invalid file changes
   - Syntax errors
   - Partial completions

2. **System Errors** (non-recoverable)
   - Git system failures
   - Storage corruption
   - Browser crashes
   - Hardware limitations

### Recovery Flow

```mermaid
sequenceDiagram
    participant User
    participant AM as Action Manager
    participant Git
    participant UI

    User->>AM: Execute LLM Action
    AM->>Git: Create Safety Commit
    
    alt Action Succeeds
        AM->>Git: Commit Changes
        AM->>UI: Show Success
    else Action Fails
        AM->>Git: Reset to Safety Commit
        AM->>UI: Show Error
    end
```