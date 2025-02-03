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

    Note over SM: Phase: collecting
    Note over SM: Wait for inactivity

    SM->>P: notifyIncomingChanges(paths)
    Note over P: Lock operations

    Note over SM: Phase: syncing
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
            else Secondary Sync Failure
                O-->>SM: Failure
                Note over O: Mark target dirty
            end
        end

    else Primary Sync Failure
        P-->>SM: Failure
        Note over SM: Store pending changes
        Note over SM: Await manual resolution
    end

    Note over SM: Phase: idle
    SM->>P: syncComplete()
    SM->>O: syncComplete()
    Note over P,O: Unlock if no pending changes
```

### Recovery Process

#### Recovery Scenarios

1. **Secondary Target Failure**

   - Secondary target marked as "dirty"
   - Continues operating with other targets
   - Requires reinitialization from primary

2. **Primary Target Failure**
   - Changes remain pending
   - User can:
     - Review pending changes
     - Confirm primary sync (reinitialize secondaries)
     - Reject pending sync

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
        Note over SM: Has pending changes
        U->>SM: Request pending changes
        SM-->>U: Show changes

        alt User Confirms
            U->>SM: confirmPrimarySync()
            SM->>S: reinitialize()
            Note over S: All secondaries reinitialized
        else User Rejects
            U->>SM: rejectPendingSync()
            SM->>SM: Clear pending changes
        end
    end
```

### Key Features

1. **Clear Source of Truth**

   - Primary target maintains definitive state
   - Secondary targets can be reinitialized
   - Predictable sync flow

2. **Deterministic Recovery**

   - Simple recovery paths
   - No complex partial states
   - User control over data loss scenarios

3. **State Management**
   - Clear target roles
   - Explicit dirty state tracking
   - Pending change management

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

2. **Conflict Handling**
   ```typescript
   // When conflicts are detected
   await git.checkout("conflict/[timestamp]");
   await git.commit("conflict: Store conflicting versions\n\nPaths: [paths]");
   await git.checkout("main"); // Return to main branch
   ```

### Commit Messages

- Clear prefix indicating operation type (`sync:`, `conflict:`)
- Source target identification
- Affected paths in commit body
- Timestamp for conflict branches

## Usage Example

```typescript
// Register targets with specific filters
syncManager.registerTarget(
  new BrowserTarget({
    relevantPaths: ["src/**/*", "public/**/*"]
  })
);

syncManager.registerTarget(
  new ContainerTarget({
    ignorePaths: ["dist/**/*", "node_modules/**/*"]
  })
);

// Git operations are explicit
const git = new GitOperations();
await git.commit("feat: Initial commit");
```

## State Management

The system maintains detailed state information for all sync targets and operations.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Collecting: Change Detected
    Collecting --> Notifying: Batch Ready
    Notifying --> Syncing: All Notified
    Syncing --> Idle: Success
    Syncing --> Error: Failure
    Error --> Idle: Recovered

    state Syncing {
        [*] --> LockTargets
        LockTargets --> PropagateChanges
        PropagateChanges --> UnlockTargets
        UnlockTargets --> [*]
    }
```

### Target States

Each sync target maintains its own state:

```typescript
interface TargetState {
  id: string;
  type: "browser" | "local" | "container";
  lockState: LockState;
  pendingChanges: number;
  lastSyncTime?: number;
  status: "idle" | "collecting" | "notifying" | "syncing" | "error";
  error?: string;
}
```

### Lock Management

Targets use a timeout-based locking mechanism:

```typescript
// Lock target with timeout
await target.lock(5000, "Preparing for sync");

// Check lock state
const lockState = target.getLockState();
if (
  lockState.isLocked &&
  Date.now() - lockState.lockedSince > lockState.lockTimeout
) {
  // Handle timeout
  await target.forceUnlock();
}
```

### Error Recovery

The system provides mechanisms for handling lock failures:

1. **Timeout-based Locks**

   - All locks require timeout specification
   - Automatic unlock after timeout
   - Prevents indefinite locks

2. **Force Unlock**

   - Emergency unlock capability
   - Can be triggered per target or globally
   - Use with caution - may cause inconsistencies

3. **State Recovery**
   ```typescript
   // Example of recovery flow
   try {
     await syncManager.resume();
   } catch (error) {
     await syncManager.forceUnlockAll();
     // Handle recovery
   }
   ```

### Monitoring

The sync manager provides detailed status information:

```typescript
const status = syncManager.getStatus();
console.log(
  `Sync Progress: ${status.progress.processed}/${status.progress.total}`
);
status.targets.forEach((state, targetId) => {
  console.log(`Target ${targetId}: ${state.status}`);
});
```
