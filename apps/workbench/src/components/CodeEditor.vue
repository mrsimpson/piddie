<script setup lang="ts">
// We'll integrate with Monaco editor later
</script>

<template>
  <div class="editor-container">
    <!-- Monaco editor will be mounted here -->
    <div class="placeholder">Code Editor</div>
  </div>
</template>

<style scoped>
.editor-container {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder {
  color: var(--sl-color-neutral-400);
}
</style>
