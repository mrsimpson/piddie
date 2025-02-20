<template>
    <div class="panel">
      <header>
        <slot name="header"></slot>
      </header>
      <div class="content">
        <slot name="content"></slot>
      </div>
      <footer>
        <slot name="footer"></slot>
      </footer>
    </div>
  </template>
  
  <script setup>
  </script>
  
  <style scoped>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .content {
    flex: 1;
    overflow-y: auto;
  }
  </style>
  