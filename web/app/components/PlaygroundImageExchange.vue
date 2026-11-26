<script setup lang="ts">
import { Download } from '@lucide/vue';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { type ImageExchange, imageFileName } from '~/lib/playgroundImages';

defineProps<{ exchange: ImageExchange }>();

const { providerNamesBySlug, providerLogosBySlug } = useInjectedPlaygroundTarget();
</script>

<template>
  <Message from="user" class="max-w-[min(560px,88%)] max-[760px]:max-w-[92%]">
    <MessageContent
      class="group-[.is-user]:rounded-[14px_14px_4px_14px] group-[.is-user]:bg-[var(--chip)] group-[.is-user]:px-3.5 group-[.is-user]:py-2.5"
    >
      <p class="exchange__text">{{ exchange.prompt }}</p>
      <div v-if="exchange.inputImageUrls.length > 0" class="playground-images">
        <img
          v-for="(url, index) in exchange.inputImageUrls"
          :key="index"
          :src="url"
          :alt="`Input image ${index + 1}`"
        />
      </div>
    </MessageContent>
  </Message>
  <Message from="assistant" class="max-w-full">
    <MessageContent class="w-full max-w-[76ch] gap-2.5">
      <Shimmer v-if="exchange.state.kind === 'pending'" class="exchange__waiting" :duration="1.6">{{
        exchange.operation === 'edit' ? 'Editing the images…' : 'Generating…'
      }}</Shimmer>
      <p v-else-if="exchange.state.kind === 'stopped'" class="exchange__note">Stopped.</p>
      <p v-else-if="exchange.state.kind === 'failed'" class="exchange__error" role="alert">
        <span class="status-badge status-badge--bad">{{
          exchange.state.error.code ?? 'Error'
        }}</span>
        {{ exchange.state.error.message }}
      </p>
      <template v-else>
        <p v-if="exchange.state.imageUrls.length === 0" class="exchange__note">
          The gateway answered with no images.
        </p>
        <ul v-else class="image-results">
          <li
            v-for="(url, index) in exchange.state.imageUrls"
            :key="index"
            class="image-results__item"
          >
            <img :src="url" :alt="`Image ${index + 1} for: ${exchange.prompt}`" />
            <a
              class="button button--quiet"
              :href="url"
              :download="imageFileName(exchange.id, index, url)"
            >
              <Download :size="14" /> Download
            </a>
          </li>
        </ul>
        <PlaygroundReceipt
          :summary="exchange.state.summary"
          :routes="exchange.routes"
          :direct="exchange.isDirect"
          :provider-names="providerNamesBySlug"
          :provider-logos="providerLogosBySlug"
        />
      </template>
    </MessageContent>
  </Message>
</template>
