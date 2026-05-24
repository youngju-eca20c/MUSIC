"""
Build data.json + extract album art and lyrics from MP3 files.

Run this whenever you add/remove songs or change metadata.
    python build.py

Output:
    data.json                     - track metadata (titles, durations, lyrics flags)
    assets/art/NN.jpg             - extracted album art per track (auto, build owns it)
    assets/lyrics/NN.txt          - extracted lyrics per track (auto, build owns it)
    assets/lyrics/NN.manual.txt   - YOUR manual lyrics overrides (build never touches
                                    these; takes priority over auto NN.txt).

Orphan auto files (for track numbers no longer present) are cleaned up automatically
so reordering tracks doesn't leave stale lyrics attached to the wrong song.
"""

from __future__ import annotations

import json
import re
import sys
import io
from pathlib import Path

from mutagen.mp3 import MP3
from mutagen.id3 import APIC, USLT

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).parent
ART_DIR = ROOT / "assets" / "art"
LYR_DIR = ROOT / "assets" / "lyrics"
TRACK_RE = re.compile(r"^(\d+(?:\.\d+)?)\.?\s+(.+?)\.mp3$", re.IGNORECASE)
# Strip leading track-number prefixes from ID3 titles (e.g. "05.1 엠퍼러..." -> "엠퍼러...")
TITLE_PREFIX_RE = re.compile(r"^\d+(?:\.\d+)?\.?\s+")


def slug(track_num: str) -> str:
    """'04.1' -> '04.1', '4' -> '04'."""
    if "." in track_num:
        whole, frac = track_num.split(".")
        return f"{int(whole):02d}.{frac}"
    return f"{int(track_num):02d}"


ART_EXTS = ("jpg", "jpeg", "png")


def extract_art(audio: MP3, dest_dir: Path, track_num: str) -> str | None:
    """Write the first APIC frame to dest_dir/{track_num}.{ext}. Returns filename or None."""
    if not audio.tags:
        return None
    for key in audio.tags.keys():
        if key.startswith("APIC"):
            apic: APIC = audio.tags[key]
            ext = "jpg"
            if apic.mime and "png" in apic.mime.lower():
                ext = "png"
            # Avoid Path.with_suffix() — it would mangle "04.1" (treats ".1" as suffix).
            out = dest_dir / f"{track_num}.{ext}"
            out.write_bytes(apic.data)
            return out.name
    return None


def remove_existing_art(track_num: str) -> None:
    """Delete this track's prior art files. Explicit list avoids glob('04.*') eating 04.1."""
    for ext in ART_EXTS:
        p = ART_DIR / f"{track_num}.{ext}"
        if p.exists():
            p.unlink()


def extract_lyrics(audio: MP3) -> str | None:
    if not audio.tags:
        return None
    for key in audio.tags.keys():
        if key.startswith("USLT"):
            uslt: USLT = audio.tags[key]
            text = uslt.text or ""
            return text.strip() if text.strip() else None
    return None


def cleanup_orphans(current_nums: set[str]) -> None:
    """Delete art/lyrics files whose track number no longer exists in the folder."""
    for f in ART_DIR.glob("*"):
        if f.is_file() and f.stem not in current_nums:
            print(f"  cleanup: removed orphan {f.relative_to(ROOT)}")
            f.unlink()
    for f in LYR_DIR.glob("*.txt"):
        stem = f.stem
        if stem.endswith(".manual"):
            stem = stem[: -len(".manual")]
        if stem not in current_nums:
            print(f"  cleanup: removed orphan {f.relative_to(ROOT)}")
            f.unlink()


def main() -> None:
    ART_DIR.mkdir(parents=True, exist_ok=True)
    LYR_DIR.mkdir(parents=True, exist_ok=True)

    mp3_files = sorted(ROOT.glob("*.mp3"))
    if not mp3_files:
        print("No MP3 files found in", ROOT)
        return

    # Pre-pass: figure out which track numbers exist now, drop orphan assets.
    current_nums: set[str] = set()
    for mp3 in mp3_files:
        m = TRACK_RE.match(mp3.name)
        if m:
            current_nums.add(slug(m.group(1)))
    cleanup_orphans(current_nums)

    tracks: list[dict] = []
    for mp3 in mp3_files:
        m = TRACK_RE.match(mp3.name)
        if not m:
            print(f"  skip (no track number): {mp3.name}")
            continue
        track_num = slug(m.group(1))
        title_from_file = m.group(2).strip()

        audio = MP3(mp3)
        tags = audio.tags
        title = str(tags.get("TIT2", title_from_file)).strip() if tags else title_from_file
        title = TITLE_PREFIX_RE.sub("", title)
        artist = str(tags.get("TPE1", "")).strip() if tags else ""
        duration = float(audio.info.length)

        # Album art: always re-extract (build owns NN.jpg). Overwrites previous.
        remove_existing_art(track_num)
        art_name = extract_art(audio, ART_DIR, track_num)

        # Lyrics resolution:
        #   1. NN.manual.txt  → your manual override, build never touches it
        #   2. NN.txt         → auto-extracted from ID3, build always rewrites it
        manual = LYR_DIR / f"{track_num}.manual.txt"
        auto = LYR_DIR / f"{track_num}.txt"
        lyrics_rel: str | None = None
        lyrics_source: str | None = None

        if manual.exists() and manual.read_text(encoding="utf-8").strip():
            lyrics_rel = f"assets/lyrics/{track_num}.manual.txt"
            lyrics_source = "manual"
            auto.unlink(missing_ok=True)
        else:
            id3_lyrics = extract_lyrics(audio)
            if id3_lyrics:
                auto.write_text(id3_lyrics, encoding="utf-8")
                lyrics_rel = f"assets/lyrics/{track_num}.txt"
                lyrics_source = "id3"
            else:
                # No lyrics for this track now — drop a stale auto file if present.
                auto.unlink(missing_ok=True)

        tracks.append({
            "num": track_num,
            "title": title,
            "artist": artist,
            "file": mp3.name,
            "duration": round(duration, 2),
            "art": f"assets/art/{art_name}" if art_name else None,
            "lyrics": lyrics_rel,
            "lyricsSource": lyrics_source,
        })

        marks = []
        if art_name:
            marks.append("art")
        if lyrics_rel:
            marks.append(f"lyr({lyrics_source})")
        print(f"  {track_num:6} {title[:40]:40} [{', '.join(marks) or '-'}]")

    # Fallback: tracks without their own art borrow art from the previous track
    # (handles cases like 04.1 having no embedded art -> use 04's art)
    last_art = None
    for t in tracks:
        if t["art"]:
            last_art = t["art"]
        elif last_art:
            t["art"] = last_art

    data = {
        "artist": "HAEMAMUL",
        "tracks": tracks,
    }
    (ROOT / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote data.json with {len(tracks)} tracks.")


if __name__ == "__main__":
    main()
