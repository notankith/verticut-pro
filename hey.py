from playwright.sync_api import sync_playwright

url = "https://share.google/HL09p6Hmnb61YO9ki"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto(url, wait_until="networkidle")

    # Wait until at least 2 images exist
    page.wait_for_function(
        "() => document.querySelectorAll('img').length >= 2"
    )

    images = page.locator("img").evaluate_all(
        "(imgs) => imgs.map(img => img.src)"
    )

    image_url = images[1]

    print("Image URL:")
    print(image_url)

    browser.close()