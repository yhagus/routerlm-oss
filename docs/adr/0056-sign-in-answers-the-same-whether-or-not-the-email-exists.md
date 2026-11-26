---
status: accepted
areas: [auth, users]
---
# Sign-in answers the same whether or not the email exists

The dashboard sign-in must not tell a caller which emails belong to a User.

We decided that an unknown email and a wrong password get one message (`INVALID_CREDENTIALS` in `src/auth/auth.controller.ts`), and that `FindUserByCredentialsQuery` takes the same time whether or not the email exists, so neither the text nor the timing reveals which half was wrong. Do not give the two cases distinct errors or skip the password hash for an unknown email.
