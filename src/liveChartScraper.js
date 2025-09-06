import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';

export class LiveChartScraper {
  constructor() {
    this.baseUrl = 'https://www.officialcharts.com/charts/end-of-year-singles-chart';
  }

  /**
   * Get the URL for a specific year's end-of-year chart
   * @param {number} year - The year to get the chart for
   * @returns {string} URL for the year's chart
   */
  getYearChartUrl(year) {
    const dateStr = `${year}0101`;
    return `${this.baseUrl}/${dateStr}/37501/`;
  }

  /**
   * Scrape the end-of-year chart for a specific year using live data
   * @param {number} year - The year to scrape
   * @param {number} limit - Number of songs to scrape (default: 100)
   * @returns {Promise<Array>} Array of song objects with title, artist, and position
   */
  async scrapeYearChart(year, limit = 100) {
    try {
      console.log(`🎵 Scraping UK End-of-Year Singles Chart for ${year}...`);
      
      const url = this.getYearChartUrl(year);
      console.log(`📡 URL: ${url}`);
      
      // Try multiple approaches
      let chartData = null;
      
      // Approach 1: Try to extract JSON data from the page
      try {
        chartData = await this.extractFromJSONData(url, limit);
        if (chartData && chartData.length > 0) {
          console.log(`✅ Successfully extracted ${chartData.length} songs from JSON data`);
          return chartData;
        }
      } catch (error) {
        console.log(`⚠️ JSON extraction failed: ${error.message}`);
      }
      
      // Approach 2: Use Puppeteer to scrape the rendered page
      try {
        chartData = await this.scrapeWithPuppeteer(url, limit);
        if (chartData && chartData.length > 0) {
          console.log(`✅ Successfully scraped ${chartData.length} songs with Puppeteer`);
          return chartData;
        }
      } catch (error) {
        console.log(`⚠️ Puppeteer scraping failed: ${error.message}`);
      }
      
      // Approach 3: Try with Cheerio and axios
      try {
        chartData = await this.scrapeWithCheerio(url, limit);
        if (chartData && chartData.length > 0) {
          console.log(`✅ Successfully scraped ${chartData.length} songs with Cheerio`);
          return chartData;
        }
      } catch (error) {
        console.log(`⚠️ Cheerio scraping failed: ${error.message}`);
      }
      
      throw new Error('All scraping methods failed');
      
    } catch (error) {
      console.error(`❌ Error scraping ${year} UK charts:`, error.message);
      throw error;
    }
  }

  /**
   * Extract chart data from JSON embedded in the page
   */
  async extractFromJSONData(url, limit) {
    const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(3000);
    
    const chartData = await page.evaluate((limit) => {
      try {
        // Look for JSON data in script tags
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const content = script.textContent;
          if (content && content.includes('chartItems')) {
            // Try to extract the chart data
            const match = content.match(/"chartItems":\s*\[(.*?)\]/s);
            if (match) {
              try {
                const jsonStr = '[' + match[1] + ']';
                const items = JSON.parse(jsonStr);
                
                const tracks = [];
                for (let i = 0; i < Math.min(items.length, limit); i++) {
                  const item = items[i];
                  if (item.title && item.artist) {
                    tracks.push({
                      position: i + 1,
                      title: item.title.trim().toUpperCase(),
                      artist: item.artist.trim().toUpperCase(),
                      searchQuery: `${item.title.trim()} ${item.artist.trim()}`
                    });
                  }
                }
                return tracks;
              } catch (e) {
                console.log('JSON parsing failed:', e);
              }
            }
          }
        }
        return [];
      } catch (error) {
        console.log('JSON extraction error:', error);
        return [];
      }
    }, limit);
    
