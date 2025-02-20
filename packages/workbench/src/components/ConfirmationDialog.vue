<script setup lang="ts">
import { ref } from "vue";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";

const props = defineProps<{
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}>();

const dialogRef = ref<HTMLSlDialogElement | null>(null);

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

</script>

<template>
  <sl-dialog ref="dialogRef" label="Confirm Deletion">
    <p>{{ message }}</p>
    <sl-button slot="footer" variant="primary" @click="handleConfirm">Yes</sl-button>
    <sl-button slot="footer" variant="default" @click="handleCancel">No</sl-button>
  </sl-dialog>
</template>

<style scoped>
/* Add any necessary styles here */
</style>