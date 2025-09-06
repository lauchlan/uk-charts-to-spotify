#!/usr/bin/env node

import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import { SpotifyAPI } from './src/spotifyAPI.js';
import { LiveChartScraper } from './src/liveChartScraper.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'uk-charts-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Initialize services
const spotifyAPI = new SpotifyAPI(
  process.env.SPOTIFY_CLIENT_ID,
  process.env.SPOTIFY_CLIENT_SECRET,
  process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/callback`
);

const yearChartScraper = new LiveChartScraper();

// Middleware to refresh Spotify tokens
async function refreshSpotifyTokenIfNeeded(req, res, next) {
  console.log(`🔍 User check - Session ID: ${req.sessionID}`);
  console.log(`🔍 Has access token: ${!!req.session.spotifyAccessToken}`);
  console.log(`🔍 Has refresh token: ${!!req.session.spotifyRefreshToken}`);
  
  if (req.session.spotifyAccessToken && req.session.spotifyRefreshToken) {
    try {
      // Check if we have a token timestamp and if it's been more than 50 minutes (tokens expire in 1 hour)
      const now = Date.now();
      const tokenAge = now - (req.session.tokenTimestamp || 0);
      const tokenExpiryTime = 50 * 60 * 1000; // 50 minutes
      
      console.log(`🔍 Token age: ${Math.round(tokenAge / 1000 / 60)} minutes`);
      
      if (tokenAge > tokenExpiryTime) {
        // Token is likely expired or close to expiring, refresh it
        console.log('🔄 Refreshing Spotify token (proactive refresh)...');
        const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: req.session.spotifyRefreshToken
          })
        });
        
        if (refreshResponse.ok) {
          const tokenData = await refreshResponse.json();
          req.session.spotifyAccessToken = tokenData.access_token;
          req.session.tokenTimestamp = now;
          
          // Save the new token
          req.session.save((err) => {
            if (err) console.error('Session save error during refresh:', err);
            else console.log('✅ Session saved after token refresh');
          });
          
          console.log('✅ Spotify token refreshed successfully');
        } else {
          const errorData = await refreshResponse.json().catch(() => ({}));
          console.log('❌ Failed to refresh Spotify token:', errorData);
          
          // If refresh token is invalid/expired, clear all tokens
          if (refreshResponse.status === 400 || refreshResponse.status === 401) {
            console.log('🔄 Refresh token expired, clearing all tokens');
            req.session.spotifyAccessToken = null;
            req.session.spotifyRefreshToken = null;
            req.session.tokenTimestamp = null;
            req.session.spotifyUserId = null;
            req.session.spotifyUser = null;
          }
        }
      } else {
        console.log('✅ Token is still valid, no refresh needed');
      }
    } catch (error) {
      console.error('Error refreshing Spotify token:', error);
    }
  } else {
    console.log('🔍 No tokens found in session');
  }
  next();
}

// Apply token refresh middleware to API routes
app.use('/api', refreshSpotifyTokenIfNeeded);

// Routes

/**
 * Serve the main web interface
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Get Spotify authorization URL
 */
app.get('/api/auth/spotify', (req, res) => {
  try {
    const authURL = spotifyAPI.getAuthorizationURL();
    res.redirect(authURL);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * Handle Spotify callback
 */
app.get('/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      console.error('Spotify authorization error:', error);
      return res.redirect('/?error=' + encodeURIComponent(error));
    }
    
    if (!code) {
      return res.redirect('/?error=' + encodeURIComponent('No authorization code received'));
    }
    
    // Exchange code for token
    const tokenData = await spotifyAPI.exchangeCodeForToken(code);
    const user = await spotifyAPI.getCurrentUser();
    
    // Store in session
    req.session.spotifyAccessToken = spotifyAPI.accessToken;
    req.session.spotifyRefreshToken = spotifyAPI.refreshToken;
    req.session.spotifyUserId = spotifyAPI.userId;
    req.session.spotifyUser = user;
    req.session.tokenTimestamp = Date.now();
    
    console.log(`✅ User authenticated: ${user.display_name || user.id}`);
    console.log(`🔑 Session ID: ${req.sessionID}`);
    
    // Save session explicitly
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
      } else {
        console.log('✅ Session saved successfully');
      }
      res.redirect('/?success=true');
    });
    
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

/**
 * Get current user info
 */
app.get('/api/user', (req, res) => {
  console.log(`🔍 User check - Session ID: ${req.sessionID}`);
  console.log(`🔍 Has access token: ${!!req.session.spotifyAccessToken}`);
  
  if (!req.session.spotifyAccessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({
    user: req.session.spotifyUser,
    authenticated: true
  });
});

/**
 * Logout
 */
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
});

/**
 * Get available years for charts
 */
app.get('/api/years', (req, res) => {
  try {
    const years = yearChartScraper.getAvailableYears();
    res.json({ years });
  } catch (error) {
    console.error('Error getting years:', error);
    res.status(500).json({ error: 'Failed to get available years' });
  }
});

/**
 * Create playlist from year chart
 */
app.post('/api/create-playlist', async (req, res) => {
  try {
    const { year, playlistName, isPublic = false, matchedTracks } = req.body;
    
    // Check authentication
    if (!req.session.spotifyAccessToken) {
      return res.status(401).json({ error: 'Not authenticated with Spotify' });
    }
    
    // Validate year
    if (!yearChartScraper.isValidYear(year)) {
      return res.status(400).json({ error: 'Invalid year. Must be between 2000 and current year.' });
    }
    
    // Set up Spotify API with session tokens
    spotifyAPI.setAccessToken(req.session.spotifyAccessToken);
    spotifyAPI.setUserId(req.session.spotifyUserId);
    
    console.log(`🎵 Creating playlist for year ${year}...`);
    
    // Validate that matched tracks are provided
    if (!matchedTracks || !Array.isArray(matchedTracks) || matchedTracks.length === 0) {
      return res.status(400).json({ error: 'No matched tracks provided' });
    }
    
    // Extract track URIs from the matched tracks
    const trackUris = matchedTracks
      .filter(track => track.spotifyUri) // Only include tracks with Spotify URIs
      .map(track => track.spotifyUri);
    
    if (trackUris.length === 0) {
      return res.status(400).json({ error: 'No valid Spotify tracks found in matched tracks' });
    }
    
    console.log(`🎵 Creating playlist with ${trackUris.length} matched tracks`);
    
    // Create playlist
    const defaultName = `UK Top 100 - ${year}`;
    const finalPlaylistName = playlistName || defaultName;
    const description = `UK Official End-of-Year Singles Chart Top 100 for ${year} - Created automatically`;
    
    const playlistId = await spotifyAPI.createPlaylist(finalPlaylistName, description, isPublic);
    
    // Add tracks to playlist
    const result = await spotifyAPI.addTracksToPlaylist(playlistId, trackUris);
    
    // Get final playlist info
    const playlistInfo = await spotifyAPI.getPlaylist(playlistId);
    
    res.json({
      success: true,
      playlist: {
        id: playlistId,
        name: finalPlaylistName,
        description: description,
        url: `https://open.spotify.com/playlist/${playlistId}`,
        totalTracks: playlistInfo.tracks.total,
        public: playlistInfo.public,
        year: year,
        tracksFound: trackUris.length,
        tracksSearched: matchedTracks.length
      }
    });
    
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ 
      error: 'Failed to create playlist',
      details: error.message 
    });
  }
});

