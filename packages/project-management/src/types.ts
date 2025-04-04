import type { Project } from "@piddie/shared-types";

/**
 * Manages project lifecycle and metadata
 */
export interface ProjectManager {
  /**
   * Creates a new project
   * @param name - The name of the project
   * @returns The newly created project
   */
  createProject(name: string): Promise<Project>;

  /**
   * Opens an existing project
   * @param id - The project ID
   * @returns The project if found
   */
  openProject(id: string): Promise<Project>;

  /**
   * Lists all available projects
   * @returns Array of projects
   */
  listProjects(): Promise<Project[]>;

  /**
   * Updates an existing project
   * @param project - The project to update
   */
  updateProject(project: Project): Promise<void>;

  /**
   * Deletes a project
   * @param id - The project ID
   */
  deleteProject(id: string): Promise<void>;

  /**
   * Gets metadata for a specific project
   * @param id - The project ID
   * @returns The project metadata
   */
  getProjectMetadata(id: string): Promise<Project>;
}
