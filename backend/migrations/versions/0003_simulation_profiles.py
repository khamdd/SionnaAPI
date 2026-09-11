"""Add saved simulation profiles.

Revision ID: 0003_simulation_profiles
Revises: 0002_network_configurations
Create Date: 2026-09-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_simulation_profiles"
down_revision: str | Sequence[str] | None = "0002_network_configurations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "simulation_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("scene_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("simulation_type", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("request_template_json", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "simulation_type IN ("
            "'network_coverage', 'coverage_map', 'rsrp_simulation', "
            "'sinr', 'throughput_comparison'"
            ")",
            name="ck_simulation_profiles_type",
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
        sa.UniqueConstraint(
            "scene_id",
            "created_by",
            "name",
            name="uq_simulation_profiles_owner_scene_name",
        ),
    )
    op.create_index(
        "ix_simulation_profiles_scene_type_enabled",
        "simulation_profiles",
        ["scene_id", "simulation_type", "enabled"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_simulation_profiles_scene_type_enabled",
        table_name="simulation_profiles",
    )
    op.drop_table("simulation_profiles")
