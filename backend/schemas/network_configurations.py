from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class NetworkConfigurationRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float = Field(allow_inf_nan=False)
    current: float = Field(allow_inf_nan=False)
    max: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_current_inside_range(self):
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        if not self.min <= self.current <= self.max:
            raise ValueError("current must be between min and max")
        return self


class NetworkConfigurationAntenna(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=255)
    longitude: float = Field(ge=-180.0, le=180.0, allow_inf_nan=False)
    latitude: float = Field(ge=-90.0, le=90.0, allow_inf_nan=False)
    height_m: float = Field(gt=0.0, allow_inf_nan=False)
    enabled: bool = True
    tilt: NetworkConfigurationRange
    azimuth: float = Field(ge=0.0, le=360.0, allow_inf_nan=False)
    tx_power: NetworkConfigurationRange

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("antenna ID cannot be empty")
        return normalized


class NetworkConfigurationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, max_length=255)
    parent_configuration_id: UUID | None = None
    source: Literal["manual", "file", "external_api"] = "manual"
    source_reference: str | None = Field(default=None, max_length=1000)
    antennas: list[NetworkConfigurationAntenna] | None = Field(
        default=None,
        min_length=1,
    )

    @field_validator("scene_id")
    @classmethod
    def normalize_scene_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("scene ID cannot be empty")
        return normalized

    @field_validator("source_reference")
    @classmethod
    def normalize_source_reference(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def validate_unique_antenna_ids(self):
        if self.antennas is None:
            return self

        antenna_ids = [antenna.id for antenna in self.antennas]
        if len(set(antenna_ids)) != len(antenna_ids):
            raise ValueError("antenna IDs must be unique")
        return self
