<script setup lang="ts">
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { TranscriptionExchange } from '~/lib/playgroundTranscription';

defineProps<{ exchange: TranscriptionExchange }>();

const { providerNamesBySlug, providerLogosBySlug } = useInjectedPlaygroundTarget();
</script>

<template>
  <Message from="user" class="max-w-[min(560px,88%)] max-[760px]:max-w-[92%]">
    <MessageContent
      class="group-[.is-user]:rounded-[14px_14px_4px_14px] group-[.is-user]:bg-[var(--chip)] group-[.is-user]:px-3.5 group-[.is-user]:py-2.5"
    >
      <p class="exchange__text">{{ exchange.fileName }}</p>
      <p class="exchange__note">
        {{ exchange.language === '' ? 'Language detected' : `Language ${exchange.language}` }}
      </p>
    </MessageContent>
  </Message>
  <Message from="assistant" class="max-w-full">
    <MessageContent class="w-full max-w-[76ch] gap-2.5">
      <Shimmer v-if="exchange.state.kind === 'pending'" class="exchange__waiting" :duration="1.6"
        >Transcribing…</Shimmer
      >
      <p v-else-if="exchange.state.kind === 'stopped'" class="exchange__note">Stopped.</p>
      <p v-else-if="exchange.state.kind === 'failed'" class="exchange__error" role="alert">
        <span class="status-badge status-badge--bad">{{
          exchange.state.error.code ?? 'Error'
        }}</span>
        {{ exchange.state.error.message }}
      </p>
      <template v-else>
        <p v-if="exchange.state.text === ''" class="exchange__note">No speech was heard.</p>
        <p v-else class="exchange__text">{{ exchange.state.text }}</p>
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
