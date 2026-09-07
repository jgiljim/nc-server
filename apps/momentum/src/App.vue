<script setup lang="ts">
// Root shell (frontend.md § Integration Model): the NcAppNavigation sidebar
// (§ Navigation Tree Additions) alongside the routed page content.
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcContent from '@nextcloud/vue/components/NcContent'
import AppNavigation from './components/AppNavigation.vue'
</script>

<template>
  <NcContent app-name="momentum">
    <AppNavigation />
    <NcAppContent>
      <router-view />
    </NcAppContent>
  </NcContent>
</template>
