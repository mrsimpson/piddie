# Project Management Package

## Overview

Manages project lifecycle and metadata, coordinating between file system and chat context components.

## Core Components

### Project Manager

- **Responsibilities**:
  - Create and delete projects
  - Manage project metadata
  - Coordinate file system roots
  - Link chat contexts to projects

## Key Design Decisions

- Lightweight coordination of other components
- No direct file or chat management
- Simple metadata storage
- Clear component boundaries

## External Relationships

- References file system roots
- Links to chat contexts
- Provides project info to workbench

## Usage

```typescript
// Example of project creation
const project = await projectManager.createProject("My New Project");

// Opening existing project
const existingProject = await projectManager.openProject(projectId);
```
