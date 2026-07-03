import { createRouter, createWebHistory } from 'vue-router'
import LibraryView from '../views/LibraryView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'library',
      component: LibraryView,
    },
    {
      path: '/photo/:id',
      name: 'photo-detail',
      component: () => import('../views/PhotoDetailView.vue'),
      props: true,
    },
  ],
})

export default router
