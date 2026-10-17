<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Badge from "@/components/ui/badge.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Select from "@/components/ui/select.vue";
import Toggle from "@/components/ui/toggle.vue";

// Plan access form. Pick a plan, choose whether it is restricted, then toggle
// the models it may serve. A plan absent from the map is unrestricted; a plan
// present is an allowlist (empty = serves nothing) — mirrors
// isCodexModelAllowedForPlan.
//
// Modal-friendly: plain flowing form, no internal scroll or footer. The Modal
// body scrolls; the parent renders Save/Discard in the Modal footer slot and
// owns the draft through v-model.
const props = defineProps<{
  modelValue: Record<string, string[]>;
  plans: Array<{ plan: string; count: number }>;
  models: string[];
  saving?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [map: Record<string, string[]>] }>();

const selected = ref("");
const search = ref("");
const newPlan = ref("");
const newModel = ref("");
const extraModels = ref<string[]>([]);

const draft = computed(() => props.modelValue);
const set = (next: Record<string, string[]>) => emit("update:modelValue", next);

const columns = computed(() => {
  const counts = new Map(props.plans.map((p) => [p.plan, p.count]));
  return [...new Set([...counts.keys(), ...Object.keys(draft.value)])]
    .sort()
    .map((plan) => ({ plan, count: counts.get(plan) ?? 0 }));
});
watch(
  columns,
  (cols) => {
    if (!cols.some((c) => c.plan === selected.value))
      selected.value = cols[0]?.plan ?? "";
  },
  { immediate: true },
);

const allModels = computed(() =>
  [
    ...new Set([
      ...props.models,
      ...extraModels.value,
      ...Object.values(draft.value).flat(),
    ]),
  ].sort(),
);

const restricted = (plan: string) => plan in draft.value;
const allowed = (plan: string, model: string) =>
  !restricted(plan) || draft.value[plan].includes(model);

const planOptions = computed(() =>
  columns.value.map((c) => ({
    value: c.plan,
    label: `${c.plan} · ${c.count} account${c.count === 1 ? "" : "s"}${restricted(c.plan) ? "" : " · all models"}`,
  })),
);
const sel = computed(() => columns.value.find((c) => c.plan === selected.value));
const isRestricted = computed(() => restricted(selected.value));
const servedCount = computed(() => draft.value[selected.value]?.length ?? 0);

