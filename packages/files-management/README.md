# File System Package

## Overview

Provides a robust file management system that works across browser and local file systems with comprehensive synchronization capabilities and integrated version control.

![Demo of browser and local fs](./docs/demo-two-way-sync.gif)

## System Architecture

```mermaid
graph TD
    BrowserTarget[Browser Target] --> Manager[Sync Manager]
    LocalTarget[Local Target] --> Manager
    ContainerTarget[Container Target] --> Manager
    Manager --> BrowserTarget
    Manager --> LocalTarget
    Manager --> ContainerTarget
```

## Core Components

### 1. Sync Manager

- **Responsibilities**:
  - Coordinates synchronization between targets
  - Manages target registration and lifecycle
  - Tracks sync status and phase
  - Manages primary/secondary target roles
  - Handles sync failures and recovery

### 2. Sync Targets

Each environment implements the SyncTarget interface:

- **Browser Target**:

  - Manages browser-based filesystem
  - Handles file watching and change detection
  - Stores files in IndexedDB

- **Local Target**:

  - Interfaces with local filesystem
  - Handles file watching
  - Manages file permissions

- **Container Target**:
  - Manages WebContainer filesystem
  - Handles container-specific operations

## Synchronization Process

### Component Architecture and Interactions

The synchronization system consists of three main components that work together hierarchically:

1. **FileSyncManager** orchestrates the overall sync process

   - Coordinates between targets
   - Manages conflict resolution
   - Tracks global sync state

2. **SyncTarget** manages individual target synchronization

   - Handles change detection
   - Manages sync operations
   - Controls target-specific state
   - Manages filesystem locking during sync

3. **FileSystem** provides low-level file operations
   - Manages file access
   - Controls write permissions
   - Ensures data consistency

```mermaid
graph TD
    subgraph "Component Hierarchy"
        FSM[FileSyncManager] --> ST1[SyncTarget Primary]
        FSM --> ST2[SyncTarget Secondary]
        ST1 --> FS1[FileSystem]
        ST2 --> FS2[FileSystem]
    end
```

### State Machines

Each component maintains its own state machine, coordinating through well-defined interfaces:

#### 1. FileSystem States

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    Uninitialized --> Ready: initialize()
    Ready --> Locked: lock()

    state Locked {
        [*] --> ExternalLock
        [*] --> SyncLock
        ExternalLock: No writes allowed
        SyncLock: Only sync operations
    }

    Locked --> Ready: unlock()
    Ready --> Error: on error
    Error --> Ready: recovery
```

#### 2. SyncTarget States

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    Uninitialized --> Idle: initialize()
    Idle --> Collecting: notifyIncomingChanges()

    state Collecting {
        [*] --> Locked: acquire lock
        Locked --> ReceivingChanges: lock acquired
    }

    Collecting --> Syncing: all changes received

    state Syncing {
        [*] --> Applying
        Applying --> Verifying
    }

    Syncing --> Idle: syncComplete()
    Syncing --> Error: failure
    Error --> Idle: recovery
```

#### 3. FileSyncManager States

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    Uninitialized --> Ready: initialize()
    Ready --> Syncing: changes detected

    state Syncing {
        [*] --> PrimaryToSecondary
        [*] --> SecondaryToPrimary
    }

    Syncing --> Conflict: conflict detected
    Syncing --> Ready: success
    Conflict --> Ready: resolution
    Ready --> Error: on error
    Error --> Ready: recovery
```

### Locking and State Transitions

The sync process involves several state transitions coordinated between components:

```mermaid
sequenceDiagram
    participant FSM as FileSyncManager
    participant ST as SyncTarget
    participant FS as FileSystem

    FSM->>ST: notifyIncomingChanges(paths)
    activate ST
    Note over ST: State: Idle → Collecting
    ST->>FS: lock(mode='sync')
    Note over FS: State: Ready → Locked:SyncLock
    ST-->>FSM: Ready for changes

    FSM->>ST: applyChanges(changes)
    Note over ST: State: Collecting changes...

    Note over ST: All changes received
    Note over ST: State: Collecting → Syncing
    Note over ST: Apply changes...

    FSM->>ST: syncComplete()
    ST->>FS: unlock()
    Note over FS: State: Locked → Ready
    Note over ST: State: Syncing → Idle
    deactivate ST
```

### Primary/Secondary Target Concept

The sync system operates with a primary target that acts as the source of truth. All other targets are secondary and can be reinitialized from the primary if needed.

```mermaid
graph TD
    PT[Primary Target] --> ST1[Secondary Target 1]
    PT --> ST2[Secondary Target 2]
    PT --> ST3[Secondary Target 3]
```

### Sync States

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Collecting: Change Detected
    Collecting --> Syncing: Start Sync
    Syncing --> Idle: Success
    Syncing --> PendingChanges: Primary Sync Failed
    Syncing --> DirtyTarget: Secondary Sync Failed
    PendingChanges --> Idle: Manual Resolution
    DirtyTarget --> Reinitializing: Auto/Manual Trigger
    Reinitializing --> Idle: Success
```

### Sync Flows

