"""Add immutable network configuration versions.

Revision ID: 0002_network_configurations
Revises: 0001_initial_schema
Create Date: 2026-09-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_network_configurations"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "network_configurations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("scene_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "parent_configuration_id",
            postgresql.UUID(as_uuid=False),
            nullable=True,
        ),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_reference", sa.Text(), nullable=True),
        sa.Column("antennas_json", postgresql.JSONB(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "source IN ('manual', 'file', 'external_api')",
            name="ck_network_configurations_source",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'superseded')",
            name="ck_network_configurations_status",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["app_users.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["parent_configuration_id"],
            ["network_configurations.id"],
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
            "version",
            name="uq_network_configurations_scene_version",
        ),
    )
    op.create_index(
        "ix_network_configurations_content_hash",
        "network_configurations",
        ["content_hash"],
    )
    op.create_index(
        "ix_network_configurations_scene_status",
        "network_configurations",
        ["scene_id", "status"],
    )
    op.create_index(
        "uq_network_configurations_one_published_per_scene",
        "network_configurations",
        ["scene_id"],
        unique=True,
        postgresql_where=sa.text("status = 'published'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_network_configurations_one_published_per_scene",
        table_name="network_configurations",
    )
    op.drop_index(
        "ix_network_configurations_scene_status",
        table_name="network_configurations",
    )
    op.drop_index(
        "ix_network_configurations_content_hash",
        table_name="network_configurations",
    )
    op.drop_table("network_configurations")