/**
 * Test chart scraping for a specific year
 */
app.get('/api/test-chart/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    
    if (!yearChartScraper.isValidYear(year)) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    
    console.log(`🧪 Testing chart scraping for year ${year}...`);
    const chartData = await yearChartScraper.getYearChartData(year, 100); // Test with full chart
    
    res.json({
      success: true,
      year: year,
      tracksFound: chartData.length,
      tracks: chartData // Return all tracks
    });
    
  } catch (error) {
    console.error('Error testing chart:', error);
    res.status(500).json({ 
      error: 'Failed to test chart scraping',
      details: error.message 
    });
  }
});

/**
 * Check for existing playlists for a specific year
 */
app.get('/api/check-playlist/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    
    if (!yearChartScraper.isValidYear(year)) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    
    // If not authenticated, return empty result
    if (!req.session.spotifyAccessToken) {
      return res.json({
        success: true,
        year: year,
        existingPlaylists: [],
        hasExisting: false,
        authenticated: false
      });
    }
    
    console.log(`🔍 Checking for existing playlists for year ${year}...`);
    
    // Search for playlists with the year in the name
    const searchQueries = [
      `UK Top 100 - ${year}`,
      `UK Charts ${year}`,
      `Top 100 ${year}`,
      `${year} UK Charts`
    ];
    
    // Get user's playlists instead of searching all public playlists
    let userPlaylists = [];
    try {
      userPlaylists = await spotifyAPI.getUserPlaylists(req.session.spotifyAccessToken, 50);
      console.log(`Found ${userPlaylists.length} user playlists`);
    } catch (error) {
      console.warn('Failed to get user playlists:', error.message);
    }
    
    // Filter user's playlists by the expected naming patterns
    const existingPlaylists = userPlaylists.filter(playlist => {
      const playlistName = playlist.name.toLowerCase();
      return searchQueries.some(query => 
        playlistName.includes(query.toLowerCase())
      );
    });
    
    console.log(`Found ${existingPlaylists.length} matching playlists in user's collection`);
    
    // Remove duplicates and filter by exact naming pattern
    const expectedPlaylistName = `UK Top 100 - ${year}`;
    console.log(`Looking for playlist with exact name: "${expectedPlaylistName}"`);
    const uniquePlaylists = existingPlaylists
      .filter(playlist => playlist && playlist.id && playlist.name) // Remove null/undefined playlists
      .filter((playlist, index, self) => 
        index === self.findIndex(p => p.id === playlist.id)
      )
      .filter(playlist => 
        playlist.name === expectedPlaylistName || // Exact match
        playlist.name.toLowerCase() === expectedPlaylistName.toLowerCase() // Case-insensitive exact match
      );
    
    res.json({
      success: true,
      year: year,
      existingPlaylists: uniquePlaylists,
      hasExisting: uniquePlaylists.length > 0,
      authenticated: true
    });
    
  } catch (error) {
    console.error('Error checking playlists:', error);
    res.status(500).json({ 
      error: 'Failed to check existing playlists',
      details: error.message 
    });
  }
});

