"""
Facebook Reels Report Generator
--------------------------------
Fetches posts from your Facebook Pages over the last 28 days, filters for
actual Reels (not regular videos/photos/links), and prints a per-page +
total count report.

REQUIREMENTS:
    pip install requests

SETUP:
    PAGES below is pre-filled with the 9 pages found in your Graph API
    Explorer "me/accounts" dump, each with its own Page Access Token.
    Add/remove entries as needed. These tokens need pages_read_engagement
    / pages_show_list permissions to read posts.

HOW REELS ARE DETECTED:
    The Graph API /posts edge doesn't have a clean "is_reel" boolean for
    organically published Reels, so this script uses permalink_url -
    Facebook Reels always have "/reel/" or "/reels/" in their permalink.
    This is the most reliable method available via the standard Pages API.
"""

import time
import requests

# ----------------------- CONFIG -----------------------

GRAPH_API_VERSION = "v25.0"
DAYS_BACK = 28

# SECURITY NOTE: These are live Page Access Tokens. Don't commit this file
# to git or share it. Treat it like a password file.
PAGES = [
    {"name": "Pet Story", "page_id": "1000906903106858",
     "access_token": "EAAUqV1LyG8sBR54JwL81UlrqsE28GknGEwdZAuSrAY6SWQcHnDkTGIWSLCsyiKUi2IljpG0HhQLf5plZCSF7tBYcnzxnY5srEo5BIZAKC77SZAh8Oap15ZCpEEAtVsgWj5ruczoxiZAcU4HZA7FZBjPNSwguUxAatYpN6oZAFfbxQQnURmuWrH1JeZArYCufyR7GAj9mggDFzWqqZCBgDlYpOwZAIMZAR8WQGLWDGuPNdSv14"},
    {"name": "Ssup Chiefs", "page_id": "220015244526738",
     "access_token": "EAAUqV1LyG8sBR06xfhMzRQbm0TlvY605crXZCC3iDg93BgIWONyaYJ8lyaaOE8VYqyQYTJGFWUkMvZCqYVk57gcUxBYZBJZB009e6Yx5rWb1x77jZCurGHBSGe0YCdqb5Sjbgg12R1PE2ZCTzUDooJl6Q1TV7UdZAFuPk3xF7Uuk07RifBRRF034dEi8DejJJ5CTXVkqd1BGZA68aNSZBuYwRZBvwBYZA4009jW9dE9ddkZD"},
    {"name": "Golf Central", "page_id": "111378218725444",
     "access_token": "EAAUqV1LyG8sBR5ZCzoWEwWmZA7e9ZAkROLM0QEzfhb4VkETsKRZC4hVHzk8v6VRSdXKcaitl0g1sFndwH1DmZANwTaOfZBSi7tjEAs8JZCw5gJMZBRCmAmskDnQDIj6SF4AvKnWTkucc7uVlOQN7GNUoumi8YOEE4aZCkeJQDcZCvagz5tzioMWiHZCcPKX8D8IKFwqyNlVgR5UuO8KSrowvpBrjYIqUL8RUkZAvfRWVCKIZD"},
    {"name": "Lone Star Sports", "page_id": "110290392167171",
     "access_token": "EAAUqV1LyG8sBR3W7b9zOTl8lYZADHdPkoPRZAPwoymweTjcC3h7D78PVzZC5j3S26Ji7rcF0FGZCmluAm6p2ZC7grutcYzHcZB8w6lZAmefc4kcoVKLQ6nRBh2KsENQhvKbETbmey8sfKAvKVHSzX5pxmM627ZBga92eZAf0H0I6tJv1imi499XV9Utpae69qeAtKUfnl6iniAqH1C3UsOwExxtXRsr8Q9hVOToP1DJkZD"},
    {"name": "Varsity Report", "page_id": "113471091649197",
     "access_token": "EAAUqV1LyG8sBR4Dfr8HUbvbJcFUCrZBemV3VYMVP03hWDgX1Iz9Ez5Fukp2aocmtnRWIrZCS2a9Xl5CrkQYDxBjwAaCeaD3d7Itp9ikFGoEv1Cz3B2t4XVAxNS8yLFVyEzVaiu4ZANAVjuIcbZBabRB6kFI1ZAIpOvKZBXrFrieCb8rywrC0wImDA3iHDhlGXTqlTKnQORJ3Oe6JpVCbuth1mg623yMjhyqPGJVhAZD"},
    {"name": "The Stripes", "page_id": "104700399037138",
     "access_token": "EAAUqV1LyG8sBR0NMaz079vCkS8djukQac9CxPWnToZAFypfrjmpNkz0URUo7BjvVWKa2l8IW2D818ZA8EL5NQYwLJUqelzilmQyYTCseOVubY1JZCfdwY3realrZAywk7titXFRjKtaSBZAS0P3XywFzJDSJ4lQS6GGanDty7bhublWVqveS25hWF9q5qmXorEq0iRMGqHeWDSoVJMSGnC2PH8hgRNpk14oCaTP4ZD"},
    {"name": "Rally Central", "page_id": "100314729449895",
     "access_token": "EAAUqV1LyG8sBR2yuU2BUwUI5h8IlCzibJfNSXK1P4RXdZB8BLXmqy3rrXrxczMFHlK15zM5hklpGRSKlF8fxMt5ls08LZBWhzmuGgAEIqK1o3UmHMllaRzHimxDtV1LEmqK4BHWTmH4aJrFMvwJGiuQmAFFt2gVliMOcADxj2f96MVZCvszh8yM25nXSDM1EV9n7mNHGzePeIF9NzZCcLoSVijstl5koPmVlyvsZD"},
    {"name": "Gridiron Central", "page_id": "123872034331112",
     "access_token": "EAAUqV1LyG8sBR9HfON1BjzAtW2LtLJtqOd3erNB0Nanocwtza4R4B8ERHn1cUd1kubOQpeZAqRqLOuhqwQEuiIbm94CZCF3hU8XjmQVb6qrY7cSXMMX2XkJFVAp6R9iGCVPF4EaNGHbumUjcgRZBcKP2ElK1inccxzRlnhLprpFn6QHd9XLrk7CTuRIVkY8qH72HOwhnXKJIaEZC6Cnf8M2h4iWPgwhwM1ZB4Bw4ZD"},
    {"name": "Hoop Radar", "page_id": "100390181377848",
     "access_token": "EAAUqV1LyG8sBR1iRLSgMeyCmxmSFVrZBD5OXZBD7Gn6iE16W4IaziFZBuFGC7KDSp8x1rPpf3XnLnZBlSjZBxQQG1EuZAP9sfyusvMWcPCce0ticeyDBp4clmvZCdWidQm7dpNxvfgDzpZCt2ZCe0f9ZB6ZBoyoKZBj69ZAZA35IScESmZCzIr8e20MVgK5gc3KkLsxerOCqc8db4ZBCT4VFY3ZBZAJdhrNIxwR3rGJSwJif1Mz6EZD"},
]

