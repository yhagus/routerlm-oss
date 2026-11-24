<script setup lang="ts">
import { Globe } from "@lucide/vue";
import { useIntervalFn } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  browserTimeZone,
  calendarDay,
  clockTime,
  utcOffsetLabel,
  utcOffsetMinutes,
} from "~/lib/timeZones";

const { data: server, status, error } = useDashboardApi<{ timeZone: string }>("/time-zone");

const browser = browserTimeZone();
const now = ref(new Date());
const isOpen = ref(false);
const { pause, resume } = useIntervalFn(() => (now.value = new Date()), 1000, {
  immediate: false,
});
watch(isOpen, (open) => {
  if (open) {
    now.value = new Date();
    resume();
  } else {
    pause();
  }
});

const browserOffset = computed(() => utcOffsetLabel(browser, now.value));
const serverOffset = computed(() =>
  server.value ? utcOffsetLabel(server.value.timeZone, now.value) : null,
);
const offsetGap = computed(() =>
  server.value
    ? utcOffsetMinutes(browser, now.value) - utcOffsetMinutes(server.value.timeZone, now.value)
    : 0,
);
const hasGap = computed(() => offsetGap.value !== 0);

function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
const gapText = computed(() => {
  const amount = durationText(Math.abs(offsetGap.value));
  return offsetGap.value > 0
    ? `Your browser is ${amount} ahead of the server.`
    : `Your browser is ${amount} behind the server.`;
});

const showDates = computed(
  () =>
    server.value !== undefined &&
    calendarDay(browser, now.value) !== calendarDay(server.value.timeZone, now.value),
);

const buttonName = computed(() => {
  const base = `Time zones. Browser: ${browser}, ${browserOffset.value}.`;
  return server.value ? `${base} Server: ${server.value.timeZone}, ${serverOffset.value}.` : base;
});
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <button class="topbar__zone" type="button" :aria-label="buttonName" :title="buttonName">
        <Globe :size="15" :stroke-width="1.8" aria-hidden="true" />
        <span class="topbar__zone-text tabular" aria-hidden="true">
          {{ browserOffset }}
          <span v-if="hasGap" class="topbar__zone-server">· server {{ serverOffset }}</span>
        </span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      :collision-padding="12"
      class="w-[min(320px,calc(100vw-32px))] rounded-2xl border-(--line) bg-(--panel) p-0 shadow-[0_12px_32px_var(--shadow-pop-color)]"
    >
      <div class="zone-menu" role="group" aria-label="Time zones">
        <h2>Time zones</h2>
        <dl class="zone-menu__rows">
          <div class="zone-menu__row">
            <dt>Browser</dt>
            <dd class="zone-menu__name">{{ browser }}</dd>
            <dd class="zone-menu__time tabular">
              <span v-if="showDates" class="zone-menu__date">{{ calendarDay(browser, now) }}</span>
              {{ clockTime(browser, now) }} <span>{{ browserOffset }}</span>
            </dd>
          </div>
          <div class="zone-menu__row">
            <dt>Server</dt>
            <template v-if="server">
              <dd class="zone-menu__name">{{ server.timeZone }}</dd>
              <dd class="zone-menu__time tabular">
                <span v-if="showDates" class="zone-menu__date">
                  {{ calendarDay(server.timeZone, now) }}
                </span>
                {{ clockTime(server.timeZone, now) }} <span>{{ serverOffset }}</span>
              </dd>
            </template>
            <dd v-else class="zone-menu__name zone-menu__name--muted">
              {{ status === "pending" ? "Checking…" : error ? "Couldn't read it" : "—" }}
            </dd>
          </div>
        </dl>
        <p v-if="hasGap" class="zone-menu__gap">{{ gapText }}</p>
        <ul class="zone-menu__notes">
          <li>Tables, tooltips and chart ticks show times in your browser's zone.</li>
          <li>The Overview groups its buckets on UTC boundaries, and its daily labels are UTC.</li>
          <li>The server writes its log lines in its own zone.</li>
        </ul>
      </div>
    </PopoverContent>
  </Popover>
</template>
