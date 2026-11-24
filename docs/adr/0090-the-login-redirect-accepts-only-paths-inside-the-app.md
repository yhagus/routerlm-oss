# The login redirect accepts only paths inside the app

`pages/login.vue` sends the User back to `?redirect=` after sign-in. A crafted link could otherwise send the User to another site.

We decided that `redirectTarget()` accepts only a path that starts inside this app, and rejects backslash forms: browsers read a backslash as a slash, so `/\host` would act like `//host`. Anything else falls back to the default page.