#### 1. Primary Target Changes

```mermaid
sequenceDiagram
    participant P as Primary Target
    participant SM as Sync Manager
    participant S as Secondary Targets
    participant Git as Git Operations

    Note over P: File change detected
    P->>SM: Report changes (FileChangeInfo[])

    Note over SM: Phase: collecting
    Note over SM: Wait for inactivity

    par Lock Secondaries
        SM->>S: notifyIncomingChanges(paths)
        Note over S: Lock operations
    end

    Note over SM: Phase: syncing
    SM->>P: getContents(paths)
    P-->>SM: Return Map<path, content>

    par Apply to Secondaries
        SM->>S: applyChanges(FileChange[])

        alt Sync Success
            S-->>SM: Success
            SM->>Git: Create commit
        else Sync Failure
            S-->>SM: Failure
            Note over S: Mark target dirty
        end
    end

    Note over SM: Phase: idle
    SM->>S: syncComplete()
    Note over S: Unlock if no pending changes
```

#### 2. Secondary Target Changes

```mermaid
sequenceDiagram
    participant S as Secondary Target
    participant SM as Sync Manager
    participant P as Primary Target
    participant Git as Git Operations
    participant O as Other Secondaries

    Note over S: File change detected
    S->>SM: Report changes (FileChangeInfo[])

    Note over SM: State: syncing
    Note over SM: Wait for inactivity

    SM->>P: notifyIncomingChanges(paths)
    Note over P: Lock operations

    SM->>S: getContents(paths)
    S-->>SM: Return Map<path, content>

    SM->>P: applyChanges(FileChange[])

    alt Primary Sync Success
        P-->>SM: Success
        SM->>Git: Create commit

        par Propagate to Other Secondaries
            SM->>O: notifyIncomingChanges(paths)
            SM->>O: applyChanges(FileChange[])

            alt Secondary Sync Success
                O-->>SM: Success
                Note over SM: State: ready
            else Secondary Sync Failure
                O-->>SM: Failure
                Note over O: Mark target dirty
            end
        end

    else Primary Sync Failure
        P-->>SM: Failure
        Note over SM: State: conflict
        Note over SM: Store pending changes
        Note over SM: Await manual resolution
    end

    Note over SM: State: ready
    SM->>P: syncComplete()
    SM->>O: syncComplete()
    Note over P,O: Unlock if no pending changes
```

### Recovery and Resolution Process

```mermaid
sequenceDiagram
    participant U as User
    participant SM as Sync Manager
    participant P as Primary Target
    participant S as Secondary Targets

    alt Secondary Target Recovery
        Note over S: Target is dirty
        U->>SM: Trigger reinitialization
        SM->>P: getContents(all paths)
        P-->>SM: Return contents
        SM->>S: reinitialize()
        SM->>S: applyChanges(all files)
        Note over S: Target clean

    else Primary Sync Resolution
        Note over SM: State: conflict
        U->>SM: Request pending changes
        SM-->>U: Show changes

        alt User Confirms
            U->>SM: confirmPrimarySync()
            Note over SM: State: resolving
            SM->>P: applyChanges(pending)

            alt Apply Success
                P-->>SM: Success
                SM->>S: reinitialize()
                Note over SM: State: ready
                Note over S: All secondaries reinitialized
            else Apply Failure
                P-->>SM: Failure
                Note over SM: State: error
            end
        else User Rejects
            U->>SM: rejectPendingSync()
            Note over SM: Clear pending changes
            Note over SM: State: ready
        end
    end
```

### Conflict Resolution and Primary Target Overwrite

The sync system uses a primary target overwrite strategy to maintain consistency across all targets. This approach is based on several key principles:

1. **Primary Target as Source of Truth**

   - The primary target serves as the authoritative source for the entire system
   - All secondary targets must eventually converge to match the primary's state
   - This ensures a clear, deterministic resolution path for conflicts

2. **Resolution States**

   ```mermaid
   stateDiagram-v2
       [*] --> Conflict: Sync Failure
       Conflict --> Resolving: confirmPrimarySync()
       Resolving --> Ready: Success
       Resolving --> Error: Failure
       Ready --> [*]
   ```

3. **Resolution Process Flow**

   ```mermaid
   sequenceDiagram
       participant U as User
       participant SM as Sync Manager
       participant P as Primary Target
       participant S as Secondary Targets

       Note over SM: State: conflict
       U->>SM: View pending changes
       SM-->>U: Display changes
       U->>SM: confirmPrimarySync()

       Note over SM: State: resolving
       SM->>P: Apply changes

       alt Success
           SM->>S: Reinitialize all secondaries
           Note over S: Full sync from primary
           SM->>SM: Clear pending changes
           Note over SM: State: ready
       else Failure
           Note over SM: State: error
           SM-->>U: Report error
       end
   ```

4. **Consistency Guarantees**

   - **Atomic Updates**: Changes to the primary target are atomic - they either fully succeed or fail
   - **Transactional Behavior**: The resolution process is transactional:
     1. Lock primary target
     2. Apply changes
     3. On success: reinitialize all secondaries
     4. On failure: rollback to previous state
   - **State Tracking**: The system maintains explicit states during resolution:
     - `conflict`: Initial state when changes need resolution
     - `resolving`: Actively applying changes to primary
     - `ready`: Resolution complete, system consistent
     - `error`: Resolution failed, needs recovery