    await browser.close();
    return chartData;
  }

  /**
   * Scrape using Puppeteer with DOM selectors
   */
  async scrapeWithPuppeteer(url, limit) {
    const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(5000);
    
    const chartData = await page.evaluate((limit) => {
      const tracks = [];
      
      // Try multiple selectors for chart items
      const selectors = [
        '.chart-item',
        '.track-info',
        '[class*="chart"] [class*="item"]',
        '[class*="track"]',
        '.drupal-block-chart-list .track-info'
      ];
      
      let chartItems = [];
      for (const selector of selectors) {
        chartItems = document.querySelectorAll(selector);
        if (chartItems.length > 0) {
          console.log(`Found ${chartItems.length} items with selector: ${selector}`);
          break;
        }
      }
      
      if (chartItems.length === 0) {
        // Fallback: look for any elements that might contain track info
        const allElements = document.querySelectorAll('*');
        for (const element of allElements) {
          const text = element.textContent;
          if (text && text.includes('SOMEBODY THAT I USED TO KNOW') && text.includes('GOTYE')) {
            console.log('Found potential chart data in element:', element);
            // Try to extract from this element
            const parent = element.closest('[class*="chart"], [class*="track"], [class*="item"]');
            if (parent) {
              chartItems = parent.querySelectorAll('*');
              break;
            }
          }
        }
      }
      
      for (let i = 0; i < Math.min(chartItems.length, limit); i++) {
        const item = chartItems[i];
        const text = item.textContent.trim();
        
        // Look for patterns like "1. SONG TITLE - ARTIST"
        const match = text.match(/^(\d+)\.?\s*(.+?)\s*[-–]\s*(.+)$/m);
        if (match) {
          const position = parseInt(match[1]);
          const title = match[2].trim().toUpperCase();
          const artist = match[3].trim().toUpperCase();
          
          if (position && title && artist && position <= limit) {
            tracks.push({
              position,
              title,
              artist,
              searchQuery: `${title} ${artist}`
            });
          }
        }
      }
      
      // Sort by position
      tracks.sort((a, b) => a.position - b.position);
      
      console.log(`Extracted ${tracks.length} tracks`);
      return tracks;
    }, limit);
    
    await browser.close();
    return chartData;
  }

  /**
   * Scrape using Cheerio and axios
   */
  async scrapeWithCheerio(url, limit) {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    const tracks = [];
    
    // Try to find chart items (excluding advertisements)
    const selectors = [
      '.chart-item:not(.chart-ad)',
      '.track-info',
      '[class*="chart"] [class*="item"]:not([class*="ad"])',
      '[class*="track"]'
    ];
    
    let chartItems = [];
    for (const selector of selectors) {
      chartItems = $(selector);
      if (chartItems.length > 0) {
        console.log(`Found ${chartItems.length} items with selector: ${selector}`);
        break;
      }
    }
    
    chartItems.each((index, element) => {
      if (index >= limit) return false;
      
      const $element = $(element);
      
      // Extract position from .position strong
      const positionEl = $element.find('.position strong');
      const position = positionEl.text().trim();
      
      // Extract title from .chart-name span and remove prefixes
      const titleEl = $element.find('.chart-name span');
      let title = titleEl.text().trim();
      
      // Remove "New" prefix
      if (title.startsWith('New')) {
        title = title.substring(3).trim();
      }
      
      // Remove "RE" prefix (re-entry indicator)
      if (title.startsWith('RE')) {
        title = title.substring(2).trim();
      }
      
      // Extract artist from .chart-artist span
      const artistEl = $element.find('.chart-artist span');
      const artist = artistEl.text().trim();
      
      if (position && title && artist) {
        tracks.push({
          position: parseInt(position),
          title: title.toUpperCase(),
          artist: artist.toUpperCase(),
          searchQuery: `${title.toUpperCase()} ${artist.toUpperCase()}`
        });
      }
    });
    
    // Sort by position
    tracks.sort((a, b) => a.position - b.position);
    
    console.log(`Extracted ${tracks.length} tracks with Cheerio`);
    return tracks;
  }

  /**
   * Get chart data with fallback methods
   * @param {number} year - The year to scrape
   * @param {number} limit - Number of songs to scrape
   * @returns {Promise<Array>} Array of song objects
   */
  async getYearChartData(year, limit = 100) {
    try {
      return await this.scrapeYearChart(year, limit);
    } catch (error) {
      console.error('❌ Live scraping failed');
      throw new Error(`Live scraping failed for ${year}: ${error.message}`);
    }
  }

  /**
   * Get available years for end-of-year charts
   * @returns {Array<number>} Array of available years
   */
  getAvailableYears() {
    const currentYear = new Date().getFullYear();
    const years = [];
    
    for (let year = 2000; year <= currentYear; year++) {
      years.push(year);
    }
    
    return years.reverse(); // Most recent first
  }

  /**
   * Validate if a year is available for scraping
   * @param {number} year - Year to validate
   * @returns {boolean} Whether the year is valid
   */
  isValidYear(year) {
    const currentYear = new Date().getFullYear();
    return year >= 2000 && year <= currentYear;
  }
}
