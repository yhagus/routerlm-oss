# Writes that count Users take a table lock

Creating the first User and deleting a User both depend on how many Users exist, and two concurrent requests can each see a state the other is about to change: two setups could both find an empty table, and two Users deleting each other at once could leave none.

We decided that `CreateFirstUserHandler` and `DeleteUserHandler` call `lockUsers(tx)` first, which runs `lock table users in share row exclusive mode`. That mode conflicts with itself and with writes but not with reads, so concurrent writers queue up while sign-ins keep reading.
