//@ts-nocheck
//eslint-ignore-file

class ChildProcess extends EventTarget {
  stdin: any;
  stdout: any;
  stderr: any;
  pid: number;

  constructor() {
    super();
    this.stdin = new MessagePort();
    this.stdout = new MessagePort();
    this.stderr = new MessagePort();
    this.pid = Math.floor(Math.random() * 1000000);
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.addEventListener(event, (e: any) => listener(e.detail));
    return this;
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.removeEventListener(event, (e: any) => listener(e.detail));
    return this;
  }

  emit(event: string, ...args: any[]) {
    this.dispatchEvent(new CustomEvent(event, { detail: args }));
    return true;
  }
}

export function spawn(
  command: string,
  args?: string[],
  options?: any
): ChildProcess {
  const worker = new Worker(
    new URL("../workers/mcp-worker.ts", import.meta.url),
    { type: "module" }
  );
  const process = new ChildProcess();

  worker.onmessage = (e) => {
    const { type, data } = e.data;
    switch (type) {
      case "stdout":
        process.emit("data", data);
        break;
      case "stderr":
        process.stderr.emit("data", data);
        break;
      case "exit":
        process.emit("exit", data);
        worker.terminate();
        break;
    }
  };

  worker.postMessage({ command, args, options });
  return process;
}
