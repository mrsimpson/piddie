import Dexie, { Table } from "dexie";
import type { Project, ProjectManager } from "./types";
import type { ChatManager } from "@piddie/chat-context";
import { generateProjectId } from "./utils/generate-project-id";

/**
 * Maximum attempts to generate a unique project ID
 */
const MAX_ID_GENERATION_ATTEMPTS = 10;

/**
 * Error thrown when unable to generate a unique project ID
 */
class ProjectIdGenerationError extends Error {
  constructor() {
    super("Unable to generate a unique project ID after multiple attempts");
    this.name = "ProjectIdGenerationError";
  }
}

/**
 * Database schema for project management
 */
export class ProjectDatabase extends Dexie {
  projects!: Table<Project, string>;

  constructor() {
    super("piddie-projects");

    this.version(1).stores({
      projects: "id, name, created, lastAccessed, fileSystemRoot, chatId"
    });
  }
}

/**
 * Implements project management using Dexie as the storage layer
 */
export class DexieProjectManager implements ProjectManager {
  private db: ProjectDatabase;

  constructor(
    db?: ProjectDatabase,
    private chatManager?: ChatManager
  ) {
    this.db = db || new ProjectDatabase();
  }

  /**
   * Generates a unique project ID by checking against existing IDs in the database
   * @throws {ProjectIdGenerationError} if unable to generate a unique ID after multiple attempts
   */
  private async generateUniqueProjectId(): Promise<string> {
    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt++) {
      const candidateId = generateProjectId();
      const existingProject = await this.db.projects.get(candidateId);

      if (!existingProject) {
        return candidateId;
      }
    }

    throw new ProjectIdGenerationError();
  }

  async createProject(name: string): Promise<Project> {
    const projectId = await this.generateUniqueProjectId();

    // Create chat first to ensure it exists
    if (this.chatManager) {
      await this.chatManager.createChat({
        projectId,
        projectName: name
      });
    }

    const project: Project = {
      id: projectId,
      name,
      created: new Date(),
      lastAccessed: new Date(),
      fileSystemRoot: `/projects/${name}`,
      chatId: projectId // Use same ID for chat
    };

    await this.db.projects.add(project);
    return project;
  }

  async openProject(id: string): Promise<Project> {
    const project = await this.db.projects.get(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    // Update lastAccessed
    const updatedProject = {
      ...project,
      lastAccessed: new Date()
    };
    await this.db.projects.put(updatedProject);

    return updatedProject;
  }

  async listProjects(): Promise<Project[]> {
    return this.db.projects.toArray();
  }

  async deleteProject(id: string): Promise<void> {
    const exists = await this.db.projects.get(id);
    if (!exists) {
      throw new Error(`Project not found: ${id}`);
    }

    await this.db.projects.delete(id);
  }

  async getProjectMetadata(id: string): Promise<Project> {
    const project = await this.db.projects.get(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    return project;
  }
}
