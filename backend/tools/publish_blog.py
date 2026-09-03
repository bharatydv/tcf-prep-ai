"""Publish the blog posts in backend/content/blog to a running site.

Posts live in the repo as a pair of files per article -- `<slug>.html` for the
body and `<slug>.json` for the metadata -- so an article is reviewable in a
diff and a correction is a commit rather than a paste into a textarea that
nobody else can see.

The API has no upsert, so this reads the admin listing first and decides per
post: absent means POST, present means PUT against the existing post_id. That
makes a second run a no-op-shaped update rather than a duplicate slug, which
the database would reject anyway.

    python backend/tools/publish_blog.py --site https://prepfrancais.com \
        --email admin@example.com

The password is read from BLOG_ADMIN_PASSWORD, or prompted for. Auth is the
same cookie the browser gets: log in, keep the session, post with it.

    --dry-run   show what would be created or updated, touch nothing
    --only      publish one slug instead of all of them
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover - a missing dep should say so plainly
    sys.exit("requests is not installed: pip install requests")

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "blog"

# Only the fields the API accepts. Anything else in the sidecar is a typo, and
# silently dropping it would hide a metadata change that never shipped.
ALLOWED_FIELDS = {
    "slug", "title", "excerpt", "content", "cover_image",
    "meta_description", "author", "tags", "is_published",
}


def load_posts(only: str | None) -> list[dict]:
    posts = []
    for meta_path in sorted(CONTENT_DIR.glob("*.json")):
        body_path = meta_path.with_suffix(".html")
        if not body_path.exists():
            sys.exit(f"{meta_path.name} has no matching {body_path.name}")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        unknown = set(meta) - ALLOWED_FIELDS
        if unknown:
            sys.exit(f"{meta_path.name}: unknown field(s) {sorted(unknown)}")
        meta["content"] = body_path.read_text(encoding="utf-8")
        meta.setdefault("slug", meta_path.stem)
        if only and meta["slug"] != only:
            continue
        posts.append(meta)
    if only and not posts:
        sys.exit(f"no post with slug {only!r} in {CONTENT_DIR}")
    return posts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", default="https://prepfrancais.com",
                    help="site root, e.g. http://localhost:8000")
    ap.add_argument("--email", required=True, help="admin account email")
    ap.add_argument("--only", help="publish just this slug")
    # Retiring a post is the other half of curating a blog, and doing it by
    # hand in the admin UI leaves no record of what was taken down or why.
    # Unpublish rather than delete by default: it takes the post off the public
    # listing and the sitemap while the row stays recoverable. --delete is
    # separate and permanent.
    ap.add_argument("--unpublish", action="append", metavar="SLUG", default=[],
                    help="hide this slug from the public blog (repeatable)")
    ap.add_argument("--delete", action="append", metavar="SLUG", default=[],
                    help="permanently remove this slug (repeatable)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    posts = load_posts(args.only)
    site = args.site.rstrip("/")

    if args.dry_run:
        for p in posts:
            print(f"would publish {p['slug']}  ({len(p['content']):,} bytes)"
                  f"  {p['title']}")
        for slug in args.unpublish:
            print(f"would unpublish {slug}")
        for slug in args.delete:
            print(f"would DELETE {slug}")
        return

    password = os.environ.get("BLOG_ADMIN_PASSWORD") or getpass.getpass(
        f"password for {args.email}: ")

    s = requests.Session()
    r = s.post(f"{site}/api/auth/login",
               json={"email": args.email, "password": password}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"login failed ({r.status_code}): {r.text[:300]}")

    r = s.get(f"{site}/api/admin/blog", timeout=30)
    if r.status_code != 200:
        sys.exit(f"admin listing failed ({r.status_code}): {r.text[:300]}\n"
                 "Is this account's role actually 'admin'?")
    existing = {p["slug"]: p["post_id"]
                for p in (r.json().get("posts") or r.json())
                if isinstance(p, dict) and p.get("slug")}

    for p in posts:
        slug = p["slug"]
        if slug in existing:
            r = s.put(f"{site}/api/admin/blog/{existing[slug]}",
                      json=p, timeout=60)
            verb = "updated"
        else:
            r = s.post(f"{site}/api/admin/blog", json=p, timeout=60)
            verb = "created"
        if r.status_code not in (200, 201):
            sys.exit(f"{slug}: {verb[:-1]}e failed ({r.status_code}): "
                     f"{r.text[:300]}")
        print(f"{verb}: {site}/blog/{slug}")

    # Removals run after the publishes, so a run that both adds and retires
    # cannot leave the blog empty if the additions fail partway.
    for slug in args.unpublish:
        if slug not in existing:
            print(f"unpublish: no post with slug {slug!r}, skipped")
            continue
        r = s.put(f"{site}/api/admin/blog/{existing[slug]}",
                  json={"is_published": False}, timeout=30)
        if r.status_code != 200:
            sys.exit(f"{slug}: unpublish failed ({r.status_code}): "
                     f"{r.text[:300]}")
        print(f"unpublished: {slug}")

    for slug in args.delete:
        if slug not in existing:
            print(f"delete: no post with slug {slug!r}, skipped")
            continue
        r = s.delete(f"{site}/api/admin/blog/{existing[slug]}", timeout=30)
        if r.status_code not in (200, 204):
            sys.exit(f"{slug}: delete failed ({r.status_code}): {r.text[:300]}")
        print(f"deleted: {slug}")

    print("\nDone. These pages are prerendered at build time, so run the "
          "frontend build again to get them into the sitemap and into the "
          "static HTML a crawler reads.")


if __name__ == "__main__":
    main()
