# UK Charts to Spotify

A web application that scrapes UK Top 100 annual charts from the Official Charts Company website and creates Spotify playlists.

## Features

- 🎵 Scrapes UK Top 100 end-of-year singles charts for any year
- 🎧 Automatically matches tracks with Spotify
- 📱 Clean, responsive web interface
- 🔄 Caches chart data and Spotify matches for faster loading
- 🎯 Creates or updates Spotify playlists
- 🔐 Secure Spotify OAuth authentication

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd uk-charts-to-spotify
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Spotify App**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create a new app
   - Set redirect URI to `http://127.0.0.1:3000/callback`
   - Copy your Client ID and Client Secret

4. **Configure environment**
   ```bash
   cp env.example .env
   ```
   Edit `.env` and add your Spotify credentials:
   ```
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
   SESSION_SECRET=your_random_session_secret
   ```

5. **Start the application**
   ```bash
   npm start
   ```

6. **Open your browser**
   Navigate to `http://127.0.0.1:3000`

## Usage

1. **Login to Spotify** - Click the login button to authenticate with Spotify
2. **Select Year** - Choose any year to scrape the UK Top 100 chart
3. **Review Tracks** - Browse the scraped tracks with Spotify matches
4. **Create Playlist** - Create a new Spotify playlist or update an existing one

## Technology Stack

- **Backend**: Node.js, Express.js
- **Scraping**: Puppeteer, Cheerio
- **Frontend**: HTML, CSS, JavaScript
- **Authentication**: Spotify OAuth 2.0
- **Session Management**: express-session

## Project Structure

```
├── web-server.js          # Main Express server
├── src/
│   ├── liveChartScraper.js # Chart scraping logic
│   └── spotifyAPI.js      # Spotify API integration
├── public/
│   └── index.html         # Web interface
├── package.json           # Dependencies
└── env.example           # Environment template
```

## API Endpoints

- `GET /` - Main web interface
- `GET /api/auth/spotify` - Spotify OAuth login
- `GET /callback` - OAuth callback handler
- `GET /api/test-chart/:year` - Scrape chart for specific year
- `GET /api/check-playlist/:year` - Check for existing playlists
- `POST /api/create-playlist` - Create new Spotify playlist
- `POST /api/update-playlist` - Update existing playlist
- `POST /api/match-tracks` - Get Spotify matches for tracks

## License

MIT