<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
import { useThemeStore } from "@/stores/theme";

const theme = useThemeStore();
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    :aria-label="theme.theme === 'dark' ? 'Use light theme' : 'Use dark theme'"
    :title="theme.theme === 'dark' ? 'Use light theme' : 'Use dark theme'"
    @click="theme.toggle()"
  >
    <Sun v-if="theme.theme === 'dark'" class="size-4" />
    <Moon v-else class="size-4" />
  </Button>
</template>
