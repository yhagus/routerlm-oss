# A video id is an encrypted handle to the upstream task, not a stored job

Video generation is asynchronous: a client submits, polls `GET /v1/videos/{id}`, then downloads the content. The poll must reach the same Provider Account and upstream task. We decided that the id the gateway returns is the encrypted Provider Account, Upstream Model and upstream task id, so any process can answer a poll and the gateway keeps no job state (ADR 0002).

## Considered options

- A job table keyed by a gateway id: holds no content, so ADR 0004 allows it, but it adds a migration, a cleanup job and state that drifts from the Provider's.
- Redis with a TTL: the same state, lost on a flush.

## Consequences

- Fallback applies only when submitting. Once a Provider accepts the job, a poll never moves it to another Provider Account.
- A job lives as long as the Provider keeps the task (24 hours at Alibaba). After that a poll gets the expired status, never a retry.
- Deleting or disabling the Provider Account fails its pending polls.
- Rotating the encryption key invalidates every outstanding video id.
- The gateway never learns when a job finishes unless the client polls, so the Usage Log is written at submit and costs the requested duration. A job that later fails still shows that cost, and a duration the Provider picks itself (wan3.0's `duration: -1`) is rejected with a 400.
