<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useProjectStore } from "../stores/project";
import ProjectsList from "../components/ProjectsList.vue";

const router = useRouter();
const projectStore = useProjectStore();
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
