import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/projects/new"
  },
  {
    path: "/projects",
    components: {
      sidepanelLeft: () => import("./views/ProjectsListView.vue"),
      default: () => import("./views/ProjectsListView.vue")
    }
  },
  {
    path: "/projects/new",
    components: {
      sidepanelLeft: () => import("./views/ProjectsListView.vue"),
      default: () => import("./views/NewProjectView.vue")
    }
  },
  {
    path: "/projects/:id",
    components: {
      sidepanelLeft: () => import("./views/ProjectsListView.vue"),
      default: () => import("./views/ProjectView.vue")
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
