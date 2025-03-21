<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import type SlDialog from "@shoelace-style/shoelace/dist/components/dialog/dialog.js";

const props = defineProps<{
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}>();

const dialogRef = ref<SlDialog | null>(null);
const confirmButtonRef = ref<HTMLElement | null>(null);
const cancelButtonRef = ref<HTMLElement | null>(null);

function showDialog() {
  dialogRef.value?.show();
}

function hideDialog() {
  dialogRef.value?.hide();
}

function handleConfirm() {
  props.onConfirm();
  hideDialog();
}

function handleCancel() {
  props.onCancel();
  hideDialog();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === " ") {
    event.preventDefault();

    // Check which button is currently focused
    if (document.activeElement === confirmButtonRef.value) {
      handleConfirm();
    } else if (document.activeElement === cancelButtonRef.value) {
      handleCancel();
    }
  }
}

onMounted(async () => {
  showDialog();

  // Wait for the dialog to render and then focus the cancel button
  await nextTick();
  cancelButtonRef.value?.focus();

  // Add event listener for space key
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  // Remove event listener to prevent memory leaks
  window.removeEventListener("keydown", handleKeyDown);
});
</script>

<template>
  <sl-dialog ref="dialogRef" label="Confirm Deletion">
    <p>{{ message }}</p>
    <sl-button
      ref="cancelButtonRef"
      slot="footer"
      variant="default"
      tabindex="1"
      @click="handleCancel"
    >
      No
    </sl-button>
    <sl-button
      ref="confirmButtonRef"
      slot="footer"
      variant="primary"
      tabindex="2"
      @click="handleConfirm"
    >
      Yes
    </sl-button>
  </sl-dialog>
</template>

<style scoped>
/* Add any necessary styles here */
</style>
