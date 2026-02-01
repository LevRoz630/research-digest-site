#!/usr/bin/env python3
"""Generate a research digest using daily-research-digest library."""

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path


async def main():
    from daily_research_digest.digest import DigestGenerator
    from daily_research_digest.models import DateFilter, DigestConfig
    from daily_research_digest.storage import DigestStorage

    # Get config from environment
    categories = os.environ.get("DIGEST_CATEGORIES", "cs.AI,cs.CL,cs.LG").split(",")
    categories = [c.strip() for c in categories]
    interests = os.environ.get("DIGEST_INTERESTS", "machine learning, AI agents")
    llm_provider = os.environ.get("LLM_PROVIDER", "openai")

    # Time window: last 24 hours
    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(days=1)

    config = DigestConfig(
        categories=categories,
        interests=interests,
        max_papers=50,
        top_n=15,
        llm_provider=llm_provider,
        openai_api_key=os.environ.get("OPENAI_API_KEY"),
        date_filter=DateFilter(
            published_after=yesterday.strftime("%Y-%m-%d"),
            published_before=now.strftime("%Y-%m-%d"),
        ),
    )

    # Generate digest
    digests_dir = Path(__file__).parent.parent / "digests"
    digests_dir.mkdir(exist_ok=True)

    storage = DigestStorage(digests_dir)
    generator = DigestGenerator(storage)

    print(f"Generating digest for categories: {categories}")
    print(f"Interests: {interests}")

    result = await generator.generate(config)

    if result["status"] == "error":
        print(f"Error: {result.get('errors', ['Unknown error'])}")
        return 1

    digest = result.get("digest", {})
    papers = digest.get("papers", [])
    print(f"Generated digest with {len(papers)} papers")

    # Save to dated JSON file
    date_str = now.strftime("%Y-%m-%d")
    digest_file = digests_dir / f"{date_str}.json"

    with open(digest_file, "w") as f:
        json.dump(digest, f, indent=2)

    print(f"Saved to {digest_file}")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
