import requests

url = "https://a-gotham.sportskeeda.com/social-media-bank/search"

params = {
    "query": "ronaldo",
    "page": 1,
    "size": 12,
    "imageProvider": "getty",
}

cookies = {
    "fw_ID": "5794690",
    "fw_secret": "$2y$10$YyrVPEAtxGT1T5FRh4G2XezTegYFwEvCHcV5NPkekdx1qfhA1aAsi",
    # Replace with your actual CSRF token
    "csrf_token": "YOUR_CSRF_TOKEN",
}

headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
    "Referer": "https://www.sportskeeda.com/",
}

response = requests.get(
    url,
    params=params,
    cookies=cookies,
    headers=headers,
    timeout=30,
)

print("Status:", response.status_code)

try:
    print(response.json())
except ValueError:
    print(response.text)