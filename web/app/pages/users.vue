<script setup lang="ts">
import { CloudOff, KeyRound, Trash2, UserRound } from "@lucide/vue";
import { computed, ref } from "vue";
import { apiErrorMessage } from "~/lib/api";
import { MIN_PASSWORD_LENGTH, type User } from "~/lib/users";

useHead({ title: "Users" });

type UserAction = { kind: "reset-password"; user: User } | { kind: "delete"; user: User };

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const currentUser = useCurrentUser();
const {
  data: users,
  error: loadError,
  status: usersStatus,
  refresh,
} = useDashboardApi<User[]>("/users");

/** Only the first load shows placeholders; a refresh keeps the current rows until it lands. */
const isLoadingUsers = computed(() => usersStatus.value === "pending" && !users.value);

const emailById = computed(() => new Map((users.value ?? []).map((user) => [user.id, user.email])));
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const newEmail = ref("");
const newPassword = ref("");
const isCreating = ref(false);
const createError = ref("");

async function createUser(): Promise<void> {
  isCreating.value = true;
  createError.value = "";
  try {
    const created = await $dashboardApi<User>("/users", {
      method: "POST",
      body: { email: newEmail.value, password: newPassword.value },
    });
    newEmail.value = "";
    newPassword.value = "";
    showToast(`Created ${created.email}`);
    await refresh();
  } catch (error) {
    createError.value = apiErrorMessage(error, "Couldn't create the User.");
  } finally {
    isCreating.value = false;
  }
}

const action = ref<UserAction | null>(null);
const resetPasswordValue = ref("");
const isActing = ref(false);
const actionError = ref("");
const isActionOpen = computed({
  get: () => action.value !== null,
  set: (isOpen) => {
    if (!isOpen) action.value = null;
  },
});

function startAction(next: UserAction): void {
  action.value = next;
  resetPasswordValue.value = "";
  actionError.value = "";
}

async function runAction(): Promise<void> {
  const current = action.value;
  if (!current) return;
  isActing.value = true;
  actionError.value = "";
  try {
    if (current.kind === "reset-password") {
      await $dashboardApi(`/users/${current.user.id}/password`, {
        method: "PUT",
        body: { password: resetPasswordValue.value },
      });
      showToast(`Password reset for ${current.user.email}`);
    } else {
      await $dashboardApi(`/users/${current.user.id}`, { method: "DELETE" });
      showToast(`Deleted ${current.user.email}`);
    }
    action.value = null;
    await afterAction(current);
  } catch (error) {
    actionError.value = apiErrorMessage(error, "That didn't work. Try again.");
  } finally {
    isActing.value = false;
  }
}

async function afterAction(done: UserAction): Promise<void> {
  // Deleting yourself ends your own session.
  if (done.kind === "delete" && done.user.id === currentUser.value?.id) {
    currentUser.value = null;
    await navigateTo("/login");
    return;
  }
  await refresh();
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Users"
      description="People who can sign in to the dashboard. Every User can manage the whole gateway."
    />

    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>Add a User</h2>
          <p>Share the email and password with them yourself; RouterLM sends no email.</p>
        </div>
      </div>
      <form class="form form--inline" @submit.prevent="createUser">
        <label class="field"
          ><span class="field__label">Email</span
          ><input v-model="newEmail" class="text-input" type="email" autocomplete="off" required
        /></label>
        <label class="field"
          ><span class="field__label">Password</span
          ><input
            v-model="newPassword"
            class="text-input"
            type="password"
            autocomplete="new-password"
            :minlength="MIN_PASSWORD_LENGTH"
            required
        /></label>
        <button class="button button--primary" type="submit" :disabled="isCreating">
          Add User
        </button>
        <p v-if="createError" class="form__error" role="alert">{{ createError }}</p>
      </form>
    </section>

    <section class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Added</th>
              <th>Added by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>
                <div class="table-entity">
                  <span class="key-icon"><UserRound :size="15" /></span
                  ><strong>{{ user.email }}</strong
                  ><span v-if="user.id === currentUser?.id" class="status-badge status-badge--small"
                    >You</span
                  >
                </div>
              </td>
              <td class="tabular">{{ dateFormat.format(new Date(user.createdAt)) }}</td>
              <td>{{ (user.createdById && emailById.get(user.createdById)) || "—" }}</td>
              <td>
                <div class="row-actions">
                  <button class="row-action" @click="startAction({ kind: 'reset-password', user })">
                    <KeyRound :size="14" /> Reset password
                  </button>
                  <button class="row-action" @click="startAction({ kind: 'delete', user })">
                    <Trash2 :size="14" /> Delete
                  </button>
                </div>
              </td>
            </tr>
            <LoadingRow v-if="isLoadingUsers" :columns="4" />
          </tbody>
        </table>
        <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
          <strong>Couldn't load Users.</strong
          ><span>Check that the backend is running, then reload the page.</span>
        </EmptyState>
      </div>
    </section>

    <AppDialog
      v-if="action?.kind === 'reset-password'"
      v-model:open="isActionOpen"
      title="Reset password"
      :description="`Set a new password for ${action.user.email}. They are signed out everywhere and sign in again with it.`"
    >
      <form class="form" @submit.prevent="runAction">
        <label class="field"
          ><span class="field__label">New password</span
          ><input
            v-model="resetPasswordValue"
            class="text-input"
            type="password"
            autocomplete="new-password"
            :minlength="MIN_PASSWORD_LENGTH"
            required
        /></label>
        <p v-if="actionError" class="form__error" role="alert">{{ actionError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="action = null">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isActing">
            Reset password
          </button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="action?.kind === 'delete'"
      v-model:open="isActionOpen"
      title="Delete User"
      :description="`${action.user.email} loses access to the dashboard at once. This can't be undone.`"
    >
      <p v-if="actionError" class="form__error" role="alert">{{ actionError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="action = null">Cancel</button>
        <button class="button button--danger" type="button" :disabled="isActing" @click="runAction">
          Delete User
        </button>
      </div>
    </AppDialog>
  </div>
</template>