/**
 * Get Spotify matches for chart tracks
 */
app.post('/api/match-tracks', async (req, res) => {
  try {
    if (!req.session.spotifyAccessToken) {
      return res.status(401).json({ 
        error: 'Not authenticated with Spotify',
        authenticated: false 
      });
    }

    const { tracks } = req.body;
    
    if (!tracks || !Array.isArray(tracks)) {
      return res.status(400).json({ error: 'Invalid tracks data' });
    }

    console.log(`🎵 Matching ${tracks.length} tracks with Spotify...`);
    
    const matches = [];
    const batchSize = 10; // Process tracks in batches of 10
    
    // Set the access token on the SpotifyAPI instance once
    spotifyAPI.accessToken = req.session.spotifyAccessToken;
    
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);
      console.log(`🎵 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(tracks.length/batchSize)} (${batch.length} tracks)`);
      
      for (const track of batch) {
        try {
          const spotifyTracks = await spotifyAPI.searchTracks(
            track.searchQuery, 
            5 // limit - get up to 5 results
          );
          
          // Use smart selection to pick the best match
          const bestMatchIndex = spotifyTracks.length > 0 ? 
            spotifyAPI.selectBestMatch(spotifyTracks, track.title, track.artist) : null;
          
          matches.push({
            position: track.position,
            title: track.title,
            artist: track.artist,
            searchQuery: track.searchQuery,
            spotifyMatches: spotifyTracks,
            selectedMatch: bestMatchIndex,
            hasMatch: spotifyTracks.length > 0
          });
          
        } catch (error) {
          console.warn(`Failed to match track "${track.searchQuery}":`, error.message);
          matches.push({
            position: track.position,
            title: track.title,
            artist: track.artist,
            searchQuery: track.searchQuery,
            spotifyMatches: [],
            selectedMatch: null,
            hasMatch: false,
            error: error.message
          });
        }
      }
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < tracks.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    res.json({
      success: true,
      matches: matches,
      totalTracks: tracks.length,
      matchedTracks: matches.filter(m => m.hasMatch).length
    });
    
  } catch (error) {
    console.error('Error matching tracks:', error);
    res.status(500).json({ 
      error: 'Failed to match tracks with Spotify',
      details: error.message 
    });
  }
});

/**
 * Update an existing playlist with selected tracks
 */
