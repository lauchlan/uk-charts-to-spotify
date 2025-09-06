import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';

export class LiveChartScraper {
  constructor() {
    this.baseUrl = 'https://www.officialcharts.com/charts/end-of-year-singles-chart';
    
    // Hardcoded URL mappings for each year (no consistent pattern)
    this.yearUrlMap = {
      2024: '20240101/37501/',
      2023: '20220101/37501/',
      2022: '20210101/37501/',
      2021: '20200101/37501-0/',
      2020: '20200101/37501/',
      2019: '20190101/37501/',
      2018: '20180101/37501/',
      2017: '20160101/37501/',
      2016: '20160108/37501/',
      2015: '20150104/37501/',
      2014: '20140105/37501/',
      2013: '20130106/37501/',
      2012: '20120108/37501/',
      2011: '20110109/37501/',
      2010: '20100110/37501/',
      2009: '20090104/37501/',
      2008: '20080106/37501/',
      2007: '20070107/37501/',
      2006: '20060108/37501/',
      2005: '20050103/37501/',
      2004: '20040104/37501/'
    };
  }

  /**
   * Get the URL for a specific year's end-of-year chart
   * @param {number} year - The year to get the chart for
   * @returns {string} URL for the year's chart
   */
  getYearChartUrl(year) {
    const urlPath = this.yearUrlMap[year];
    if (!urlPath) {
      throw new Error(`No URL mapping found for year ${year}. Supported years: ${Object.keys(this.yearUrlMap).join(', ')}`);
    }
    return `${this.baseUrl}/${urlPath}`;
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
                      searchQuery: `track:"${item.title.trim()}" artist:"${item.artist.trim()}"`
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
              searchQuery: `track:"${title}" artist:"${artist}"`
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
    
    // Find chart items using the correct selector
    const chartItems = $('.chart-item');
    console.log(`Found ${chartItems.length} chart items`);
    
    chartItems.each((index, element) => {
      
      const $element = $(element);
      
      // Extract position from .position strong
      const positionEl = $element.find('.position strong');
      const position = positionEl.text().trim();
      
      if (!position) {
        console.log(`❌ No position found for chart item ${index}`);
        console.log(`🔍 Position element HTML:`, positionEl.html());
        console.log(`🔍 Chart item HTML:`, $element.html().substring(0, 300) + '...');
      }
      
      // Extract track title and artist from description block anchor spans
      const descriptionBlock = $element.find('.description.block');
      let title = '', artist = '';
      
      if (descriptionBlock.length > 0) {
        console.log(`🔍 Found description block for position ${position}`);
        
        // Get all anchor tags within the description block
        const anchors = descriptionBlock.find('a');
        console.log(`🔍 Found ${anchors.length} anchor tags in description block`);
        
        if (anchors.length >= 2) {
          // First anchor should be the track title
          const titleAnchor = anchors.eq(0);
          const titleSpans = titleAnchor.find('span');
          if (titleSpans.length > 0) {
            title = titleSpans.last().text().trim();
            console.log(`🔍 Title from first anchor: "${title}"`);
          }
          
          // Second anchor should be the artist
          const artistAnchor = anchors.eq(1);
          const artistSpans = artistAnchor.find('span');
          if (artistSpans.length > 0) {
            artist = artistSpans.last().text().trim();
            console.log(`🔍 Artist from second anchor: "${artist}"`);
          }
        } else {
          console.log(`❌ Expected 2 anchor tags, found ${anchors.length}`);
        }
      } else {
        console.log(`❌ No description block found for position ${position}`);
        console.log(`🔍 Chart item HTML:`, $element.html().substring(0, 200) + '...');
      }
      
      if (position && title && artist) {
        tracks.push({
          position: parseInt(position),
          title: title.toUpperCase(),
          artist: artist.toUpperCase(),
          searchQuery: `track:"${title.toUpperCase()}" artist:"${artist.toUpperCase()}"`
        });
      }
    });
    
    // Sort by position
    tracks.sort((a, b) => a.position - b.position);
    
    // Check for missing positions
    const foundPositions = tracks.map(t => t.position);
    const missingPositions = [];
    for (let i = 1; i <= limit; i++) {
      if (!foundPositions.includes(i)) {
        missingPositions.push(i);
      }
    }
    
    if (missingPositions.length > 0) {
      console.log(`⚠️ Missing positions: ${missingPositions.join(', ')}`);
    }
    
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
