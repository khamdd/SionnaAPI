# Simulation job reliability

Database-backed simulations run in the dedicated `simulation-worker` Docker
service. FastAPI only validates requests, stores queued jobs, and serves their
status/results. Host development keeps the in-process worker enabled by default;
set `SIMULATION_WORKER_ENABLED=false` when running a separate worker.

## Execution behavior

- A worker claims one eligible job with PostgreSQL row locking and records its
  unique worker ID, heartbeat, and lease expiration.
- A heartbeat extends the lease during a long simulation. Another worker cannot
  claim the same active lease.
- An expired lease is recovered automatically. The job is queued again when
  attempts remain, or failed with `failure_type=worker_lost` after its final
  attempt.
- Transient database, filesystem, connection, and timeout errors retry with
  bounded exponential backoff. Validation/input errors fail on the first attempt.
- The dedicated Linux worker enforces the configured per-attempt timeout.
- Result artifacts use the job ID as their stable path, and only the worker that
  owns the current lease can finalize database state.

Queue responses expose `attempts`, `max_attempts`, `next_attempt_at`, `worker_id`,
`heartbeat_at`, `lease_expires_at`, `cancel_requested`, `failure_type`, and
`priority`.

## Cancellation

`POST /api/v1/simulation-jobs/{job_id}/cancel` immediately cancels a queued job or
sets `cancel_requested` on a running job. A running worker checks cancellation
before and after normal simulations and between Network Coverage optimization
candidates. Impact Study cancellation uses the same behavior for all child jobs.

## Configuration

| Environment variable | Default | Meaning |
| --- | ---: | --- |
| `SIMULATION_WORKER_POLL_SECONDS` | `1` | Delay while the queue is empty |
| `SIMULATION_JOB_HEARTBEAT_SECONDS` | `20` | Heartbeat interval |
| `SIMULATION_JOB_LEASE_SECONDS` | `90` | Time before a silent worker is considered lost |
| `SIMULATION_JOB_TIMEOUT_SECONDS` | `3600` | Maximum seconds per attempt |
| `SIMULATION_JOB_MAX_ATTEMPTS` | `3` | Maximum total attempts |
| `SIMULATION_JOB_RETRY_BASE_SECONDS` | `5` | First retry delay |
| `SIMULATION_JOB_RETRY_MAX_SECONDS` | `300` | Maximum retry delay |

Keep the heartbeat interval lower than the lease duration. The configuration
loader also caps the heartbeat interval at half the lease duration.
