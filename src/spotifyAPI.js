import axios from 'axios';
import { URLSearchParams } from 'url';

export class SpotifyAPI {
  constructor(clientId, clientSecret, redirectUri = 'http://localhost:3000/callback') {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.baseURL = 'https://api.spotify.com/v1';
    this.accountsURL = 'https://accounts.spotify.com';
    this.accessToken = null;
    this.refreshToken = null;
    this.userId = null;
  }

  /**
   * Get authorization URL for user to authenticate
   * @param {Array} scopes - Array of Spotify scopes
   * @returns {string} Authorization URL
   */
  getAuthorizationURL(scopes = [
    'playlist-modify-public',
    'playlist-modify-private',
    'user-read-private',
    'user-read-email'
  ]) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      show_dialog: 'true'
    });

    return `${this.accountsURL}/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(`${this.accountsURL}/api/token`, 
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: this.redirectUri,
          client_id: this.clientId,
          client_secret: this.clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      
      console.log('✅ Successfully authenticated with Spotify');
      return response.data;
    } catch (error) {
      console.error('❌ Error exchanging code for token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get client credentials token (for app-only authentication)
   * @returns {Promise<string>} Access token
   */
  async getClientCredentialsToken() {
    try {
      const response = await axios.post(`${this.accountsURL}/api/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;
      console.log('✅ Successfully authenticated with Spotify (Client Credentials)');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Error getting client credentials token:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get headers for API requests
   * @returns {Object} Headers object
   */
  getHeaders() {
    if (!this.accessToken) {
      throw new Error('No access token available. Please authenticate first.');
    }

    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get current user information
   * @returns {Promise<Object>} User data
   */
  async getCurrentUser() {
    try {
      const response = await axios.get(`${this.baseURL}/me`, {
        headers: this.getHeaders()
      });

      this.userId = response.data.id;
      console.log(`✅ Authenticated as: ${response.data.display_name || response.data.id}`);
      return response.data;
    } catch (error) {
      console.error('❌ Error getting current user:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search for tracks on Spotify
   * @param {string} query - Search query
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} Array of track data or empty array if not found
   */
  async searchTracks(query, limit = 5) {
    try {
      const response = await axios.get(`${this.baseURL}/search`, {
        headers: this.getHeaders(),
        params: {
          q: query,
          type: 'track',
          limit: limit
        }
      });

      let tracks = response.data.tracks.items;
      
      // If we have good results, return them
      if (tracks.length > 0) {
        console.log(`🎵 Found ${tracks.length} results for: ${query}`);
        return tracks.map(track => ({
          id: track.id,
          uri: track.uri,
          name: track.name,
          artist: track.artists[0].name,
          artists: track.artists.map(a => a.name),
          album: track.album.name,
          album_artwork: track.album.images?.[0]?.url,
          duration_ms: track.duration_ms,
          preview_url: track.preview_url,
          external_urls: track.external_urls,
          popularity: track.popularity,
          explicit: track.explicit,
          album_release_date: track.album.release_date,
          album_type: track.album.album_type
        }));
      }

      // If no results, try a simpler search without quotes
      console.log(`🔄 No results for structured query, trying simpler search...`);
      const simpleQuery = query.replace(/track:"([^"]*)" artist:"([^"]*)"/, '$1 $2');
      
      const fallbackResponse = await axios.get(`${this.baseURL}/search`, {
        headers: this.getHeaders(),
        params: {
          q: simpleQuery,
          type: 'track',
          limit: limit
        }
      });

      tracks = fallbackResponse.data.tracks.items;
      if (tracks.length > 0) {
        console.log(`🎵 Found ${tracks.length} results for simple query: ${simpleQuery}`);
        return tracks.map(track => ({
          id: track.id,
          uri: track.uri,
          name: track.name,
          artist: track.artists[0].name,
          artists: track.artists.map(a => a.name),
          album: track.album.name,
          album_artwork: track.album.images?.[0]?.url,
          duration_ms: track.duration_ms,
          preview_url: track.preview_url,
          external_urls: track.external_urls,
          popularity: track.popularity,
          explicit: track.explicit,
          album_release_date: track.album.release_date,
          album_type: track.album.album_type
        }));
      }

      console.log(`❌ No results found for: ${query} or ${simpleQuery}`);
      return [];
    } catch (error) {
      console.error(`❌ Error searching for "${query}":`, error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Select the best match from multiple Spotify results
   * @param {Array} tracks - Array of track objects from search
   * @param {string} originalTitle - Original track title from chart
   * @param {string} originalArtist - Original artist from chart
   * @returns {number} Index of the best match
   */
  selectBestMatch(tracks, originalTitle, originalArtist) {
    if (!tracks || tracks.length === 0) return 0;
    if (tracks.length === 1) return 0;

    console.log(`🎯 Selecting best match for "${originalTitle}" by ${originalArtist} from ${tracks.length} options`);

    const scoredTracks = tracks.map((track, index) => {
      let score = 0;

      // Popularity score (0-100, higher is better)
      score += track.popularity || 0;

      // Title similarity bonus
      const titleSimilarity = this.calculateSimilarity(originalTitle.toLowerCase(), track.name.toLowerCase());
      score += titleSimilarity * 20; // Up to 20 points for title match

      // Artist similarity bonus
      const artistSimilarity = this.calculateSimilarity(originalArtist.toLowerCase(), track.artist.toLowerCase());
      score += artistSimilarity * 15; // Up to 15 points for artist match

      // Prefer studio albums over compilations/live albums
      if (track.album_type === 'album') {
        score += 10;
      } else if (track.album_type === 'single') {
        score += 5;
      }

      // Prefer non-explicit versions (for chart music)
      if (!track.explicit) {
        score += 5;
      }

      // Prefer more recent releases (within reason)
      if (track.album_release_date) {
        const releaseYear = parseInt(track.album_release_date.split('-')[0]);
        const currentYear = new Date().getFullYear();
        if (releaseYear >= currentYear - 10) { // Within last 10 years
          score += 3;
        }
      }

      // Penalty for obvious covers/alternatives (heuristic)
      const titleLower = track.name.toLowerCase();
      const artistLower = track.artist.toLowerCase();
      
      // Penalty for "cover", "tribute", "karaoke", "instrumental"
      if (titleLower.includes('cover') || titleLower.includes('tribute') || 
          titleLower.includes('karaoke') || titleLower.includes('instrumental') ||
          artistLower.includes('cover') || artistLower.includes('tribute')) {
        score -= 30;
      }

      // Penalty for "party", "dance", "remix" versions
      if (titleLower.includes('party') || titleLower.includes('dance') || 
          titleLower.includes('remix') || titleLower.includes('mix')) {
        score -= 20;
      }

      console.log(`  ${index}: "${track.name}" by ${track.artist} - Score: ${score.toFixed(1)} (Popularity: ${track.popularity})`);
      
      return { index, score, track };
    });

    // Sort by score (highest first)
    scoredTracks.sort((a, b) => b.score - a.score);
    
    const bestMatch = scoredTracks[0];
    console.log(`✅ Selected: "${bestMatch.track.name}" by ${bestMatch.track.artist} (Score: ${bestMatch.score.toFixed(1)})`);
    
    return bestMatch.index;
  }

  /**
   * Calculate string similarity using simple character overlap
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Similarity score between 0 and 1
   */
  calculateSimilarity(str1, str2) {
    // Remove common words and clean up
    const clean1 = str1.replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '').trim();
    const clean2 = str2.replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '').trim();
    
    // Simple character overlap calculation
    const longer = clean1.length > clean2.length ? clean1 : clean2;
    const shorter = clean1.length > clean2.length ? clean2 : clean1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} str1 - First string
   * @param {string} str2 - Second string
   * @returns {number} Edit distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Create a new playlist
   * @param {string} name - Playlist name
   * @param {string} description - Playlist description
   * @param {boolean} isPublic - Whether playlist should be public
   * @returns {Promise<string>} Playlist ID
   */
  async createPlaylist(name, description = '', isPublic = false) {
    try {
      if (!this.userId) {
        await this.getCurrentUser();
      }

      const response = await axios.post(`${this.baseURL}/users/${this.userId}/playlists`, {
        name,
        description,
        public: isPublic
      }, {
        headers: this.getHeaders()
      });

      const playlistId = response.data.id;
      console.log(`✅ Created playlist: ${name} (ID: ${playlistId})`);
      return playlistId;
    } catch (error) {
      console.error('❌ Error creating playlist:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Add tracks to a playlist
   * @param {string} playlistId - Playlist ID
   * @param {Array<string>} trackUris - Array of track URIs
   * @returns {Promise<Object>} Response data
   */
  async addTracksToPlaylist(playlistId, trackUris) {
    try {
      if (trackUris.length === 0) {
        console.log('⚠️ No tracks to add to playlist');
        return { snapshot_id: 'empty' };
      }

      // Spotify allows max 100 tracks per request
      const chunks = [];
      for (let i = 0; i < trackUris.length; i += 100) {
        chunks.push(trackUris.slice(i, i + 100));
      }

      let totalAdded = 0;
      for (const chunk of chunks) {
        const response = await axios.post(`${this.baseURL}/playlists/${playlistId}/tracks`, {
          uris: chunk
        }, {
          headers: this.getHeaders()
        });
        totalAdded += chunk.length;
      }

      console.log(`✅ Added ${totalAdded} tracks to playlist`);
      return { snapshot_id: 'success', total_added: totalAdded };
    } catch (error) {
      console.error('❌ Error adding tracks to playlist:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get playlist information
   * @param {string} playlistId - Playlist ID
   * @param {string} accessToken - Access token (optional, uses instance token if not provided)
   * @returns {Promise<Object>} Playlist data
   */
  async getPlaylist(playlistId, accessToken = null) {
    try {
      const headers = accessToken ? 
        { 'Authorization': `Bearer ${accessToken}` } : 
        this.getHeaders();
        
      const response = await axios.get(`${this.baseURL}/playlists/${playlistId}`, {
        headers
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error getting playlist:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search for playlists (searches all public playlists)
   * @param {string} query - Search query
   * @param {string} accessToken - Access token (optional, uses instance token if not provided)
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} Array of playlists
   */
  async searchPlaylists(query, accessToken = null, limit = 20) {
    try {
      const headers = accessToken ? 
        { 'Authorization': `Bearer ${accessToken}` } : 
        this.getHeaders();
        
      const response = await axios.get(`${this.baseURL}/search`, {
        headers,
        params: {
          q: query,
          type: 'playlist',
          limit: limit
        }
      });

      return response.data.playlists.items;
    } catch (error) {
      console.error('❌ Error searching playlists:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get current user's playlists
   * @param {string} accessToken - Access token (optional, uses instance token if not provided)
   * @param {number} limit - Number of results to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of user's playlists
   */
  async getUserPlaylists(accessToken = null, limit = 50, offset = 0) {
    try {
      const headers = accessToken ? 
        { 'Authorization': `Bearer ${accessToken}` } : 
        this.getHeaders();
        
      const response = await axios.get(`${this.baseURL}/me/playlists`, {
        headers,
        params: {
          limit: limit,
          offset: offset
        }
      });

      return response.data.items;
    } catch (error) {
      console.error('❌ Error getting user playlists:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Clear all tracks from a playlist
   * @param {string} playlistId - Playlist ID
   * @param {string} accessToken - Access token (optional, uses instance token if not provided)
   * @returns {Promise<void>}
   */
  async clearPlaylist(playlistId, accessToken = null) {
    try {
      const headers = accessToken ? 
        { 'Authorization': `Bearer ${accessToken}` } : 
        this.getHeaders();
        
      // First, get all tracks in the playlist
      const playlist = await this.getPlaylist(playlistId, accessToken);
      const totalTracks = playlist.tracks.total;
      
      if (totalTracks === 0) {
        console.log('📝 Playlist is already empty');
        return;
      }
      
      // Get all track URIs
      const trackUris = [];
      let offset = 0;
      const limit = 100;
      
      while (offset < totalTracks) {
        const response = await axios.get(`${this.baseURL}/playlists/${playlistId}/tracks`, {
          headers,
          params: { limit, offset }
        });
        
        const tracks = response.data.items.map(item => ({ uri: item.track.uri }));
        trackUris.push(...tracks);
        offset += limit;
      }
      
      // Remove all tracks
      if (trackUris.length > 0) {
        await axios.delete(`${this.baseURL}/playlists/${playlistId}/tracks`, {
          headers,
          data: { tracks: trackUris }
        });
        console.log(`🗑️ Cleared ${trackUris.length} tracks from playlist`);
      }
      
    } catch (error) {
      console.error('❌ Error clearing playlist:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Search for multiple tracks and return their URIs
   * @param {Array<Object>} chartData - Array of chart entries with searchQuery
   * @param {number} limit - Number of results per search
   * @returns {Promise<Array<string>>} Array of found track URIs
   */
  async searchMultipleTracks(chartData, limit = 5) {
    const foundTracks = [];
    const notFoundTracks = [];

    console.log(`🔍 Searching for ${chartData.length} tracks on Spotify...`);

    for (const [index, entry] of chartData.entries()) {
      console.log(`Searching ${index + 1}/${chartData.length}: ${entry.searchQuery}`);
      
      const tracks = await this.searchTracks(entry.searchQuery, limit);
      
      if (tracks && tracks.length > 0) {
        // Use smart selection to pick the best match
        const bestMatchIndex = this.selectBestMatch(tracks, entry.title, entry.artist);
        const selectedTrack = tracks[bestMatchIndex];
        foundTracks.push(selectedTrack.uri);
        console.log(`✅ Selected: ${selectedTrack.name} by ${selectedTrack.artist}`);
      } else {
        notFoundTracks.push(entry);
        console.log(`❌ No match found for: ${entry.title} by ${entry.artist}`);
      }

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n📊 Search Results:`);
    console.log(`✅ Found: ${foundTracks.length} tracks`);
    console.log(`❌ Not found: ${notFoundTracks.length} tracks`);

    if (notFoundTracks.length > 0) {
      console.log('\n❌ Tracks not found on Spotify:');
      notFoundTracks.forEach(track => {
        console.log(`  - ${track.title} by ${track.artist}`);
      });
    }

    return foundTracks;
  }

  /**
   * Set access token directly (for when you already have one)
   * @param {string} token - Access token
   */
  setAccessToken(token) {
    this.accessToken = token;
  }

  /**
   * Set user ID directly (for when you already have it)
   * @param {string} userId - User ID
   */
  setUserId(userId) {
    this.userId = userId;
  }
}
