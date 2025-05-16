- The structure of this project is a monorepo with pnpm and turborepo
- The packages can interact with each other only using their exposed exports. Make sure to never import a relative path which is from another package
- The apps-folder contains user facing web apps. These packages must never be required from other packages
- If you want to execute tools on the bash, always `cd` into the package first
- If you need to understand what this project is about, check the docs folder of each package
  - The README of each package contains a brief description about the responsibility of each package
  - The target architecture is documented in /docs/arc42-architecture.md
- After each _minor_ change in the code,
  - type check the code (by running pm run typecheck in the bash)
  - lint the code (by running pnpm lint in the bash)
- After each **major** change in the code, in this order perform

  - run `pnpm turbo run --parallel lint format typecheck test` in the bash
  - use the git git_add tool to add the changes to the staging area and the git_commit tool with a message of the following pattern:

  ```text
  > {{The last prompt by the user, if it's already written in an imperative style. Else or if multiple user commands were involved an imperative version of the user's intention}}

  {{A summary of the changes you performed after the last prompt and what was the reasoning behind those changes}}
  ```
