const fs = require('fs');
const path = require('path');

let apiKey;
try {
    const dotenvContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const apiKeyMatch = dotenvContent.match(/GEMINI_API_KEY\s*=\s*(.*)/);
    if (apiKeyMatch) {
        apiKey = apiKeyMatch[1].trim().replace(/^["']|["']$/g, '');
    }
} catch (e) {
    // Ignore
}

if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY;
}

if (!apiKey) {
    console.error("GEMINI_API_KEY is not set");
    process.exit(1);
}

const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
const body = {
    model: "gemini-3.1-flash-tts-preview",
    input: "This is a test of the new Gemini interactions text to speech API.",
    response_format: {
        type: "audio"
    },
    generation_config: {
        speech_config: [
            {
                voice: "Kore"
            }
        ]
    }
};

fetch(url, {
    method: "POST",
    headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body),
})
    .then(async res => {
        console.log("Status:", res.status);
        const data = await res.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    })
    .catch(err => console.error(err));