# --------------------------------------------------------


def is_reel(post: dict) -> bool:
    """Detect whether a post is a Reel based on its permalink."""
    permalink = (post.get("permalink_url") or "").lower()
    if "/reel/" in permalink or "/reels/" in permalink:
        return True

    # Fallback: some reels surface with attachment type 'video_inline'
    # AND a target URL containing '/reel'
    for att in post.get("attachments", {}).get("data", []):
        target_url = (att.get("target", {}) or {}).get("url", "").lower()
        if "/reel" in target_url:
            return True
    return False


def fetch_posts(page_id: str, access_token: str, since_ts: int, until_ts: int) -> list:
    """Fetch all posts for a page within the given time window, handling pagination."""
    base_url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{page_id}/posts"
    params = {
        "fields": "id,created_time,permalink_url,attachments{type,media_type,target}",
        "since": since_ts,
        "until": until_ts,
        "limit": 100,
        "access_token": access_token,
    }

    posts = []
    url = base_url

    while url:
        resp = requests.get(url, params=params if url == base_url else None, timeout=30)
        data = resp.json()

        if "error" in data:
            err = data["error"]
            raise RuntimeError(
                f"Graph API error for page {page_id}: "
                f"{err.get('message')} (code {err.get('code')}, type {err.get('type')})"
            )

        posts.extend(data.get("data", []))

        # Pagination
        paging = data.get("paging", {})
        url = paging.get("next")  # 'next' already contains full query string
        params = None  # only needed on first request

        time.sleep(0.3)  # gentle rate-limit buffer

    return posts


def main():
    now = int(time.time())
    since_ts = now - (DAYS_BACK * 24 * 60 * 60)
    until_ts = now

    results = []
    grand_total = 0
    errors = []

    for page in PAGES:
        name = page["name"]
        page_id = page["page_id"]
        token = page["access_token"]

        try:
            posts = fetch_posts(page_id, token, since_ts, until_ts)
            reel_count = sum(1 for p in posts if is_reel(p))
            results.append((name, reel_count))
            grand_total += reel_count
        except Exception as e:
            errors.append((name, str(e)))
            results.append((name, None))

    # ----------------- REPORT -----------------
    print("\n" + "=" * 50)
    print(f" FACEBOOK REELS REPORT — LAST {DAYS_BACK} DAYS")
    print("=" * 50)

    for name, count in results:
        if count is None:
            print(f"  {name}: ERROR (see details below)")
        else:
            print(f"  {name}: {count} Reels posted")

    print("-" * 50)
    print(f"  TOTAL REELS ACROSS ALL {len(PAGES)} PAGES: {grand_total}")
    print("=" * 50)

    if errors:
        print("\nErrors encountered:")
        for name, msg in errors:
            print(f"  - {name}: {msg}")


if __name__ == "__main__":
    main()