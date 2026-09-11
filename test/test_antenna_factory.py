import math

from backend.simulations.antenna_factory import sionna_azimuth_rad


def test_sionna_azimuth_maps_compass_to_math_convention():
    assert sionna_azimuth_rad(0) == math.radians(90)
    assert sionna_azimuth_rad(90) == 0
    assert sionna_azimuth_rad(180) == math.radians(-90)
    assert sionna_azimuth_rad(270) == math.radians(-180)


def test_sionna_azimuth_accepts_numeric_strings():
    assert sionna_azimuth_rad("45") == math.radians(45)


def test_sionna_azimuth_produces_equivalent_direction_across_full_circle():
    two_pi = 2 * math.pi
    assert sionna_azimuth_rad(360) % two_pi == sionna_azimuth_rad(0) % two_pi
    assert sionna_azimuth_rad(135) % two_pi == sionna_azimuth_rad(-225) % two_pi
