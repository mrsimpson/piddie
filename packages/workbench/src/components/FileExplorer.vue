<script setup lang="ts">
import "@shoelace-style/shoelace/dist/components/tree/tree.js";
import "@shoelace-style/shoelace/dist/components/tree-item/tree-item.js";
</script>

<template>
  <div class="file-explorer-container">
    <sl-tree>
      <sl-tree-item expanded>
        <sl-icon slot="expand-icon" name="folder"></sl-icon>
        <sl-icon slot="collapse-icon" name="folder-open"></sl-icon>
        folder
        <sl-tree-item>
          <sl-icon slot="expand-icon" name="folder"></sl-icon>
          <sl-icon slot="collapse-icon" name="folder-open"></sl-icon>
          sub
        </sl-tree-item>
        <sl-tree-item>
          <sl-icon slot="icon" name="file-earmark-text"></sl-icon>
          file 1
        </sl-tree-item>
        <sl-tree-item>
          <sl-icon slot="icon" name="file-earmark-text"></sl-icon>
          file 2
        </sl-tree-item>
      </sl-tree-item>
    </sl-tree>
  </div>
</template>

<style scoped>
.file-explorer-container {
  height: 100%;
  padding: 1rem;
}
</style>
