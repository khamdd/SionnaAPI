from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AntennaRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float = Field(allow_inf_nan=False)
    current: float = Field(allow_inf_nan=False)
    max: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_range(self):
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        if not self.min <= self.current <= self.max:
            raise ValueError("current must be between min and max")
        return self


class AntennaValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=255)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    height_m: float = Field(gt=0, allow_inf_nan=False)
    azimuth: float = Field(ge=0, le=360, allow_inf_nan=False)
    tilt: AntennaRange
    tx_power: AntennaRange

    @field_validator("id")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("antenna ID cannot be empty")
        return normalized


class AntennaCreateRequest(AntennaValues):
    pass


class AntennaUpdateRequest(AntennaValues):
    pass


class AntennaImportPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    antennas: list[AntennaValues] = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def validate_unique_codes(self):
        codes = [antenna.id.casefold() for antenna in self.antennas]
        if len(codes) != len(set(codes)):
            raise ValueError("antenna IDs must be unique within an import")
        return self


class AntennaBatchImportRequest(AntennaImportPreviewRequest):
    update_existing: bool = False


class AntennaReferenceList(BaseModel):
    model_config = ConfigDict(extra="forbid")
    antenna_ids: list[UUID] = Field(min_length=1, max_length=5000)


AntennaStatus = Literal["active", "archived"]
