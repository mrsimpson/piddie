<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "@piddie/project-management-ui-vue";
import { ProjectsList } from "@piddie/project-management-ui-vue";

const router = useRouter();
const projectStore = useProjectStore();

// @ts-expect-error - Known type mismatch with Pinia stores exported from the ui-lib-package
const { currentProject } = storeToRefs(projectStore);

onMounted(() => {
  // If there's a current project, navigate to it
  if (currentProject.value) {
    router.replace(`/projects/${currentProject.value.id}`);
  }
});
</script>

<template>
  <ProjectsList />
</template>
