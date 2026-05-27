import requests
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://graph.facebook.com/v24.0"

pages = [
    {
        "name": "Pet Story",
        "id": "1000906903106858",
        "token": "EAAUqV1LyG8sBRtjGL8bI4i35FQ4Cl8R4U9CiHH8DXXoIjFGr732GNJAT3JkKWe4XWGZBBDSfAoj5hkOnP6JZB2KxlOCy9LeramN7sfOzE7ZAfh4CDag7TjV2QCtmZAvzhdZAI7Yhk0pZCKoIGl2YQ84pc1I0aoNbj2PdD3uUech4T7Ojro5ZAZBAeWP5AeuN4pPfKAprKdDduZBZCHJ3RSKh36vjZAKHXFkfFMBQX7s5bgZD"
    },
    {
        "name": "Ssup Chiefs",
        "id": "220015244526738",
        "token": "EAAUqV1LyG8sBRkPhnZBtXBTtJ3gcRJlzlmqV938Lt8X2MVRi22z0grf94nXKVofWZAborAkk3eyoTq7CobD9sxelVFu8kgPWH8G7jP7yZBRkwRBToWZAa0tjK1LScNq6A4cdp5hSvLFnrfzX2c4Wp0KPqGu53vGRyI0zQIegsSrAALvsZAH8vNalbZBgCYwgBSEZBhBxZCGll5CNRyNSBAOMP1KmAHDPJIdGVQ3GiAZDZD"
    },
    {
        "name": "Golf Central",
        "id": "111378218725444",
        "token": "EAAUqV1LyG8sBRij2AZCZB9NR6wZAO09et63LDD8qDGvIFiY8tCSXKorZCuZCIOrf1BTlrVNmkZAUKZBu7Fl7t566ujQBzjejO1geWcUZAVsyQseSPdptiSmOx8D4UuZB83g5iRZArOUXATYtjOKBaFjVZA03m4d8QBRWCInU5rxeOLOGboiHkPF1laF5UoSFWOn0ZArubbhY0rm2mSRi9hyO3u0ZCaUZAVBE35kjhqwUvcggZDZD"
    },
    {
        "name": "Lone Star Sports",
        "id": "110290392167171",
        "token": "EAAUqV1LyG8sBRijgCsP3RoOeYujQKdtsqgkSdKUcMU9QrPzqhMO8kpOFQc92ZBbZCIUO6rK003mCYuaZAAZC826LovJtLUILeRzoLHmyZBCkBZCw5iijopF0fZBBNkq2OdlB867LdEc9w9XKxbH2pjlFiSkkm3iZCUYDComEVeZBHVgETVHpZCToOfV6cn4hccqZBmOYyz0ptP8hVZAV1XCkz3PJ1ixl0SNZATuWZBG1JB8AZDZD"
    },
    {
        "name": "Varsity Report",
        "id": "113471091649197",
        "token": "EAAUqV1LyG8sBRjXxA2r6YzUZAHzXHD73RtHJp9MJGwU8U8kPI8z0gJY3ajrCrYkBZCf3Nf7lD0ba6bs1ZBA9isakVmzPI9AmbGCBbZAt4ghZCUumLyi0p2iaowoDyCsTk4lZCxwjsXJNGWdgrRFKtoZBQkchdoNNgDYXpgNhnzc2LXWfnpHMLZA9yynhZCT5Muy3iok7a87OPJ235ZBeZCrNiRoYdntuYQMVybvEY1OWAZDZD"
    },
    {
        "name": "The Stripes",
        "id": "104700399037138",
        "token": "EAAUqV1LyG8sBRpw7EHMPBNdprn3OpnLxRxjmvwHLwe4QdGTleGxZCatjd8VSqAweGdwFtHkpMmEeuU5XzdvVmVCEJtiwhHbvUtgXwMUBHUsstVc8SUlsLc5yBQoLI2bK7r1yToSVdZBmLWYqDlNHZCZAdNTQZClrq1btfzV93DZCKe0jkpOEZCsiclULZBfZA1xxQguNwVDLRRmDShR2TUwstxbAZAPwrcPcHaehbKpwZDZD"
    },
    {
        "name": "Rally Central",
        "id": "100314729449895",
        "token": "EAAUqV1LyG8sBRkM1DaUcN60ReZCbpYlObqmFm2VgYjIYdbuGQhZAo2PepsqLXZARNuSTrlZBAXkZCSVlkNOWFQ9PEReLT6SloMZBEQwRq1t91VcmvZCw4cQ77ZAiZCTOp2kbra8HNGIZCcNKlCwABKBFQ3ZBV3wiawhmujYzWft6ns7PeFaPEXiLiAwXyWq3JKQoQawly9hcHJ6lYfE6Sq8FM6tb76PZAYEV6lCZC9xv4KgZDZD"
    },
    {
        "name": "Gridiron Central",
        "id": "123872034331112",
        "token": "EAAUqV1LyG8sBRmBfNXDARae1z7qmHPubfZC7BZBNWAscYJgcgZAZBDhwqyq0l2rD7vRKObv9l608fZB9k0DO0hNKie9Sk85fiTFJUeZBfK5xV75QRKNnT47ZAdIvOwuZCic6S6Y5NG7F9clim3ZAe6zRPhfhzoh5SZBYmaaxZAt2NNIDweP2PTBgF2k6656fPIbLX7egHibpE7uotIhr0ERM0q3QhbOpS8nhssNMtXbpAZDZD"
    },
    {
        "name": "Hoop Radar",
        "id": "100390181377848",
        "token": "EAAUqV1LyG8sBRqkNIZCtwjuB5ZCyaruClHiLYi6tPAtpgVKQbV8D3r9smSYdhELjz07DZBRmrBLi82GXD1LFoWCdQNB5HV1nF5EdNozUHDb06bHUvwCc2kXSAetZCMCS1BfY5tNAYZByYDdzxh5RR0u3CfNh9gIAQ7XJ2FCvku7had6cyuHxShv4wCZBCnh9TYIGsxQpk1ITj0l1alpcHNENDTLql7YZCeGqwvCLAZDZD"
    }
]

def count_last_28_days(page):
    count = 0
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=28)
    
    url = f"{BASE_URL}/{page['id']}/posts"
    params = {
        "fields": "created_time,status_type",
        "access_token": page["token"],
        "limit": 100
    }
    
    while url:
        res = requests.get(url, params=params).json()
        
        if "data" not in res:
            print(f"❌ ERROR ({page['name']}):", res)
            break
        
        for post in res["data"]:
            post_time = datetime.strptime(post["created_time"], "%Y-%m-%dT%H:%M:%S%z")
            if post_time < cutoff_date:
                return count
            if post.get("status_type") == "added_video":
                count += 1
        
        url = res.get("paging", {}).get("next")
        params = {}  # Clear params for next page (uses full URL)
    
    return count

# --- MAIN ---
total = 0
print("🚀 Starting Facebook Video Count (Last 28 Days)\n")

for page in pages:
    print(f"Checking {page['name']}...")
    page_count = count_last_28_days(page)
    total += page_count
    print(f"🔥 Last 28 days: {page_count} videos\n")

print("="*50)
print(f"✅ TOTAL VIDEOS (ALL PAGES): {total}")
print("="*50)