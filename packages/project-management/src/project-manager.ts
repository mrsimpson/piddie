import Dexie, { Table } from 'dexie'
import type { Project, ProjectManager } from './types'

/**
 * Database schema for project management
 */
export class ProjectDatabase extends Dexie {
  projects!: Table<Project, string>

  constructor() {
    super('piddie-projects')
    
    this.version(1).stores({
      projects: 'id, name, created, lastAccessed, fileSystemRoot, chatContextId'
    })
  }
}

/**
 * Implements project management using Dexie as the storage layer
 */
export class DexieProjectManager implements ProjectManager {
  private db: ProjectDatabase

  constructor(db?: ProjectDatabase) {
    this.db = db || new ProjectDatabase()
  }

  async createProject(name: string): Promise<Project> {
    const project: Project = {
      id: `proj_${Date.now()}`,
      name,
      created: new Date(),
      lastAccessed: new Date(),
      fileSystemRoot: `/projects/${name}`,
      chatContextId: `chat_${Date.now()}`
    }

    await this.db.projects.add(project)
    return project
  }

  async openProject(id: string): Promise<Project> {
    const project = await this.db.projects.get(id)
    if (!project) {
      throw new Error(`Project not found: ${id}`)
    }

    // Update lastAccessed
    const updatedProject = {
      ...project,
      lastAccessed: new Date()
    }
    await this.db.projects.put(updatedProject)
    
    return updatedProject
  }

  async listProjects(): Promise<Project[]> {
    return this.db.projects.toArray()
  }

  async deleteProject(id: string): Promise<void> {
    const exists = await this.db.projects.get(id)
    if (!exists) {
      throw new Error(`Project not found: ${id}`)
    }
    
    await this.db.projects.delete(id)
  }

  async getProjectMetadata(id: string): Promise<Project> {
    const project = await this.db.projects.get(id)
    if (!project) {
      throw new Error(`Project not found: ${id}`)
    }
    return project
  }
}
