import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import ProjectsList from "./components/ProjectsList.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/projects/new"
  },
  {
    path: "/projects",
    components: {
      sidepanelLeft: ProjectsList,
      default: () => import("./views/ProjectsView.vue")
    }
  },
  {
    path: "/projects/new",
    components: {
      sidepanelLeft: ProjectsList,
      default: () => import("./views/NewProjectView.vue")
    }
  },
  {
    path: "/projects/:id",
    components: {
      sidepanelLeft: ProjectsList,
      default: () => import("./views/ProjectDetailsView.vue")
    },
    props: {
      default: true
    }
  }
];

export const router = createRouter({
  history: createWebHistory(),
  routes
});