5. **Recovery Strategy**

   ```mermaid
   graph TD
       A[Detect Conflict] --> B{Primary Update}
       B -->|Success| C[Reinitialize Secondaries]
       B -->|Failure| D[Error State]
       C --> E[System Ready]
       D --> F[Manual Recovery]
       F --> A
   ```

6. **Benefits of Primary Overwrite**

   - **Deterministic Resolution**: Clear path to consistency
   - **Simple Mental Model**: Primary always wins
   - **Easy Recovery**: Secondary targets can always be reinitialized
   - **Data Safety**: No automatic merging or loss of changes
   - **User Control**: Explicit confirmation required for resolution

7. **Implementation Details**
   - Primary target maintains file state including:
     - File hashes for content verification
     - Timestamps for change detection
     - Size and metadata for validation
   - Secondary targets track their sync state:
     - Last successful sync timestamp
     - Pending changes
     - Current sync status
   - Resolution process ensures:
     - All file operations are completed
     - Proper error handling
     - State machine transitions
     - Lock management

This approach ensures that the system can always return to a consistent state through a well-defined process, with the primary target serving as the ultimate source of truth.

## Large File Handling

The system uses a streaming approach to handle large files efficiently, separating metadata from content.

### File Change Flow

```mermaid
sequenceDiagram
    participant ST as Source Target
    participant SM as Sync Manager
    participant DT as Destination Target

    Note over ST: File change detected
    ST->>SM: Report metadata only
    Note over SM: Collect changes

    SM->>ST: Request content stream

    loop Streaming
        ST->>SM: Stream chunk
        SM->>DT: Forward chunk
        Note over DT: Verify chunk hash
    end

    Note over DT: Verify complete file hash
    DT-->>SM: Sync result
```

### Metadata and Streaming

1. **Change Detection**

   ```mermaid
   graph TD
       A[File Change] --> B[Extract Metadata]
       B --> C[Calculate Hash]
       B --> D[Determine Size]
       C --> E[Report to Manager]
       D --> E
   ```

2. **Content Transfer**
   ```mermaid
   graph TD
       A[Request Content] --> B[Create Stream]
       B --> C[Read Chunk]
       C --> D{More Data?}
       D -->|Yes| E[Send Chunk]
       E --> C
       D -->|No| F[Close Stream]
   ```

### Key Components

1. **File Metadata**

   - Path information
   - File hash for verification
   - File size for progress tracking
   - Modification timestamp
   - Change type (create/modify/delete)

2. **Content Streaming**

   - Chunk-based transfer
   - Individual chunk hashes
   - Progress tracking
   - Resource management
   - Memory efficient

3. **Verification**
   - Per-chunk hash verification
   - Complete file hash validation
   - Size verification
   - Atomic operations

### Implementation Details

```mermaid
sequenceDiagram
    participant SM as Sync Manager
    participant ST as Source Target
    participant DT as Destination Target

    Note over SM,DT: Change Detection
    ST->>SM: FileMetadata[]

    Note over SM,DT: Content Transfer
    SM->>ST: getFileContent(path)
    activate ST
    ST-->>SM: FileContentStream

    loop For each chunk
        SM->>ST: readNextChunk()
        ST-->>SM: FileChunk
        SM->>DT: applyFileChange()
        Note over DT: Verify chunk
    end

    deactivate ST

    Note over DT: Verify complete file
    DT-->>SM: Sync result
```

### Benefits

1. **Memory Efficiency**

   - Only metadata in memory
   - Streaming content transfer
   - Controlled resource usage

2. **Progress Tracking**

   - Chunk-level progress
   - Size-based progress
   - Time estimation

3. **Data Integrity**

   - Hash verification
   - Atomic operations
   - Error recovery

4. **Resource Management**
   - Controlled streaming
   - Proper cleanup
   - Error handling

### Error Handling

1. **Stream Failures**

   ```mermaid
   graph TD
       A[Stream Error] --> B{Error Type}
       B -->|Read| C[Source Error]
       B -->|Write| D[Destination Error]
       B -->|Transfer| E[Network Error]
       C --> F[Cleanup & Retry]
       D --> F
       E --> F
   ```

2. **Recovery Strategies**
   - Chunk retry
   - Stream restart
   - Partial file recovery
   - Clean rollback

## Git Operations

Git operations are handled explicitly through the Git interface:

```typescript
interface GitOperations {
  commit(message: string): Promise<string>;
  checkout(branch: string): Promise<void>;
  status(): Promise<{
    branch: string;
    modified: string[];
    staged: string[];
  }>;
  history(path: string): Promise<
    Array<{
      hash: string;
      message: string;
      timestamp: number;
      changes: string[];
    }>
  >;
}
```

### Git Integration Flow

1. **Normal Changes**

   ```typescript
   // After successful sync
   await git.commit("sync: Update files from [source target]");
   ```
