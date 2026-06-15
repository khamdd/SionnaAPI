from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import List, Tuple
from backend.constants import (
    DEFAULT_RSRP_USER_COUNT,
    DEFAULT_TRANSMITTER_PATTERN,
    DEFAULT_USER_HEIGHT_M,
    MAX_GRID_CELLS,
    MAX_RSRP_USER_COUNT,
)


class SolverConfig(BaseModel):
    max_depth: int = Field(default=5, ge=0, le=10)
    samples_per_tx: int = Field(default=10**6, gt=0, le=10**7)
    cell_size: float = Field(default=2.0, gt=0, le=50.0)
    center: Tuple[float, float, float] = (
        0.0,
        0.0,
        0.0,
    )

    size: Tuple[float, float] = (
        400.0,
        400.0,
    )

    @model_validator(mode="after")
    def validate_grid_size(self):
        if self.size[0] <= 0 or self.size[1] <= 0:
            raise ValueError("solver size values must be greater than 0")

        cells = (self.size[0] / self.cell_size) * (self.size[1] / self.cell_size)
        if cells > MAX_GRID_CELLS:
            raise ValueError("simulation grid is too large")
        return self


class CameraConfig(BaseModel):
    position: Tuple[float, float, float] = (
        -1.5,
        -137.0,
        115.0,
    )

    look_at: Tuple[float, float, float] = (
        0.0,
        0.0,
        10.0,
    )


class CoverageRequest(BaseModel):
    tilt: float

    transmitter_position: Tuple[
        float,
        float,
        float
    ]

    tx_power: float = 30.0

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )

    camera: CameraConfig = Field(
        default_factory=CameraConfig
    )


class RangeValue(BaseModel):
    min: float
    current: float
    max: float

    @model_validator(mode="after")
    def validate_current_inside_range(self):
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")

        if not self.min <= self.current <= self.max:
            raise ValueError("current must be between min and max")

        return self


class AntennaConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str

    position: Tuple[
        float,
        float,
        float
    ]

    tilt: RangeValue

    azimuth: float = Field(
        ge=0.0,
        le=360.0,
    )

    tx_power: RangeValue


class NetworkCoverageRequest(BaseModel):
    antennas: List[AntennaConfig] = Field(
        min_length=1,
        max_length=10,
    )

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )

    camera: CameraConfig = Field(
        default_factory=lambda: CameraConfig(
            position=(0.0, 0.0, 650.0),
            look_at=(0.0, 0.0, 0.0),
        )
    )

    bandwidth_mhz: float = Field(
        default=100.0,
        gt=0,
    )

    mimo_layers: int = Field(
        default=4,
        gt=0,
    )


class RSRPRequest(BaseModel):
    antennas: List[AntennaConfig] = Field(
        min_length=1,
        max_length=10,
    )

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )

    user_count: int = Field(
        default=DEFAULT_RSRP_USER_COUNT,
        ge=1,
        le=MAX_RSRP_USER_COUNT,
    )

    user_height_m: float = Field(
        default=DEFAULT_USER_HEIGHT_M,
        ge=0.5,
        le=10.0,
    )

    random_seed: int = Field(
        default=42,
        ge=0,
    )


class SINRRequest(BaseModel):
    tilt: float

    transmitter_position: Tuple[
        float,
        float,
        float
    ]

    receiver_position: Tuple[
        float,
        float,
        float
    ]

    interferer_position: Tuple[
        float,
        float,
        float
    ] = (
        120.0,
        100.0,
        25.0,
    )

    interferer_tilt: float = 12.0

    tx_power: float = 30.0

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )


class ThroughputRequest(BaseModel):
    base_tilt: float

    target_tilt: float

    transmitter_position: Tuple[
        float,
        float,
        float
    ]

    receiver_position: Tuple[
        float,
        float,
        float
    ]

    interferer_position: Tuple[
        float,
        float,
        float
    ] = (
        120.0,
        100.0,
        25.0,
    )

    interferer_tilt: float = 12.0

    tx_power: float = 30.0

    transmitter_pattern: str = DEFAULT_TRANSMITTER_PATTERN

    bandwidth_mhz: float = Field(
        default=100.0,
        gt=0,
    )

    mimo_layers: int = Field(
        default=4,
        gt=0,
    )

    solver: SolverConfig = Field(
        default_factory=SolverConfig
    )


class SceneBoundsRequest(BaseModel):
    name: str | None = Field(
        default=None,
        max_length=80,
    )

    south: float = Field(
        ge=-90.0,
        le=90.0,
    )

    west: float = Field(
        ge=-180.0,
        le=180.0,
    )

    north: float = Field(
        ge=-90.0,
        le=90.0,
    )

    east: float = Field(
        ge=-180.0,
        le=180.0,
    )

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.south >= self.north:
            raise ValueError("south must be less than north")

        if self.west >= self.east:
            raise ValueError("west must be less than east")

        return self
