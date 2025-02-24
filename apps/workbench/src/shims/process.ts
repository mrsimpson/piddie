//@ts-nocheck

const browserProcess = {
  env: (window as any).process?.env || {},
  cwd: () => "/",
  platform: "browser",
  versions: {
    node: "16.0.0"
  },
  stdout: {
    write: (data: string) => console.log(data),
    on: (event: string, callback: Function) => {}
  },
  stderr: {
    write: (data: string) => console.error(data),
    on: (event: string, callback: Function) => {}
  }
};

export default browserProcess;
