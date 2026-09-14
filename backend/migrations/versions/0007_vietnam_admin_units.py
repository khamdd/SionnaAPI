"""Add Vietnam province/ward reference tables for ward-based scene picking.

Revision ID: 0007_vietnam_admin_units
Revises: 0006_notifications
Create Date: 2026-09-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_vietnam_admin_units"
down_revision: str | Sequence[str] | None = "0006_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


class Geometry(sa.types.UserDefinedType):
    """Stable migration-local representation of the PostGIS geometry type."""

    cache_ok = True

    def get_col_spec(self, **kw):
        return "geometry"


def upgrade() -> None:
    op.create_table(
        "vietnam_provinces",
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_en", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=True),
        sa.Column("unit_type", sa.Text(), nullable=True),
        sa.Column("center_lat", sa.Float(), nullable=False),
        sa.Column("center_lng", sa.Float(), nullable=False),
        sa.Column("bbox_south", sa.Float(), nullable=False),
        sa.Column("bbox_north", sa.Float(), nullable=False),
        sa.Column("bbox_west", sa.Float(), nullable=False),
        sa.Column("bbox_east", sa.Float(), nullable=False),
        sa.Column("ward_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("code", name="pk_vietnam_provinces"),
    )

    op.create_table(
        "vietnam_wards",
        sa.Column("ward_code", sa.Text(), nullable=False),
        sa.Column("province_code", sa.Text(), nullable=False),
        sa.Column("ward_name", sa.Text(), nullable=False),
        sa.Column("ward_name_en", sa.Text(), nullable=False),
        sa.Column("ward_full_name", sa.Text(), nullable=True),
        sa.Column("ward_type", sa.Text(), nullable=True),
        sa.Column("search_name", sa.Text(), nullable=False),
        sa.Column("center_lat", sa.Float(), nullable=False),
        sa.Column("center_lng", sa.Float(), nullable=False),
        sa.Column("bbox_south", sa.Float(), nullable=False),
        sa.Column("bbox_north", sa.Float(), nullable=False),
        sa.Column("bbox_west", sa.Float(), nullable=False),
        sa.Column("bbox_east", sa.Float(), nullable=False),
        sa.Column(
            "boundary",
            Geometry(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["province_code"],
            ["vietnam_provinces.code"],
            name="fk_vietnam_wards_province",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("ward_code", name="pk_vietnam_wards"),
    )

    op.create_index(
        "ix_vietnam_wards_province_code",
        "vietnam_wards",
        ["province_code"],
    )
    op.create_index(
        "ix_vietnam_wards_search_name",
        "vietnam_wards",
        ["search_name"],
    )


def downgrade() -> None:
    op.drop_index("ix_vietnam_wards_search_name", table_name="vietnam_wards")
    op.drop_index("ix_vietnam_wards_province_code", table_name="vietnam_wards")
    op.drop_table("vietnam_wards")
    op.drop_table("vietnam_provinces")
