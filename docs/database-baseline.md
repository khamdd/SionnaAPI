# Database Baseline Before Alembic

Captured on 2026-09-08 before introducing database migrations.

## Runtime database

- Database: `sionna_simulation`
- PostgreSQL: 16.4
- PostGIS: 3.4.3
- Database size at capture: 20 MB
- Schema-management mechanism: `Base.metadata.create_all()` during FastAPI startup
- Alembic revision table: not present

PostGIS-related extensions present at capture:

- `postgis`
- `postgis_topology`
- `postgis_tiger_geocoder`
- `fuzzystrmatch`

## Application tables

| Table | Rows | Purpose |
|---|---:|---|
| `app_users` | 3 | User identities, password hashes, and login state |
| `scenes` | 10 | Database references and metadata for imported scenes |
| `simulation_runs` | 9 | Saved simulation-history records and result summaries |
| `simulation_run_antennas` | 22 | Antenna snapshots belonging to saved simulations |
| `simulation_artifacts` | 0 | File metadata belonging to saved simulations |
| `simulation_jobs` | 19 | Queued, running, and completed simulation jobs |

PostGIS-owned tables and schemas are not application tables and should not be
recreated or removed by application migrations.

## Relationships and constraints

- `app_users.username` is unique.
- `simulation_runs.scene_id` references `scenes.id` with `ON DELETE RESTRICT`.
- `simulation_run_antennas.simulation_run_id` references
  `simulation_runs.id` with `ON DELETE CASCADE`.
- `simulation_artifacts.simulation_run_id` references `simulation_runs.id` with
  `ON DELETE CASCADE`.
- `simulation_jobs.result_run_id` references `simulation_runs.id` with
  `ON DELETE CASCADE`.
- UUID primary keys use the `gen_random_uuid()` server default.
- Creation timestamps use the `now()` server default.
- Simulation requests and results use PostgreSQL `JSONB`.
- Scene and simulation coordinates use PostGIS `geometry` and `geography`.

The initial Alembic revision must reproduce these existing types, defaults,
nullability rules, keys, and deletion behaviors without adding later roadmap
models.

## Verified safety backup

- File: `static/database-backups/pre-alembic-20260908-100140.dump`
- Format: PostgreSQL custom archive (`pg_dump --format=custom`)
- Size: 151,161 bytes
- SHA-256: `39BC35B9D97B424B0FF3279283015331C8D7731D527B2FC73EF6A36A08F8BD32`
- Ownership and privilege statements: omitted for portable restoration

The archive manifest was readable with `pg_restore --list`. It was restored into
an isolated temporary database, and all six application-table row counts matched
the source database. The temporary verification database was then removed. No
test rows were added to the live database.

The backup is under the ignored `static/` directory and must not be committed.
Copy it to approved durable backup storage before a production migration.

## Legacy database adoption rule

Do not run `alembic stamp` merely because these table names exist. Before stamping
the future baseline revision, compare the target database with this inventory and
the reviewed initial migration. Stamping records a revision but does not validate
or repair the schema.

## Baseline migration verification

Alembic revision `0001_initial_schema` now represents this baseline. It was
tested on 2026-09-08 using an isolated database created from PostgreSQL
`template0`:

- `alembic upgrade head` created PostGIS and all six application tables.
- Column types, nullability, defaults, primary keys, unique constraints, and
  foreign keys matched the live schema.
- `alembic check` reported no pending schema operations.
- `alembic downgrade base` removed all six application tables but retained the
  PostGIS extension.
- A second `alembic upgrade head` and `alembic check` succeeded.

The temporary database was removed after verification. The live database
remains unstamped and its application-table row counts are unchanged. Adopting
that database into Alembic is a separate follow-up step.
