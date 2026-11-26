<script setup lang="ts">
import { Download } from '@lucide/vue';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  RUNNING_STATUS_LABELS,
  type VideoExchange,
  videoContentUrl,
  videoFileName,
} from '~/lib/playgroundVideo';

defineProps<{ exchange: VideoExchange }>();

const { providerNamesBySlug, providerLogosBySlug } = useInjectedPlaygroundTarget();
</script>

<template>
  <Message from="user" class="max-w-[min(560px,88%)] max-[760px]:max-w-[92%]">
    <MessageContent
      class="group-[.is-user]:rounded-[14px_14px_4px_14px] group-[.is-user]:bg-[var(--chip)] group-[.is-user]:px-3.5 group-[.is-user]:py-2.5"
    >
      <p class="exchange__text">{{ exchange.prompt }}</p>
      <p class="exchange__note">{{ exchange.parameters.join(' · ') }}</p>
    </MessageContent>
  </Message>
  <Message from="assistant" class="max-w-full">
    <MessageContent class="w-full max-w-[76ch] gap-2.5">
      <PlaygroundVideoWaiting
        v-if="exchange.state.kind === 'submitting'"
        label="Submitting"
        :submitted-at="exchange.submittedAt"
        :progress="null"
      />
      <PlaygroundVideoWaiting
        v-else-if="exchange.state.kind === 'running'"
        :label="RUNNING_STATUS_LABELS[exchange.state.status]"
        :submitted-at="exchange.submittedAt"
        :progress="exchange.state.progress"
      />
      <p v-else-if="exchange.state.kind === 'stopped'" class="exchange__note">
        Stopped. If the gateway already accepted the Video Job, it still runs and is charged.
      </p>
      <p v-else-if="exchange.state.kind === 'expired'" class="exchange__error" role="alert">
        <span class="status-badge status-badge--bad">expired</span>
        The Provider no longer knows this Video Job, so its video can't be fetched.
      </p>
      <p v-else-if="exchange.state.kind === 'failed'" class="exchange__error" role="alert">
        <span class="status-badge status-badge--bad">{{
          exchange.state.error.code ?? 'Error'
        }}</span>
        {{ exchange.state.error.message }}
      </p>
      <div v-else class="video-result">
        <video
          controls
          preload="metadata"
          :src="videoContentUrl(exchange.state.videoId)"
          :aria-label="`Video for: ${exchange.prompt}`"
        />
        <a
          class="button button--quiet"
          :href="videoContentUrl(exchange.state.videoId)"
          :download="videoFileName(exchange.id)"
        >
          <Download :size="14" /> Download
        </a>
      </div>
      <PlaygroundReceipt
        v-if="'summary' in exchange.state && exchange.state.summary"
        :summary="exchange.state.summary"
        :routes="exchange.routes"
        :direct="exchange.isDirect"
        :provider-names="providerNamesBySlug"
        :provider-logos="providerLogosBySlug"
      />
    </MessageContent>
  </Message>
</template>
