"""Add durable impact studies and linked simulation jobs.

Revision ID: 0004_impact_studies
Revises: 0003_simulation_profiles
Create Date: 2026-09-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_impact_studies"
down_revision: str | Sequence[str] | None = "0003_simulation_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "impact_studies",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("scene_id", sa.Text(), nullable=False),
        sa.Column(
            "baseline_configuration_id",
            postgresql.UUID(as_uuid=False),
            nullable=False,
        ),
        sa.Column(
            "candidate_configuration_id",
            postgresql.UUID(as_uuid=False),
            nullable=False,
        ),
        sa.Column("policy_version", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("difference_json", postgresql.JSONB(), nullable=False),
        sa.Column("execution_plan_json", postgresql.JSONB(), nullable=False),
        sa.Column("summary_json", postgresql.JSONB(), nullable=True),
        sa.Column("report_url", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ("
            "'planned', 'queued', 'running', 'aggregating', 'completed', "
            "'completed_with_failures', 'cancelled', 'failed'"
            ")",
            name="ck_impact_studies_status",
        ),
        sa.ForeignKeyConstraint(
            ["baseline_configuration_id"],
            ["network_configurations.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["candidate_configuration_id"],
            ["network_configurations.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["app_users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["scene_id"],
            ["scenes.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_impact_studies_creator_created",
        "impact_studies",
        ["created_by", "created_at"],
    )
    op.create_index(
        "ix_impact_studies_scene_status",
        "impact_studies",
        ["scene_id", "status"],
    )

    op.add_column(
        "simulation_jobs",
        sa.Column("impact_study_id", postgresql.UUID(as_uuid=False), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column(
            "simulation_profile_id",
            postgresql.UUID(as_uuid=False),
            nullable=True,
        ),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("scenario_role", sa.Text(), nullable=True),
    )
    op.add_column(
        "simulation_jobs",
        sa.Column("input_signature", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_simulation_jobs_impact_study_id",
        "simulation_jobs",
        "impact_studies",
        ["impact_study_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_simulation_jobs_simulation_profile_id",
        "simulation_jobs",
        "simulation_profiles",
        ["simulation_profile_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_simulation_jobs_scenario_role",
        "simulation_jobs",
        "scenario_role IS NULL OR scenario_role IN ("
        "'baseline', 'candidate', 'optimization'"
        ")",
    )
    op.create_unique_constraint(
        "uq_simulation_jobs_impact_profile_role",
        "simulation_jobs",
        ["impact_study_id", "simulation_profile_id", "scenario_role"],
    )
    op.create_index(
        "ix_simulation_jobs_impact_status",
        "simulation_jobs",
        ["impact_study_id", "status"],
    )
    op.create_index(
        "ix_simulation_jobs_input_signature",
        "simulation_jobs",
        ["input_signature"],
    )


def downgrade() -> None:
    op.drop_index("ix_simulation_jobs_input_signature", table_name="simulation_jobs")
    op.drop_index("ix_simulation_jobs_impact_status", table_name="simulation_jobs")
    op.drop_constraint(
        "uq_simulation_jobs_impact_profile_role",
        "simulation_jobs",
        type_="unique",
    )
    op.drop_constraint(
        "ck_simulation_jobs_scenario_role",
        "simulation_jobs",
        type_="check",
    )
    op.drop_constraint(
        "fk_simulation_jobs_simulation_profile_id",
        "simulation_jobs",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_simulation_jobs_impact_study_id",
        "simulation_jobs",
        type_="foreignkey",
    )
    op.drop_column("simulation_jobs", "input_signature")
    op.drop_column("simulation_jobs", "scenario_role")
    op.drop_column("simulation_jobs", "simulation_profile_id")
    op.drop_column("simulation_jobs", "impact_study_id")

    op.drop_index("ix_impact_studies_scene_status", table_name="impact_studies")
    op.drop_index("ix_impact_studies_creator_created", table_name="impact_studies")
    op.drop_table("impact_studies")
