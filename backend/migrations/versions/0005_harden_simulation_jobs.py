"""Add retry, lease, heartbeat, and cancellation fields to simulation jobs.

Revision ID: 0005_harden_simulation_jobs
Revises: 0004_impact_studies
Create Date: 2026-09-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0005_harden_simulation_jobs"
down_revision: str | Sequence[str] | None = "0004_impact_studies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "simulation_jobs",
        sa.Column("max_attempts", sa.Integer(), server_default="3", nullable=False),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("worker_id", sa.Text(), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column(
            "cancel_requested",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("failure_type", sa.Text(), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_check_constraint(
        "ck_simulation_jobs_max_attempts",
        "simulation_jobs",
        "max_attempts >= 1",
    )
    op.create_index(
        "ix_simulation_jobs_claimable",
        "simulation_jobs",
        ["status", "next_attempt_at", "priority"],
    )
    op.create_index(
        "ix_simulation_jobs_expired_lease",
        "simulation_jobs",
        ["status", "lease_expires_at"],
    )
    op.execute(
        "UPDATE simulation_jobs "
        "SET status = 'queued', started_at = NULL, next_attempt_at = now(), "
        "error_message = 'Requeued while installing leased worker execution.' "
        "WHERE status = 'running'"
    )


def downgrade() -> None:
    op.drop_index("ix_simulation_jobs_expired_lease", table_name="simulation_jobs")
    op.drop_index("ix_simulation_jobs_claimable", table_name="simulation_jobs")
    op.drop_constraint(
        "ck_simulation_jobs_max_attempts",
        "simulation_jobs",
        type_="check",
    )
    op.drop_column("simulation_jobs", "priority")
    op.drop_column("simulation_jobs", "failure_type")
    op.drop_column("simulation_jobs", "cancel_requested")
    op.drop_column("simulation_jobs", "lease_expires_at")
    op.drop_column("simulation_jobs", "heartbeat_at")
    op.drop_column("simulation_jobs", "worker_id")
    op.drop_column("simulation_jobs", "next_attempt_at")
    op.drop_column("simulation_jobs", "max_attempts")
