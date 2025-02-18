<script setup lang="ts">
import '@shoelace-style/shoelace/dist/components/card/card.js'
</script>

<template>
  <div class="chat-container">
    <div class="messages">
      <sl-card class="message user">
        <div class="message-content">User Message</div>
      </sl-card>
      <sl-card class="message system">
        <div class="message-content">System Message</div>
      </sl-card>
      <sl-card class="message agent">
        <div class="message-content">Agent Message</div>
      </sl-card>
    </div>
  </div>
</template>

<style scoped>
.chat-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message {
  --padding: 0.5rem;
}

.message.user {
  align-self: flex-end;
  width: 80%;
}

.message.system {
  align-self: center;
  width: 90%;
  font-style: italic;
}

.message.agent {
  align-self: flex-start;
  width: 80%;
}

.message-content {
  white-space: pre-wrap;
}
</style>
