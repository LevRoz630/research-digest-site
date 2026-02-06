#!/usr/bin/env python3
"""Generate a research digest using daily-research-digest library."""

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Track seen papers to avoid duplicates
SEEN_FILE = Path(__file__).parent.parent / "seen_papers.json"


def load_seen_papers() -> set[str]:
    """Load previously seen paper IDs."""
    if SEEN_FILE.exists():
        with open(SEEN_FILE) as f:
            data = json.load(f)
            return set(data.get("arxiv_ids", []))
    return set()


def save_seen_papers(seen: set[str]) -> None:
    """Save seen paper IDs."""
    with open(SEEN_FILE, "w") as f:
        json.dump({"arxiv_ids": list(seen)}, f)


async def main():
    from daily_research_digest.digest import DigestGenerator
    from daily_research_digest.models import DateFilter, DigestConfig
    from daily_research_digest.storage import DigestStorage

    # Get config from environment
    interests = os.environ.get("DIGEST_INTERESTS", "machine learning, AI agents")
    llm_provider = os.environ.get("LLM_PROVIDER", "openai")

    # Time window: last 30 days
    now = datetime.now(timezone.utc)
    month_ago = now - timedelta(days=30)

    # Enhanced interests prompt for LLM ranking
    enhanced_interests = f"""{interests}

When ranking, also consider:
- Author credentials and reputation (prefer established researchers from top institutions)
- Quality of methodology described in abstract
- Novelty and potential impact of the work
- Papers with well-known authors in the field should be scored higher"""

    config = DigestConfig(
        interests=enhanced_interests,
        max_papers=50,
        top_n=15,
        llm_provider=llm_provider,
        openai_api_key=os.environ.get("OPENAI_API_KEY"),
        semantic_scholar_api_key=os.environ.get("SEMANTIC_SCHOLAR_API_KEY"),
        sources=["semantic_scholar"],
        date_filter=DateFilter(
            published_after=month_ago.strftime("%Y-%m-%d"),
            published_before=now.strftime("%Y-%m-%d"),
        ),
    )

    # Generate digest
    digests_dir = Path(__file__).parent.parent / "digests"
    digests_dir.mkdir(exist_ok=True)

    storage = DigestStorage(digests_dir)
    generator = DigestGenerator(storage)

    print(f"Interests: {interests}")
    print(f"Date range: {month_ago.strftime('%Y-%m-%d')} to {now.strftime('%Y-%m-%d')}")

    result = await generator.generate(config)

    if result["status"] == "error":
        print(f"Error: {result.get('errors', ['Unknown error'])}")
        return 1

    digest = result.get("digest", {})
    papers = digest.get("papers", [])

    print(f"Fetched {len(papers)} papers")

    if not papers:
        print("No papers found")
        return 0

    # Save to timestamped JSON file (allows multiple regenerations per day)
    date_str = now.strftime("%Y-%m-%d-%H%M%S")
    digest_file = digests_dir / f"{date_str}.json"

    with open(digest_file, "w") as f:
        json.dump(digest, f, indent=2)

    print(f"Saved {len(papers)} papers to {digest_file}")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
