import os

from backend.services.coverage_service import cleanup_generated_images


def write_file(path, size, mtime):
    path.write_bytes(b"x" * size)
    os.utime(path, (mtime, mtime))


def test_cleanup_generated_images_deletes_oldest_pngs_until_under_quota(tmp_path):
    oldest = tmp_path / "oldest.png"
    middle = tmp_path / "middle.png"
    newest = tmp_path / "newest.png"

    write_file(oldest, 60, 100)
    write_file(middle, 50, 200)
    write_file(newest, 30, 300)

    cleanup_generated_images(
        directory=tmp_path,
        quota_bytes=70,
    )

    assert not oldest.exists()
    assert not middle.exists()
    assert newest.exists()


def test_cleanup_generated_images_ignores_non_png_files(tmp_path):
    png = tmp_path / "map.png"
    keep = tmp_path / "asset.txt"

    write_file(png, 90, 100)
    write_file(keep, 90, 50)

    cleanup_generated_images(
        directory=tmp_path,
        quota_bytes=80,
    )

    assert not png.exists()
    assert keep.exists()


def test_cleanup_generated_images_keeps_files_when_under_quota(tmp_path):
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"

    write_file(first, 30, 100)
    write_file(second, 40, 200)

    cleanup_generated_images(
        directory=tmp_path,
        quota_bytes=80,
    )

    assert first.exists()
    assert second.exists()
