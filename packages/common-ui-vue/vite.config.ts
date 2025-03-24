import { resolve } from "path";
import { createLibConfig } from "../../vite.ui.config";
import pkg from "./package.json" with { type: "json" };

export default createLibConfig({
    entry: resolve(__dirname, "src/index.ts"),
    pkg,
});