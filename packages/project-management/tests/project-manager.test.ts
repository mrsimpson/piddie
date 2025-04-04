import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Project } from "@piddie/shared-types";
import {
  DexieProjectManager,
  ProjectDatabase
} from "../src/internal/DexieProjectManager";
import type { Table } from "dexie";
import { generateProjectId } from "../src/utils/generateProjectId";

// Create mock functions
const projectMocks = {
  add: vi.fn<(project: Project) => Promise<string>>(),
  get: vi.fn<(id: string) => Promise<Project | undefined>>(),
  put: vi.fn<(project: Project) => Promise<void>>(),
  delete: vi.fn<(id: string) => Promise<void>>(),
  toArray: vi.fn<() => Promise<Project[]>>()
};

// Create a mock table that satisfies the Table interface
const mockTable = {
  ...projectMocks,
  db: {} as any,
  name: "projects",
  schema: {},
  hook: () => {},
  core: {} as any,
  get tableName() {
    return "projects";
  }
} as unknown as Table<Project, string>;

// Mock Dexie
vi.mock("dexie", () => {
  return {
    default: class MockDexie {
      projects: any;

      constructor() {
        this.projects = mockTable;
      }

      version() {
        return this;
      }

      stores() {
        return this;
      }
    }
  };
});

// Mock generateProjectId
vi.mock("../src/utils/generateProjectId");

describe("ProjectManager", () => {
  let projectManager: DexieProjectManager;
  let mockDb: ProjectDatabase;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockDb = new ProjectDatabase();
    mockDb.projects = mockTable;
    vi.mocked(generateProjectId).mockReturnValue("clever-fox-runs");
    projectManager = new DexieProjectManager(mockDb);
  });

  describe("GIVEN a new project manager", () => {
    describe("WHEN creating a new project", () => {
      it("THEN should create project with correct properties", async () => {
        const projectName = "Test Project";
        projectMocks.add.mockResolvedValueOnce("clever-fox-runs");
        projectMocks.get.mockResolvedValueOnce(undefined); // ID doesn't exist yet

        const project = await projectManager.createProject(projectName);

        expect(project).toMatchObject({
          name: projectName
        });
        expect(project.id).toBe("clever-fox-runs");
        expect(project.created).toBeInstanceOf(Date);
        expect(project.lastAccessed).toBeInstanceOf(Date);
        expect(project.chatId).toBe(project.id);
        expect(projectMocks.add).toHaveBeenCalledWith(project);
      });
    });

    describe("WHEN listing projects", () => {
      it("THEN should return empty list initially", async () => {
        projectMocks.toArray.mockResolvedValueOnce([]);

        const projects = await projectManager.listProjects();
        expect(projects).toHaveLength(0);
        expect(projectMocks.toArray).toHaveBeenCalled();
      });

      it("THEN should return created projects", async () => {
        const mockProjects = [
          { name: "Project 1", id: "clever-fox-runs" } as Project,
          { name: "Project 2", id: "clever-fox-runs" } as Project
        ];
        projectMocks.toArray.mockResolvedValueOnce(mockProjects);

        const projects = await projectManager.listProjects();
        expect(projects).toHaveLength(2);
        expect(projects.map((p) => p.name)).toEqual(["Project 1", "Project 2"]);
      });
    });
  });

  describe("GIVEN an existing project", () => {
    const existingProject: Project = {
      id: "clever-fox-runs",
      name: "Existing Project",
      created: new Date(),
      lastAccessed: new Date(),
      chatId: "clever-fox-runs"
    };

    beforeEach(() => {
      projectMocks.get.mockResolvedValue(existingProject);
    });

    describe("WHEN opening the project", () => {
      it("THEN should return project and update lastAccessed", async () => {
        const beforeOpen = existingProject.lastAccessed;
        await new Promise((resolve) => setTimeout(resolve, 1)); // Ensure time difference

        const project = await projectManager.openProject(existingProject.id);
        expect(project.id).toBe(existingProject.id);
        expect(project.lastAccessed.getTime()).toBeGreaterThan(
          beforeOpen.getTime()
        );
        expect(projectMocks.put).toHaveBeenCalled();
      });

      it("THEN should throw error for non-existent project", async () => {
        projectMocks.get.mockResolvedValueOnce(undefined);
        await expect(
          projectManager.openProject("non-existent")
        ).rejects.toThrow("Project not found");
      });
    });

    describe("WHEN deleting the project", () => {
      it("THEN should remove project from list", async () => {
        projectMocks.delete.mockResolvedValueOnce(undefined);

        await projectManager.deleteProject(existingProject.id);
        expect(projectMocks.delete).toHaveBeenCalledWith(existingProject.id);
      });

      it("THEN should throw error for non-existent project", async () => {
        projectMocks.get.mockResolvedValueOnce(undefined);
        await expect(
          projectManager.deleteProject("non-existent")
        ).rejects.toThrow("Project not found");
      });
    });

    describe("WHEN getting project metadata", () => {
      it("THEN should return project data", async () => {
        const metadata = await projectManager.getProjectMetadata(
          existingProject.id
        );
        expect(metadata).toEqual(existingProject);
        expect(projectMocks.get).toHaveBeenCalledWith(existingProject.id);
      });

      it("THEN should throw error for non-existent project", async () => {
        projectMocks.get.mockResolvedValueOnce(undefined);
        await expect(
          projectManager.getProjectMetadata("non-existent")
        ).rejects.toThrow("Project not found");
      });
    });
  });

  describe("GIVEN a project manager with chat support", () => {
    beforeEach(() => {
      projectManager = new DexieProjectManager(mockDb);
    });

    describe("WHEN creating a project", () => {
      it("THEN should retry ID generation if ID exists", async () => {
        const projectName = "Test Project";
        const existingProject: Project = {
          id: "clever-fox-runs",
          name: "Existing Project",
          created: new Date(),
          lastAccessed: new Date(),
          chatId: "clever-fox-runs"
        };

        // First ID exists, second one doesn't
        projectMocks.get
          .mockResolvedValueOnce(existingProject)
          .mockResolvedValueOnce(undefined);

        // Mock the second call to generateProjectId
        vi.mocked(generateProjectId)
          .mockReturnValueOnce("clever-fox-runs") // First call returns existing ID
          .mockReturnValueOnce("happy-owl-soars"); // Second call returns unique ID

        projectMocks.add.mockResolvedValueOnce("happy-owl-soars");

        const project = await projectManager.createProject(projectName);

        expect(project.id).toBe("happy-owl-soars");
        expect(generateProjectId).toHaveBeenCalledTimes(2);
        expect(projectMocks.get).toHaveBeenCalledTimes(2);
      });
    });

    describe("WHEN deleting a project", () => {
      it("THEN should delete the project from the database", async () => {
        const existingProject: Project = {
          id: "clever-fox-runs",
          name: "Existing Project",
          created: new Date(),
          lastAccessed: new Date(),
          chatId: "clever-fox-runs"
        };

        projectMocks.get.mockResolvedValueOnce(existingProject);
        projectMocks.delete.mockResolvedValueOnce(undefined);

        await projectManager.deleteProject(existingProject.id);

        // Only verify that the project is deleted from the database
        expect(projectMocks.delete).toHaveBeenCalledWith(existingProject.id);
      });
    });
  });
});
