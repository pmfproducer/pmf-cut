"""Search Pexels and download images OR video clips into a Remotion public/ folder.

PHASE 2 helper. Needs PEXELS_API_KEY (env or .env at the pmf-cut repo root).
Get a free key at https://www.pexels.com/api/.

Prints each downloaded file's local path and photographer credit (keep the
credits for attribution).

Usage:
    python helpers/pexels_search.py "hollywood film set" \
        --out-dir <edit>/remotion/public/pexels --count 3 --orientation portrait

    python helpers/pexels_search.py "driving on highway" --kind video \
        --out-dir <edit>/remotion/public/pexels --count 3 --orientation landscape

`--kind video` downloads .mp4, which the split band picks up on its own: the
template branches on the file extension (`\\.(mp4|mov|webm)$` → <Video>, else
<Img>), so a video insert is the same edit-data.json entry with a different src.

The two endpoints do NOT share a response shape: photos carry `src{}` with named
renditions, videos carry `video_files[]` with one entry per resolution and
`user.name` instead of `photographer`. Hence the split in `pick_url`.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import requests

SEARCH_URL = "https://api.pexels.com/v1/search"
VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search"


def load_api_key() -> str:
    for candidate in [Path(__file__).resolve().parent.parent / ".env", Path(".env")]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "PEXELS_API_KEY":
                    return v.strip().strip('"').strip("'")
    v = os.environ.get("PEXELS_API_KEY", "")
    if not v:
        sys.exit("PEXELS_API_KEY not found in .env or environment "
                 "(get one at https://www.pexels.com/api/)")
    return v


def search(query: str, api_key: str, count: int, orientation: str | None,
           kind: str = "photo") -> list[dict]:
    params: dict[str, str | int] = {"query": query, "per_page": max(1, min(count, 80))}
    if orientation:
        params["orientation"] = orientation  # landscape | portrait | square
    url = VIDEO_SEARCH_URL if kind == "video" else SEARCH_URL
    resp = requests.get(url, headers={"Authorization": api_key},
                        params=params, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"Pexels returned {resp.status_code}: {resp.text[:300]}")
    return resp.json().get("videos" if kind == "video" else "photos", [])


def pick_video_file(item: dict, max_height: int) -> str | None:
    """Largest rendition at or under max_height — a 4K clip for a 750px band is
    a 40 MB download that Remotion then downscales anyway."""
    files = [f for f in item.get("video_files", []) if f.get("link")]
    if not files:
        return None
    fit = [f for f in files if (f.get("height") or 0) <= max_height]
    best = max(fit or files, key=lambda f: (f.get("height") or 0))
    return best.get("link")


def download(url: str, dest: Path) -> None:
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    dest.write_bytes(r.content)


def slugify(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")[:40]


def main() -> None:
    ap = argparse.ArgumentParser(description="Download Pexels images into a Remotion public/ folder")
    ap.add_argument("query", help="Search query")
    ap.add_argument("--out-dir", type=Path, required=True, help="Destination folder (e.g. remotion/public/pexels)")
    ap.add_argument("--count", type=int, default=3, help="How many images to download (default 3)")
    ap.add_argument("--orientation", choices=["landscape", "portrait", "square"], default=None)
    ap.add_argument("--size", choices=["original", "large2x", "large", "medium"], default="large2x",
                    help="Pexels rendition to download (default large2x)")
    ap.add_argument("--kind", choices=["photo", "video"], default="photo",
                    help="photo (default) or video — video downloads .mp4")
    ap.add_argument("--max-height", type=int, default=1440,
                    help="video only: cap the rendition height (default 1440)")
    args = ap.parse_args()

    api_key = load_api_key()
    items = search(args.query, api_key, args.count, args.orientation, args.kind)
    if not items:
        sys.exit(f"no results for: {args.query}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(args.query)
    saved = 0
    for i, p in enumerate(items[: args.count]):
        if args.kind == "video":
            url = pick_video_file(p, args.max_height)
            ext = ".mp4"
            credit = (p.get("user") or {}).get("name", "?")
        else:
            src = p.get("src", {})
            url = src.get(args.size) or src.get("large") or src.get("original")
            ext = ".jpg"
            credit = p.get("photographer", "?")
        if not url:
            continue
        dest = args.out_dir / f"{slug}-{i+1}{ext}"
        try:
            download(url, dest)
        except Exception as e:
            print(f"  x failed {p.get('id')}: {e}")
            continue
        saved += 1
        extra = f", {p.get('duration')}s" if args.kind == "video" else ""
        print(f"  + {dest}  ({args.kind}: {credit}{extra}, {p.get('url','')})")

    print(f"downloaded {saved}/{args.count} → {args.out_dir}")
    if saved:
        print(f"attribution: {args.kind}s from Pexels — keep the credits above.")


if __name__ == "__main__":
    main()