// "cx/gpt-5.6-sol-review" -> "gpt-5.6"; unversioned ids group by first segment.
function family(id: string): string {
  const bare = id.slice(id.lastIndexOf("/") + 1);
  return bare.match(/^(.*?\d+(?:\.\d+)?)(?:-|$)/)?.[1] ?? bare.split("-")[0];
}
const groups = computed(() => {
  const q = search.value.trim().toLowerCase();
  const map = new Map<string, string[]>();
  for (const m of allModels.value) {
    if (q && !m.toLowerCase().includes(q)) continue;
    const f = family(m);
    map.set(f, [...(map.get(f) || []), m]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
    .map(([name, items]) => ({ name, items }));
});
const visible = computed(() => groups.value.flatMap((g) => g.items));

// Models no plan serves. Only meaningful when every plan is restricted.
const unserved = computed(() =>
  columns.value.length && columns.value.every((c) => restricted(c.plan))
    ? allModels.value.filter((m) => columns.value.every((c) => !allowed(c.plan, m)))
    : [],
);

function setRestricted(on: boolean) {
  const next = { ...draft.value };
  if (on) next[selected.value] = [...allModels.value];
  else delete next[selected.value];
  set(next);
}
function setMany(items: string[], on: boolean) {
  if (!isRestricted.value) return;
  const s = new Set(draft.value[selected.value]);
  for (const m of items) on ? s.add(m) : s.delete(m);
  set({ ...draft.value, [selected.value]: [...s] });
}
const groupOn = (items: string[]) =>
  items.every((m) => allowed(selected.value, m));
function addPlan() {
  const plan = newPlan.value.trim().toLowerCase();
  newPlan.value = "";
  if (!plan) return;
  if (!restricted(plan)) set({ ...draft.value, [plan]: [...allModels.value] });
  selected.value = plan;
}
function addModel() {
  const model = newModel.value.trim();
  newModel.value = "";
  if (!model) return;
  if (!allModels.value.includes(model)) extraModels.value.push(model);
  setMany([model], true);
}
const copyOptions = computed(() =>
  Object.keys(draft.value)
    .filter((p) => p !== selected.value)
    .map((p) => ({ value: p, label: p })),
);
function copyFrom(from: string | number) {
  if (from && String(from) in draft.value)
    set({ ...draft.value, [selected.value]: [...draft.value[String(from)]] });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="space-y-2">
      <label class="text-sm font-medium" for="plan-access-plan">Plan</label>
      <div class="flex gap-2">
        <Select
          id="plan-access-plan"
          v-model="selected"
          :options="planOptions"
          placeholder="No plans detected"
          class="flex-1"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        Plans come from your connected Codex accounts. Add one manually below.
      </p>
    </div>

    <div class="space-y-2">
      <label class="text-sm font-medium" for="plan-access-new">Add plan</label>
      <div class="flex gap-2">
        <Input
          id="plan-access-new"
          v-model="newPlan"
          placeholder="e.g. team"
          @keydown.enter.prevent="addPlan"
        />
        <Button variant="secondary" :disabled="!newPlan.trim()" @click="addPlan">
          Add
        </Button>
      </div>
    </div>

    <div
      v-if="unserved.length"
      role="alert"
      class="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning"
    >
      {{ unserved.length }} model{{ unserved.length === 1 ? "" : "s" }} not served
      by any plan: {{ unserved.slice(0, 4).join(", ")
      }}{{ unserved.length > 4 ? "…" : "" }}
    </div>

    <template v-if="sel">
      <div class="rounded-lg bg-sidebar/50 p-3">
        <Toggle
          :checked="isRestricted"
          :disabled="saving"
          :title="`Restrict models for ${sel.plan}`"
          label="Restrict models"
          :description="
            isRestricted
              ? `${sel.plan} serves only the ${servedCount} model${servedCount === 1 ? '' : 's'} enabled below.`
              : `${sel.plan} serves every model. Turn on to choose which ones.`
          "
          @change="setRestricted"
        />
      </div>

      <div
        v-if="isRestricted"
        class="rounded-lg border border-accent/20 bg-sidebar/50 p-4"
      >
        <div class="mb-3 flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Allowed models</h3>
          <Badge :variant="servedCount === 0 ? 'warning' : 'default'">
            {{ servedCount }}/{{ allModels.length }}
          </Badge>
        </div>

        <div class="flex flex-col gap-3">
          <Input v-model="search" type="search" placeholder="Filter models" />

          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" @click="setMany(visible, true)">
              Enable all
            </Button>
            <Button size="sm" variant="secondary" @click="setMany(visible, false)">
              Disable all
            </Button>
            <Select
              v-if="copyOptions.length"
              :model-value="''"
              :options="copyOptions"
              placeholder="Copy from plan…"
              class="h-8 w-44 text-xs"
              @update:model-value="copyFrom"
            />
          </div>

          <p v-if="servedCount === 0" class="text-xs text-warning">
            Nothing enabled — this plan serves no models.
          </p>

          <div v-for="g in groups" :key="g.name" class="flex flex-col">
            <div class="flex items-center justify-between px-3 pb-1 pt-2">
              <span class="text-xs font-semibold text-muted-foreground">{{
                g.name
              }}</span>
              <Toggle
                size="sm"
                :checked="groupOn(g.items)"
                :disabled="saving"
                :title="`Toggle all ${g.name} models`"
                @change="setMany(g.items, $event)"
              />
            </div>
            <div
              v-for="m in g.items"
              :key="m"
              class="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            >
              <span class="truncate font-mono text-sm" :title="m">{{ m }}</span>
              <Toggle
                size="sm"
                :checked="allowed(sel.plan, m)"
                :disabled="saving"
                :title="`${sel.plan} can serve ${m}`"
                @change="setMany([m], $event)"
              />
            </div>
          </div>

          <p v-if="!groups.length" class="py-2 text-center text-xs text-muted-foreground">
            No models match “{{ search }}”.
          </p>

          <div class="space-y-2">
            <label class="text-sm font-medium" for="plan-access-model"
              >Custom model</label
            >
            <div class="flex gap-2">
              <Input
                id="plan-access-model"
                v-model="newModel"
                placeholder="Model id"
                @keydown.enter.prevent="addModel"
              />
              <Button variant="secondary" :disabled="!newModel.trim()" @click="addModel">
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div
      v-else
      class="rounded-lg bg-sidebar/50 p-3 text-sm text-muted-foreground"
    >
      No plans yet. Connect a Codex account or add a plan above.
    </div>
  </div>
</template>
