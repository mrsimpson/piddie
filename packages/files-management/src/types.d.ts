/* eslint @typescript-eslint/no-explicit-any: 0 */

// Type declarations for DOM APIs
interface Window {
  indexedDB: IDBFactory;
}

interface IDBFactory {
  open(name: string, version?: number): IDBOpenDBRequest;
  deleteDatabase(name: string): IDBOpenDBRequest;
  databases?(): Promise<IDBDatabaseInfo[]>;
}

interface IDBDatabaseInfo {
  name: string;
  version: number;
}

interface IDBOpenDBRequest extends IDBRequest<IDBDatabase> {
  onupgradeneeded:
    | ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any)
    | null;
  onblocked: ((this: IDBOpenDBRequest, ev: Event) => any) | null;
}

interface IDBVersionChangeEvent extends Event {
  newVersion: number | null;
  oldVersion: number;
}

interface IDBDatabase {
  close(): void;
}

interface IDBRequest<T> extends EventTarget {
  readonly error: DOMException | null;
  readonly result: T;
  readonly readyState: IDBRequestReadyState;
  readonly source: IDBObjectStore | IDBIndex | IDBCursor | null;
  readonly transaction: IDBTransaction | null;
  onerror: ((this: IDBRequest<T>, ev: Event) => any) | null;
  onsuccess: ((this: IDBRequest<T>, ev: Event) => any) | null;
  onblocked?: ((this: IDBRequest<T>, ev: Event) => any) | null;
}

type IDBRequestReadyState = "pending" | "done";

// Declare global variables
declare const window: Window;
