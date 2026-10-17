<script setup lang="ts">
import { ref } from "vue";
import { ArrowLeft } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <PageHeader
      title="Add provider"
      description="Choose a provider from the catalog. Authentication is selected on the provider page using the same OAuth, API key, native, and cookie actions as v1."
    >
      <template #actions
        ><RouterLink to="/dashboard/providers"
          ><Button variant="outline" size="sm"
            ><ArrowLeft class="size-4" />Back to providers</Button
          ></RouterLink
        ></template
      >
    </PageHeader>
    <Card class="p-6 sm:p-8">
      <p class="text-sm leading-6 text-muted-foreground">
        Open the Providers page and select a provider to see its supported
        connection methods. The available actions are provider-specific and are
        not replaced by a generic connection form.
      </p>
      <Button class="mt-6" @click="router.push('/dashboard/providers')"
        >Choose provider</Button
      >
    </Card>
  </div>
</template>
