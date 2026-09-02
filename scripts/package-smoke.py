#!/usr/bin/env python3
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

COMMON_ROOT_FILES = {
    "async-pool.js",
    "attachments.js",
    "background.js",
    "chatgpt-api.js",
    "cancellation.js",
    "content.js",
    "conversation.js",
    "dom-selection.js",
    "download-url.js",
    "manifest.json",
    "popup.html",
    "popup.js",
    "render.js",
    "selection-cache-observer.js",
    "selection-index.js",
    "selection-matcher.js",
    "utils.js",
    "zip.js",
}

FORBIDDEN_PREFIXES = (
    ".github/",
    "scripts/",
    "tests/",
    "node_modules/",
    "dist/",
)

FORBIDDEN_FILES = {
    ".gitignore",
    "LICENSE",
    "README.md",
    "package.json",
    "package-lock.json",
}


def fail(message):
    raise SystemExit(f"Package smoke test failed: {message}")


def source_files_under(directory):
    base = ROOT / directory
    if not base.is_dir():
        fail(f"missing source directory: {directory}")

    return {
        path.relative_to(ROOT).as_posix()
        for path in base.rglob("*")
        if path.is_file()
    }


def expected_files(browser):
    files = set(COMMON_ROOT_FILES)
    files.update(source_files_under("_locales"))
    files.update(source_files_under("icons"))

    if browser == "chromium":
        files.update({"offscreen.html", "offscreen.js"})
    elif browser != "firefox":
        fail(f"unknown browser: {browser}")

    return files


def normalized_archive_files(archive):
    names = []

    with ZipFile(archive) as zf:
        bad = zf.testzip()
        if bad:
            fail(f"{archive.name} has a corrupt entry: {bad}")

        for info in zf.infolist():
            if info.is_dir():
                continue

            raw = info.filename
            while raw.startswith("./"):
                raw = raw[2:]

            path = PurePosixPath(raw)
            if (
                not raw
                or raw.startswith("/")
                or "\\" in raw
                or ".." in path.parts
            ):
                fail(f"{archive.name} has an unsafe path: {info.filename!r}")

            names.append(path.as_posix())

    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        fail(f"{archive.name} contains duplicate files: {duplicates}")

    return set(names)


def check_file_set(browser, archive):
    actual = normalized_archive_files(archive)
    expected = expected_files(browser)

    for path in actual:
        if path in FORBIDDEN_FILES or path.startswith(FORBIDDEN_PREFIXES):
            fail(f"{archive.name} contains development file: {path}")

    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"missing={missing}")
        if unexpected:
            details.append(f"unexpected={unexpected}")
        fail(f"{archive.name} file set mismatch: " + "; ".join(details))


def read_manifest(archive):
    with ZipFile(archive) as zf:
        try:
            return json.loads(zf.read("manifest.json"))
        except KeyError:
            fail(f"{archive.name} is missing manifest.json")
        except json.JSONDecodeError as exc:
            fail(f"{archive.name} has invalid manifest.json: {exc}")


def check_common_manifest(source, packaged, archive):
    for key in ("manifest_version", "name", "version", "description", "action", "content_scripts"):
        if packaged.get(key) != source.get(key):
            fail(f"{archive.name} changed common manifest field: {key}")

    scripts = packaged.get("content_scripts", [{}])[0].get("js", [])
    if scripts[:3] != [
        "dom-selection.js",
        "content.js",
        "selection-cache-observer.js",
    ]:
        fail(f"{archive.name} has wrong content-script load order: {scripts}")


def check_chromium_manifest(source, packaged, archive):
    check_common_manifest(source, packaged, archive)

    permissions = packaged.get("permissions", [])
    if permissions.count("offscreen") != 1:
        fail(f"{archive.name} must contain exactly one offscreen permission")

    if packaged.get("background") != {
        "service_worker": "background.js",
        "type": "module",
    }:
        fail(f"{archive.name} has wrong Chromium background manifest")

    if "browser_specific_settings" in packaged:
        fail(f"{archive.name} unexpectedly contains Firefox browser_specific_settings")


def check_firefox_manifest(source, packaged, archive):
    check_common_manifest(source, packaged, archive)

    if "offscreen" in packaged.get("permissions", []):
        fail(f"{archive.name} must not contain the offscreen permission")

    if packaged.get("background") != {
        "scripts": ["background.js"],
        "type": "module",
    }:
        fail(f"{archive.name} has wrong Firefox background manifest")

    gecko = packaged.get("browser_specific_settings", {}).get("gecko", {})
    if gecko.get("id") != "chatgpt-export-md-html@alexey-sirotin":
        fail(f"{archive.name} has wrong Firefox extension id")
    if gecko.get("strict_min_version") != "128.0":
        fail(f"{archive.name} has wrong Firefox minimum version")


def main():
    try:
        source_manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read source manifest: {exc}")

    version = source_manifest.get("version")
    if not version:
        fail("source manifest has no version")

    archives = {
        "chromium": DIST / f"chatgpt-export-md-html-{version}-chromium.zip",
        "firefox": DIST / f"chatgpt-export-md-html-{version}-firefox.zip",
    }

    for browser, archive in archives.items():
        if not archive.is_file():
            fail(f"missing archive: {archive}")

        check_file_set(browser, archive)
        packaged_manifest = read_manifest(archive)

        if browser == "chromium":
            check_chromium_manifest(source_manifest, packaged_manifest, archive)
        else:
            check_firefox_manifest(source_manifest, packaged_manifest, archive)

        print(f"OK: {archive.name}")

    print("Package smoke test passed.")


if __name__ == "__main__":
    main()
