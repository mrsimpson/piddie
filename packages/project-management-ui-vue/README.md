# Workbench App

## Overview

Manages the overall IDE workspace state, persisting user preferences and session information across browser refreshes with comprehensive state management capabilities.

It allows for chatting with an LLM and observe the changes the LLM does to the files within the mounted filesystems.

By no means this is intendeed to be a production ready UI compared to bolt.new (or bolt.diy) yet, but it shall allw for understanding how the parts work together.

## Running the App

To run this application:

1. Navigate to the `apps/workbench` directory: `cd apps/workbench`
2. Install the dependencies: `pnpm install`
3. Start the development server: `pnpm run dev`

The application will be accessible at `http://localhost:9999`.
