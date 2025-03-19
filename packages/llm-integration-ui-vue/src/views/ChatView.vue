<script setup lang="ts">
import ChatPanel from "../components/ChatPanel.vue";
</script>

<template>
  <div class="chat-view">
    <ChatPanel />
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
</style>
