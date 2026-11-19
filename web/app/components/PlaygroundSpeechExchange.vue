<script setup lang="ts">
import { Download } from "@lucide/vue";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  AUDIO_FORMAT_LABELS,
  isPlayableFormat,
  type SpeechExchange,
  speechFileName,
} from "~/lib/playgroundSpeech";

/** One speech request in the tab's history: the text and voice, then the audio or error. */
defineProps<{ exchange: SpeechExchange }>();

const { providerNamesBySlug, providerLogosBySlug } = useInjectedPlaygroundTarget();
</script>

<template>
  <Message from="user" class="max-w-[min(560px,88%)] max-[760px]:max-w-[92%]">
    <MessageContent
      class="group-[.is-user]:rounded-[14px_14px_4px_14px] group-[.is-user]:bg-[var(--chip)] group-[.is-user]:px-3.5 group-[.is-user]:py-2.5"
    >
      <p class="exchange__text">{{ exchange.text }}</p>
      <p class="exchange__note">
        Voice {{ exchange.voice }} · {{ AUDIO_FORMAT_LABELS[exchange.format] }}
      </p>
    </MessageContent>
  </Message>
  <Message from="assistant" class="max-w-full">
    <MessageContent class="w-full max-w-[76ch] gap-2.5">
      <Shimmer v-if="exchange.state.kind === 'pending'" class="exchange__waiting" :duration="1.6"
        >Synthesizing…</Shimmer
      >
      <p v-else-if="exchange.state.kind === 'stopped'" class="exchange__note">Stopped.</p>
      <p v-else-if="exchange.state.kind === 'failed'" class="exchange__error" role="alert">
        <span class="status-badge status-badge--bad">{{
          exchange.state.error.code ?? "Error"
        }}</span>
        {{ exchange.state.error.message }}
      </p>
      <template v-else>
        <div class="speech-result">
          <audio
            v-if="isPlayableFormat(exchange.format)"
            controls
            :src="exchange.state.audioUrl"
            :aria-label="`Speech for: ${exchange.text}`"
          />
          <p v-else class="exchange__note">Browsers can't play raw PCM; download it instead.</p>
          <a
            class="button button--quiet"
            :href="exchange.state.audioUrl"
            :download="speechFileName(exchange.id, exchange.format)"
          >
            <Download :size="14" /> Download
          </a>
        </div>
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
