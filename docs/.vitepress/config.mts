import { defineConfig } from "vitepress";
import fs from "fs";
import path from "path";
import { withMermaid } from "vitepress-plugin-mermaid";

interface SidebarItem {
  text: string;
  items?: SidebarItem[];
  link?: string;
}

// Function to recursively get all markdown files
function getSidebarItems(dir: string, basePath: string = ""): SidebarItem[] {
  const items: SidebarItem[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const relativePath = path.join(basePath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file === ".vitepress") continue;
      if (file === "node_modules") continue;
      if (file.match(/^_example/)) continue;

      const children = getSidebarItems(fullPath, relativePath);
      const readmePath = path.join(fullPath, "README.md");
      const hasReadme = fs.existsSync(readmePath);

      if (hasReadme) {
        console.log("Found README:", {
          dir: file,
          readmePath,
          link: "/" + relativePath.replace(/\\/g, "/")
        });
      }

      if (hasReadme || children.length) {
        items.push({
          text: file,
          link: hasReadme ? "/" + relativePath.replace(/\\/g, "/") : "/",
          items: children
        });
      }
    } else if (file.endsWith(".md") && file !== "README.md") {
      items.push({
        text: file.replace(".md", ""),
        link: "/" + relativePath.replace(".md", "").replace(/\\/g, "/")
      });
    }
  }

  return items;
}

export default withMermaid(
  defineConfig({
    title: "Project Documentation",
    description: "Project Architecture & Documentation",
    base: "/piddie/",
    srcDir: "..",

    // Add this to handle the root path
    rewrites: {
      "README.md": "index.md",
      "apps/:app/README.md": ":app/index.md",
      "packages/:pkg/README.md": ":pkg/index.md"
    },

    // Enable mermaid diagrams
    mermaid: {
      theme: "neutral"
    },

    themeConfig: {
      // Update sidebar to ensure root README is included
      sidebar: [
        {
          text: "Getting Started",
          items: [
            { text: "Overview", link: "/" },
            { text: "Architecture", link: "/docs/arc42-architecture" }
          ]
        },
        {
          text: "Components",
          items: getSidebarItems(path.resolve(__dirname, "../../packages"))
        },
        {
          text: "Frontends",
          items: getSidebarItems(path.resolve(__dirname, "../../apps"))
        },
        {
          text: "Documentation",
          items: getSidebarItems(path.resolve(__dirname, "../../docs")).filter(
            (item) => !item.text.match(/.*arc42.*/)
          )
        }
      ],

      nav: [
        { text: "Home", link: "/" },
        { text: "Architecture", link: "/docs/arc42-architecture" },
        { text: "Frontends", link: "/apps/" },
        { text: "Components", link: "/packages/" }
      ]
    }
  })
);
