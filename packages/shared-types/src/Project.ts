/**
 * Represents a project in the system
 */
export interface Project {
  /** Unique identifier for the project */
  id: string;

  /** Human-readable name of the project */
  name: string;

  /** When the project was created */
  created: Date;

  /** When the project was last accessed */
  lastAccessed: Date;

  /** Reference to the chat context for this project */
  chatId: string;
}
