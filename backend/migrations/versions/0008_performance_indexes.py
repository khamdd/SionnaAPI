"""Add performance indexes for simulation history, queue, and cascade deletes.

Revision ID: 0008_performance_indexes
Revises: 0007_vietnam_admin_units
Create Date: 2026-09-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008_performance_indexes"
down_revision: str | Sequence[str] | None = "0007_vietnam_admin_units"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_simulation_runs_scene_created",
        "simulation_runs",
        ["scene_id", "created_at"],
    )
    op.create_index(
        "ix_simulation_run_antennas_run",
        "simulation_run_antennas",
        ["simulation_run_id"],
    )
    op.create_index(
        "ix_simulation_artifacts_run",
        "simulation_artifacts",
        ["simulation_run_id"],
    )
    op.create_index(
        "ix_simulation_jobs_queued_at",
        "simulation_jobs",
        ["queued_at"],
    )
    op.create_index(
        "ix_simulation_jobs_result_run",
        "simulation_jobs",
        ["result_run_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_simulation_jobs_result_run", table_name="simulation_jobs")
    op.drop_index("ix_simulation_jobs_queued_at", table_name="simulation_jobs")
    op.drop_index("ix_simulation_artifacts_run", table_name="simulation_artifacts")
    op.drop_index("ix_simulation_run_antennas_run", table_name="simulation_run_antennas")
    op.drop_index("ix_simulation_runs_scene_created", table_name="simulation_runs")
