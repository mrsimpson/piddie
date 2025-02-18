import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Project } from '../src'
import { DexieProjectManager, ProjectDatabase } from '../src/project-manager'
import type { Table } from 'dexie'

// Create mock functions
const projectMocks = {
  add: vi.fn<(project: Project) => Promise<string>>(),
  get: vi.fn<(id: string) => Promise<Project | undefined>>(),
  put: vi.fn<(project: Project) => Promise<void>>(),
  toArray: vi.fn<() => Promise<Project[]>>(),
  delete: vi.fn<(id: string) => Promise<void>>()
}

// Create a mock table that satisfies the Table interface
const mockTable = {
  ...projectMocks,
  db: {} as any,
  name: 'projects',
  schema: {},
  hook: () => { },
  core: {} as any,
  get tableName() { return 'projects' },
} as unknown as Table<Project, string>

// Mock Dexie
vi.mock('dexie', () => {
  return {
    default: class MockDexie {
      projects: any

      constructor() {
        this.projects = mockTable
      }

      version() {
        return this
      }

      stores() {
        return this
      }
    }
  }
})

describe('ProjectManager', () => {
  let projectManager: DexieProjectManager
  let mockDb: ProjectDatabase

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()
    mockDb = new ProjectDatabase()
    mockDb.projects = mockTable
    projectManager = new DexieProjectManager(mockDb)
  })

  describe('GIVEN a new project manager', () => {
    describe('WHEN creating a new project', () => {
      it('THEN should create project with correct properties', async () => {
        const projectName = 'Test Project'
        projectMocks.add.mockResolvedValueOnce('new-id')

        const project = await projectManager.createProject(projectName)

        expect(project).toMatchObject({
          name: projectName,
          fileSystemRoot: `/projects/${projectName}`
        })
        expect(project.id).toMatch(/^proj_\d+$/)
        expect(project.created).toBeInstanceOf(Date)
        expect(project.lastAccessed).toBeInstanceOf(Date)
        expect(project.chatContextId).toMatch(/^chat_\d+$/)
        expect(projectMocks.add).toHaveBeenCalledWith(project)
      })
    })

    describe('WHEN listing projects', () => {
      it('THEN should return empty list initially', async () => {
        projectMocks.toArray.mockResolvedValueOnce([])

        const projects = await projectManager.listProjects()
        expect(projects).toHaveLength(0)
        expect(projectMocks.toArray).toHaveBeenCalled()
      })

      it('THEN should return created projects', async () => {
        const mockProjects = [
          { name: 'Project 1', id: 'proj_1' } as Project,
          { name: 'Project 2', id: 'proj_2' } as Project
        ]
        projectMocks.toArray.mockResolvedValueOnce(mockProjects)

        const projects = await projectManager.listProjects()
        expect(projects).toHaveLength(2)
        expect(projects.map(p => p.name)).toEqual(['Project 1', 'Project 2'])
      })
    })
  })

  describe('GIVEN an existing project', () => {
    const existingProject: Project = {
      id: 'proj_1',
      name: 'Existing Project',
      created: new Date(),
      lastAccessed: new Date(),
      fileSystemRoot: '/projects/existing',
      chatContextId: 'chat_1'
    }

    beforeEach(() => {
      projectMocks.get.mockResolvedValue(existingProject)
    })

    describe('WHEN opening the project', () => {
      it('THEN should return project and update lastAccessed', async () => {
        const beforeOpen = existingProject.lastAccessed
        await new Promise(resolve => setTimeout(resolve, 1)) // Ensure time difference

        const project = await projectManager.openProject(existingProject.id)
        expect(project.id).toBe(existingProject.id)
        expect(project.lastAccessed.getTime()).toBeGreaterThan(beforeOpen.getTime())
        expect(projectMocks.put).toHaveBeenCalled()
      })

      it('THEN should throw error for non-existent project', async () => {
        projectMocks.get.mockResolvedValueOnce(undefined)
        await expect(projectManager.openProject('non-existent')).rejects.toThrow('Project not found')
      })
    })

    describe('WHEN deleting the project', () => {
      it('THEN should remove project from list', async () => {
        projectMocks.delete.mockResolvedValueOnce(undefined)

        await projectManager.deleteProject(existingProject.id)
        expect(projectMocks.delete).toHaveBeenCalledWith(existingProject.id)
      })

      it('THEN should throw error for non-existent project', async () => {
        projectMocks.get.mockResolvedValueOnce(undefined)
        await expect(projectManager.deleteProject('non-existent')).rejects.toThrow('Project not found')
      })
    })

    describe('WHEN getting project metadata', () => {
      it('THEN should return project data', async () => {
        const metadata = await projectManager.getProjectMetadata(existingProject.id)
        expect(metadata).toEqual(existingProject)
        expect(projectMocks.get).toHaveBeenCalledWith(existingProject.id)
      })

      it('THEN should throw error for non-existent project', async () => {
        projectMocks.get.mockResolvedValueOnce(undefined)
        await expect(projectManager.getProjectMetadata('non-existent')).rejects.toThrow('Project not found')
      })
    })
  })
})
