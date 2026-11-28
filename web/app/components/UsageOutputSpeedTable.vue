<script setup lang="ts">
import { formatOutputSpeed, type UpstreamOutputSpeed } from '~/lib/usage';

defineProps<{
  speeds: UpstreamOutputSpeed[];
}>();
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Upstream Model</th>
          <th>Provider Account</th>
          <th>Median</th>
          <th>p5</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="speed in speeds" :key="`${speed.upstreamModelId}:${speed.providerAccountId}`">
          <td>{{ speed.upstreamModelName ?? speed.upstreamModelId }}</td>
          <td>{{ speed.providerAccountName ?? 'Deleted Provider Account' }}</td>
          <td class="tabular">{{ formatOutputSpeed(speed.outputSpeedP50) }}</td>
          <td class="tabular">{{ formatOutputSpeed(speed.outputSpeedP5) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
