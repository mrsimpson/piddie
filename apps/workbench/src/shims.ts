// Shims for Node.js modules
export const spawn = () => {
  throw new Error("spawn is not supported in the browser");
};

export const process = {
  env: {},
  cwd: () => "/",
  platform: "browser",
  versions: {},
  stdout: {
    write: () => {},
    on: () => {}
  },
  stderr: {
    write: () => {},
    on: () => {}
  }
};
