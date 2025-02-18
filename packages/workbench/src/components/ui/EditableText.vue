<script setup lang="ts">
import { ref, watch } from "vue";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";

const props = defineProps<{
  value: string;
  size?: 'small' | 'medium' | 'large';
}>();

const emit = defineEmits<{
  change: [newValue: string];
}>();

const isEditing = ref(false);
const editedValue = ref(props.value);

// Update editedValue when props.value changes
watch(() => props.value, (newValue) => {
  if (!isEditing.value) {
    editedValue.value = newValue;
  }
});

function startEditing() {
  isEditing.value = true;
  editedValue.value = props.value;
}

function saveEdit() {
  const newValue = editedValue.value.trim();
  if (newValue && newValue !== props.value) {
    emit('change', newValue);
  }
  isEditing.value = false;
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    saveEdit();
  } else if (event.key === 'Escape') {
    isEditing.value = false;
    editedValue.value = props.value;
  }
}
</script>

<template>
  <div class="editable-text" :class="{ editing: isEditing }">
    <sl-input
      v-if="isEditing"
      :value="editedValue"
      :size="size ?? 'medium'"
      @input="editedValue = $event.target.value"
      @sl-blur="saveEdit"
      @keydown="handleKeyDown"
      autofocus
    />
    <div v-else class="display-container">
      <span class="text">{{ value }}</span>
      <sl-icon-button
        class="edit-button"
        name="pencil"
        :size="size ?? 'medium'"
        label="Edit"
        @click.stop="startEditing"
      />
    </div>
  </div>
</template>

<style scoped>
.editable-text {
  position: relative;
  width: 100%;
}

.display-container {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0;
}

.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: inherit;
}

.edit-button {
  opacity: 0;
  transition: opacity 0.2s ease;
  font-size: 1em;
}

.display-container:hover .edit-button {
  opacity: 1;
}

/* Remove default button styles */
.edit-button::part(base) {
  padding: 0.25rem;
  color: inherit;
}

.edit-button::part(base):hover {
  background: var(--sl-color-neutral-100);
}
</style>
