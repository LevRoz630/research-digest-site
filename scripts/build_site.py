#!/usr/bin/env python3
"""Build static site from digest JSON files."""

import json
import os
import shutil
from pathlib import Path


def get_repo_info() -> tuple[str, str]:
    """Get owner and repo from git remote or environment."""
    # Try environment variables first (for GitHub Actions)
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if repo and "/" in repo:
        owner, name = repo.split("/", 1)
        return owner, name

    # Try parsing git remote
    try:
        import subprocess

        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            check=True,
        )
        url = result.stdout.strip()

        # Parse github.com/owner/repo from URL
        if "github.com" in url:
            # Handle both HTTPS and SSH URLs
            if url.startswith("git@"):
                # git@github.com:owner/repo.git
                path = url.split(":")[-1]
            else:
                # https://github.com/owner/repo.git
                path = url.split("github.com/")[-1]

            path = path.removesuffix(".git")
            parts = path.split("/")
            if len(parts) >= 2:
                return parts[0], parts[1]
    except Exception:
        pass

    return "owner", "repo"


def build_site() -> None:
    """Generate static HTML files from JSON digests."""
    root = Path(__file__).parent.parent
    site_dir = root / "site"
    output_dir = root / "_site"
    digests_dir = root / "digests"

    # Get repo info for GitHub API
    owner, repo = get_repo_info()
    print(f"Building site for {owner}/{repo}")

    # Clean and create output directory
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir()

    # Copy static assets
    shutil.copytree(site_dir / "css", output_dir / "css")
    shutil.copytree(site_dir / "js", output_dir / "js")

    # Copy and process HTML files
    for html_file in site_dir.glob("*.html"):
        content = html_file.read_text()
        content = content.replace("{{OWNER}}", owner)
        content = content.replace("{{REPO}}", repo)
        (output_dir / html_file.name).write_text(content)

    # Create digests directory in output
    output_digests = output_dir / "digests"
    output_digests.mkdir()

    # Copy digest JSON files and build index
    digest_index = []
    if digests_dir.exists():
        for digest_file in sorted(digests_dir.glob("*.json"), reverse=True):
            # Copy the file
            shutil.copy(digest_file, output_digests / digest_file.name)

            # Add to index
            try:
                with open(digest_file) as f:
                    data = json.load(f)
                    digest_index.append(
                        {
                            "date": data.get("date", digest_file.stem),
                            "paper_count": len(data.get("papers", [])),
                        }
                    )
            except Exception as e:
                print(f"Warning: Failed to parse {digest_file}: {e}")

    # Write digest index
    with open(output_digests / "index.json", "w") as f:
        json.dump(digest_index, f, indent=2)

    # Copy favorites.json if it exists (for initial load)
    favorites_file = root / "favorites.json"
    if favorites_file.exists():
        shutil.copy(favorites_file, output_dir / "favorites.json")

    print(f"Site built successfully in {output_dir}")
    print(f"  - {len(digest_index)} digests indexed")


if __name__ == "__main__":
    build_site()