app.post('/api/update-playlist', async (req, res) => {
  try {
    const { playlistId, year, selectedTracks, replaceAll = false } = req.body;
    
    if (!req.session.spotifyAccessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    if (!playlistId || !year || !selectedTracks || !Array.isArray(selectedTracks)) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log(`🔄 Updating playlist ${playlistId} for year ${year}...`);
    
    // Extract track URIs from the selected tracks (already matched by frontend)
    const trackUris = selectedTracks
      .filter(track => track.spotifyUri) // Only include tracks with Spotify URIs
      .map(track => track.spotifyUri);
    
    if (trackUris.length === 0) {
      return res.status(400).json({ error: 'No valid Spotify tracks found in selection' });
    }
    
    console.log(`🎵 Adding ${trackUris.length} tracks to playlist...`);
    
    // Clear existing tracks if replaceAll is true
    if (replaceAll) {
      await spotifyAPI.clearPlaylist(playlistId, req.session.spotifyAccessToken);
    }
    
    // Add tracks to playlist
    await spotifyAPI.addTracksToPlaylist(playlistId, trackUris, req.session.spotifyAccessToken);
    
    // Get updated playlist info
    const playlist = await spotifyAPI.getPlaylist(playlistId, req.session.spotifyAccessToken);
    
    res.json({
      success: true,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        url: playlist.external_urls.spotify,
        tracksFound: trackUris.length,
        tracksSearched: selectedTracks.length,
        year: year,
        totalTracks: playlist.tracks.total
      }
    });
    
  } catch (error) {
    console.error('Error updating playlist:', error);
    res.status(500).json({ 
      error: 'Failed to update playlist',
      details: error.message 
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * User authentication status endpoint
 */
app.get('/api/user-status', (req, res) => {
  const hasAccessToken = !!req.session.spotifyAccessToken;
  const hasRefreshToken = !!req.session.spotifyRefreshToken;
  const tokenAge = req.session.tokenTimestamp ? Date.now() - req.session.tokenTimestamp : null;
  
  res.json({
    authenticated: hasAccessToken,
    hasRefreshToken: hasRefreshToken,
    userId: req.session.spotifyUserId,
    user: req.session.spotifyUser,
    tokenAge: tokenAge ? Math.round(tokenAge / 1000 / 60) : null, // in minutes
    sessionId: req.sessionID
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
/**
 * Update selected match for a track
 */
app.post('/api/select-match', async (req, res) => {
  try {
    const { position, matchIndex } = req.body;
    
    if (typeof position === 'undefined' || typeof matchIndex === 'undefined') {
      return res.status(400).json({ error: 'Position and matchIndex are required' });
    }

    // Store the selection in session or return success
    // For now, we'll just return success - the frontend will handle the selection
    res.json({ 
      success: true, 
      position: position, 
      selectedMatch: matchIndex 
    });
    
  } catch (error) {
    console.error('Error selecting match:', error);
    res.status(500).json({ error: 'Failed to select match' });
  }
});

// Fetch more matches for a specific track
app.post('/api/fetch-more-matches', async (req, res) => {
  try {
    const { position, title, artist, searchQuery } = req.body;
    
    if (!req.session.spotifyAccessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    if (!position || !title || !artist || !searchQuery) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log(`🔍 Fetching more matches for position ${position}: ${title} by ${artist}`);
    console.log(`🔍 Search query: "${searchQuery}"`);
    
    // Search for more tracks with a higher limit
    const additionalTracks = await spotifyAPI.searchTracks(searchQuery, 10);
    console.log(`🔍 Found ${additionalTracks.length} additional tracks`);
    
    if (additionalTracks.length > 0) {
      console.log(`✅ Found ${additionalTracks.length} additional matches for position ${position}`);
      res.json({
        success: true,
        additionalMatches: additionalTracks,
        position: position
      });
    } else {
      console.log(`❌ No additional matches found for position ${position}`);
      res.json({
        success: true,
        additionalMatches: [],
        position: position
      });
    }
    
  } catch (error) {
    console.error('Error fetching more matches:', error);
    res.status(500).json({
      error: 'Failed to fetch more matches',
      details: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 UK Charts Web Server running on http://localhost:${PORT}`);
  console.log(`📱 Open your browser and visit: http://localhost:${PORT}`);
  console.log(`🎵 Ready to create Spotify playlists from UK charts!`);
  
  // Check if Spotify credentials are configured
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.log(`⚠️  Warning: Spotify credentials not configured!`);
    console.log(`   Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your .env file`);
  }
});

export default app;
