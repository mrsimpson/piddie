<script setup lang="ts">
import { ref } from "vue";
import Terminal from "./Terminal.vue";
import type { RuntimeEnvironment } from "@piddie/runtime-environment";

const props = defineProps<{
  runtime: RuntimeEnvironment;
}>();

interface Session {
  id: string;
  title: string;
}

const sessions = ref<Session[]>([{ id: "default", title: "Terminal 1" }]);
const activeSessionId = ref("default");

const addSession = () => {
  const id = `session-${sessions.value.length + 1}`;
  sessions.value.push({
    id,
    title: `Terminal ${sessions.value.length + 1}`
  });
  activeSessionId.value = id;
};

const closeSession = (id: string) => {
  const index = sessions.value.findIndex((s: Session) => s.id === id);
  if (index > -1) {
    sessions.value.splice(index, 1);
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[0]?.id || "default";
    }
  }
};
</script>

<template>
  <div class="terminal-session-manager">
    <div class="tabs">
      <div
        v-for="session in sessions"
        :key="session.id"
        :class="['tab', { active: session.id === activeSessionId }]"
        @click="activeSessionId = session.id"
      >
        {{ session.title }}
        <button
          v-if="session.id !== 'default'"
          @click.stop="closeSession(session.id)"
          class="close-tab"
        >
          ×
        </button>
      </div>
      <button @click="addSession" class="add-tab">+</button>
    </div>

    <div class="terminals">
      <Terminal
        v-for="session in sessions"
        :key="session.id"
        :session-id="session.id"
        :runtime="runtime"
        v-show="session.id === activeSessionId"
      />
    </div>
  </div>
</template>

<style scoped>
.terminal-session-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tabs {
  display: flex;
  background: var(--sl-color-neutral-100);
  border-bottom: 1px solid var(--sl-color-neutral-300);
}

.tab {
  padding: 8px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  border-right: 1px solid var(--sl-color-neutral-300);
}

.tab.active {
  background: var(--sl-color-neutral-0);
  border-bottom: 2px solid var(--sl-color-primary-600);
}

.close-tab {
  border: none;
  background: none;
  padding: 2px 6px;
  cursor: pointer;
  border-radius: 4px;
}

.add-tab {
  padding: 8px 16px;
  cursor: pointer;
  background: none;
  border: none;
}

.terminals {
  flex: 1;
  position: relative;
}
</style>
