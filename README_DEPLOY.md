# BIST Analyst Deployment Guide

This application is ready to be deployed to **Firebase** or **Vercel**.

## 🚀 Deployment to Firebase (Next.js Frameworks)

Next.js support in Firebase is handled through the Firebase Frameworks feature.

### 1. Prerequisites
- Create a Firebase Project at [console.firebase.google.com](https://console.firebase.google.com)
- Enable **Firestore Database** in test mode or production mode.
- Enable **Hosting**.
- Enable **Cloud Functions**.

### 2. Configure Environment Variables
You must set your API keys in the Firebase console or via CLI:
```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Set the following in your `.env.local` or Cloud environment:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- ... (other Firebase config fields)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

### 3. Login and Deploy
```bash
# Login to Firebase
firebase login

# Initialize (if not already done, usually choose Next.js)
# Select your project ID
firebase init hosting

# Deploy
firebase deploy
```

## ☁️ Persistent Scanner Note
In serverless environments like Firebase/Vercel, the background scanner (`setInterval`) will only run while the function instance is warm. For a 24/7 background scanner, you should set up a **Cron Job** (using GitHub Actions or Cloud Scheduler) to trigger the `/api/bist/background` endpoint every hour with a POST request.

```bash
# Example Cron Trigger (POST)
curl -X POST https://your-app.web.app/api/bist/background
```

## ⚡ Caching
The application now uses **Firestore** as its primary cache when deployed. This ensures that market data and scanner results are shared across all serverless instances and survive cold starts.
