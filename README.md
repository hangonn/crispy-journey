# NZZ Coding Challenge

A React Native (Expo) app that hosts web pages in native UI, with a local fixture server that serves the pages.

## Setup

Clone the repository:

```bash
git clone https://github.com/hangonn/crispy-journey.git
cd crispy-journey
```

## Running

You need two terminals: one for the server and one for the app.

### 1. Start the server

```bash
cd fixture
node server.mjs
```

Leave this running.

### 2. Start the app

```bash
cd nzz-app
npm install
npx expo start --dev-client
```

The app runs as an Expo development client, so a development build must be installed on your device or emulator before it can connect.