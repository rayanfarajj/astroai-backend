# AstroAI Bots — Netlify Backend

Square subscription backend for the AstroAI Bots landing page.

## Folder Structure

```
astroai-backend/
├── netlify/
│   └── functions/
│       └── create-subscription.js   ← The backend function
├── netlify.toml                      ← Netlify config
└── package.json
```

## Deploy Steps

### 1. Upload to GitHub
- Go to github.com → New repository → name it "astroai-backend"
- Upload all these files (drag & drop works fine)

### 2. Connect to Netlify
- Go to app.netlify.com → "Add new site" → "Import an existing project"
- Connect GitHub → select "astroai-backend"
- Click Deploy (leave all settings as default)

### 3. Add Environment Variables (IMPORTANT — keeps your keys secret)
- In Netlify dashboard → Site → Site configuration → Environment variables
- Add these two variables:

  Key: SQUARE_ACCESS_TOKEN
  Value: EAAAl9cMgW8Jx4oTHYnF11t6OB1DgglixqPcg50VkO7cat_KMBmJaoc4Z3vnfg35

  Key: SQUARE_LOCATION_ID
  Value: L2KQJK78VN1E8

- Click Save → then go to Deploys → Trigger deploy

### 4. Get Your Function URL
After deploy, your function URL will be:
https://YOUR-SITE-NAME.netlify.app/.netlify/functions/create-subscription

Copy that URL and paste it into CONFIG.backendUrl in your landing page HTML.

## Testing
Use Square's test card in sandbox mode:
- Card number: 4111 1111 1111 1111
- Expiry: any future date
- CVV: any 3 digits
