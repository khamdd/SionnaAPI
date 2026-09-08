"""Create the pre-Alembic application schema.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-08
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


class Geometry(sa.types.UserDefinedType):
    """Stable migration-local representation of the PostGIS geometry type."""

    cache_ok = True

    def get_col_spec(self, **kw):
        return "geometry"


class Geography(sa.types.UserDefinedType):
    """Stable migration-local representation of the PostGIS geography type."""

    cache_ok = True

    def get_col_spec(self, **kw):
        return "geography"


def upgrade() -> None:
    """Create the application schema as it existed before Alembic."""
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "app_users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )

    op.create_table(
        "scenes",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("bounds_geom", Geometry(), nullable=True),
        sa.Column("bounds_json", postgresql.JSONB(), nullable=True),
        sa.Column("metrics_json", postgresql.JSONB(), nullable=True),
        sa.Column("scene_path", sa.Text(), nullable=True),
        sa.Column("preview_url", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "simulation_runs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("simulation_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("transmitter_pattern", sa.Text(), nullable=False),
        sa.Column("max_depth", sa.Integer(), nullable=False),
        sa.Column("samples_per_tx", sa.Integer(), nullable=False),
        sa.Column("cell_size_m", sa.Float(), nullable=False),
        sa.Column("center_position", Geometry(), nullable=False),
        sa.Column("area_geom", Geometry(), nullable=False),
        sa.Column("bandwidth_mhz", sa.Float(), nullable=True),
        sa.Column("mimo_layers", sa.Integer(), nullable=True),
        sa.Column("request_json", postgresql.JSONB(), nullable=False),
        sa.Column("response_json", postgresql.JSONB(), nullable=True),
        sa.Column("coverage_map_image_url", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("scene_id", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["scene_id"],
            ["scenes.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "simulation_run_antennas",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "simulation_run_id",
            postgresql.UUID(as_uuid=False),
            nullable=False,
        ),
        sa.Column("antenna_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("antenna_code", sa.Text(), nullable=False),
        sa.Column("gps_location", Geography(), nullable=True),
        sa.Column("scene_position", Geometry(), nullable=False),
        sa.Column("azimuth_deg", sa.Float(), nullable=False),
        sa.Column("tilt_min_deg", sa.Float(), nullable=False),
        sa.Column("tilt_current_deg", sa.Float(), nullable=False),
        sa.Column("tilt_max_deg", sa.Float(), nullable=False),
        sa.Column("tx_power_min_dbm", sa.Float(), nullable=False),
        sa.Column("tx_power_current_dbm", sa.Float(), nullable=False),
        sa.Column("tx_power_max_dbm", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["simulation_run_id"],
            ["simulation_runs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "simulation_artifacts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "simulation_run_id",
            postgresql.UUID(as_uuid=False),
            nullable=False,
        ),
        sa.Column("artifact_type", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("public_url", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["simulation_run_id"],
            ["simulation_runs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "simulation_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("simulation_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("scene_json", postgresql.JSONB(), nullable=False),
        sa.Column("request_json", postgresql.JSONB(), nullable=False),
        sa.Column("result_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "result_run_id",
            postgresql.UUID(as_uuid=False),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column(
            "queued_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["result_run_id"],
            ["simulation_runs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Remove only application-owned tables; keep the PostGIS extension."""
    op.drop_table("simulation_jobs")
    op.drop_table("simulation_artifacts")
    op.drop_table("simulation_run_antennas")
    op.drop_table("simulation_runs")
    op.drop_table("scenes")
    op.drop_table("app_users")
