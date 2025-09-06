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
   * @returns {Promise<Object|null>} Track data or null if not found
   */
  async searchTracks(query, limit = 1) {
    try {
      const response = await axios.get(`${this.baseURL}/search`, {
        headers: this.getHeaders(),
        params: {
          q: query,
          type: 'track',
          limit: limit
        }
      });

      const tracks = response.data.tracks.items;
      if (tracks.length > 0) {
        const track = tracks[0];
        console.log(`🎵 Found: ${track.name} by ${track.artists[0].name}`);
        return {
          id: track.id,
          uri: track.uri,
          name: track.name,
          artist: track.artists[0].name,
          album: track.album.name,
          album_artwork: track.album.images?.[0]?.url,
          duration_ms: track.duration_ms,
          preview_url: track.preview_url,
          external_urls: track.external_urls
        };
      }

      console.log(`❌ No results found for: ${query}`);
      return null;
    } catch (error) {
      console.error(`❌ Error searching for "${query}":`, error.response?.data || error.message);
      return null;
    }
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
   * Search for playlists
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
  async searchMultipleTracks(chartData, limit = 1) {
    const foundTracks = [];
    const notFoundTracks = [];

    console.log(`🔍 Searching for ${chartData.length} tracks on Spotify...`);

    for (const [index, entry] of chartData.entries()) {
      console.log(`Searching ${index + 1}/${chartData.length}: ${entry.searchQuery}`);
      
      const track = await this.searchTracks(entry.searchQuery, limit);
      
      if (track) {
        foundTracks.push(track.uri);
      } else {
        notFoundTracks.push(entry);
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
