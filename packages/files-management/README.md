# File System Package

## Overview

Provides a robust file management system that works across browser and local file systems with comprehensive synchronization capabilities and integrated version control.

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

### Sync Process

```mermaid
graph TD
    subgraph "Change Detection"
        CD1[Primary Changes] --> SP1[Sync to Secondaries]
        CD2[Secondary Changes] --> SP2[Sync to Primary]
    end

    subgraph "Sync Process"
        SP1 --> SS1{Sync Success?}
        SP2 --> SS2{Primary Sync Success?}
        
        SS1 -->|Yes| Done1[Complete]
        SS1 -->|No| MD[Mark Target Dirty]
        
        SS2 -->|Yes| SP1
        SS2 -->|No| PC[Store Pending Changes]
    end

    subgraph "Recovery"
        MD --> RI[Reinitialize]
        PC --> MR{Manual Resolution}
        MR -->|Confirm| RAS[Reinit All Secondaries]
        MR -->|Reject| DC[Discard Changes]
    end
```

### Error Handling

1. **Target States**
   - Idle: Normal operation
   - Dirty: Failed sync, needs reinitialization
   - Pending: Failed primary sync, needs resolution

2. **Recovery Actions**
   - Automatic reinitialization of dirty targets
   - Manual resolution of pending changes
   - Clear error reporting and status tracking

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
