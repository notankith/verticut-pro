#!/usr/bin/env python3

import re
import time
import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/151.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}

IMAGE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/151.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://duckduckgo.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

VQD_RE = re.compile(r"vqd=['\"]?([\d-]+)['\"]?")


def get_vqd(session: requests.Session, query: str) -> str:
    resp = session.get(
        "https://duckduckgo.com/",
        params={"q": query},
        headers=HEADERS,
        timeout=15,
    )

    print("VQD page:", resp.status_code)

    resp.raise_for_status()

    match = VQD_RE.search(resp.text)

    if not match:
        raise RuntimeError(
            "Could not extract vqd token from DuckDuckGo"
        )

    return match.group(1)


def image_search(
    query: str,
    max_results: int = 100,
    safe: bool = True,
    retries: int = 2,
):
    session = requests.Session()

    # Important: persist cookies between the two requests
    session.headers.update(HEADERS)

    last_error = None

    for attempt in range(retries + 1):

        try:
            print(f"Attempt {attempt + 1}")

            vqd = get_vqd(session, query)

            print("VQD:", vqd)

            params = {
                "q": query,
                "o": "json",
                "vqd": vqd,
                "f": ",,,",
                "p": "1" if safe else "-1",
            }

            resp = session.get(
                "https://duckduckgo.com/i.js",
                params=params,
                headers=IMAGE_HEADERS,
                timeout=15,
            )

            print("Image API:", resp.status_code)

            if resp.status_code == 403:
                print("DuckDuckGo returned 403")
                print("Response:", resp.text[:500])

            resp.raise_for_status()

            data = resp.json()

            results = data.get("results", [])

            if results:
                return results[:max_results]

            last_error = RuntimeError("No results returned")

        except Exception as e:
            last_error = e
            print("Error:", e)

        if attempt < retries:
            time.sleep(2)

    raise last_error or RuntimeError("Image search failed")


def main():

    print(
        "DuckDuckGo image link fetcher. "
        "Ctrl+C or empty input to quit.\n"
    )

    while True:

        try:
            query = input("Search query: ").strip()

        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            break

        if not query:
            print("Bye.")
            break

        try:
            results = image_search(
                query,
                max_results=50
            )

        except Exception as e:
            print(f"  Error: {e}\n")
            continue

        if not results:
            print("  No images found.\n")
            continue

        print(f"  Found {len(results)} images:")

        for result in results:
            print(" ", result.get("image"))

        print()


if __name__ == "__main__":
    main()