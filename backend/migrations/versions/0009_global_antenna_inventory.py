"""Add the global antenna inventory and reset snapshot configurations.

Revision ID: 0009_global_antenna_inventory
Revises: 0008_performance_indexes
Create Date: 2026-09-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_global_antenna_inventory"
down_revision: str | Sequence[str] | None = "0008_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "antennas",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("height_m", sa.Float(), nullable=False),
        sa.Column("azimuth_deg", sa.Float(), nullable=False),
        sa.Column("tilt_min_deg", sa.Float(), nullable=False),
        sa.Column("tilt_current_deg", sa.Float(), nullable=False),
        sa.Column("tilt_max_deg", sa.Float(), nullable=False),
        sa.Column("tx_power_min_dbm", sa.Float(), nullable=False),
        sa.Column("tx_power_current_dbm", sa.Float(), nullable=False),
        sa.Column("tx_power_max_dbm", sa.Float(), nullable=False),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_antennas_status"),
        sa.ForeignKeyConstraint(["created_by"], ["app_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["app_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_antennas_status_code", "antennas", ["status", "code"])
    op.create_index("uq_antennas_code_lower", "antennas", [sa.text("lower(code)")], unique=True)
    op.create_table(
        "network_configuration_antennas",
        sa.Column("configuration_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("antenna_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["configuration_id"], ["network_configurations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["antenna_id"], ["antennas.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("configuration_id", "antenna_id"),
        sa.UniqueConstraint("configuration_id", "antenna_id", name="uq_network_configuration_antennas_pair"),
    )
    # Snapshot configurations cannot be converted without a trusted inventory.
    op.execute("DELETE FROM impact_studies")
    op.execute("DELETE FROM network_configurations")


def downgrade() -> None:
    op.drop_table("network_configuration_antennas")
    op.drop_index("uq_antennas_code_lower", table_name="antennas")
    op.drop_index("ix_antennas_status_code", table_name="antennas")
    op.drop_table("antennas")
