const express = require('express');
const { spawn } = require('child_process');
const bodyParser = require('body-parser');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const request = require('request-promise');
const cheerio = require('cheerio');
const ua = require('random-useragent');
const { CronJob } = require('cron');
const { JSDOM } = require('jsdom');
const helmet = require('helmet');
const { setTimeout } = require('timers');
const { HttpsAgent } = require('agentkeepalive');
const pm2 = require('pm2');
const path = require('path');
const multer = require('multer'); 
const http = require('http');
const https = require('https');



const app = express();
const port = 8000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(multer().any()); // Enable file uploads


app.set('view engine', 'ejs');

function logEvent(event) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${event}\n`;

  fs.appendFileSync(LOG_FILE, logMessage);
}

// Initialize PM2
pm2.connect(function (error) {
  if (error) {
    const errorMessage = `Failed to connect to PM2: ${error}`;
    console.error(errorMessage)
    logEvent(errorMessage)
    process.exit(1);
  }

  // Start or restart your application with PM2
  pm2.start({
    script: 'xx.js', // Replace with your entry point file name
    name: 'Scraper V2', // Replace with a name for your application
    exec_mode: 'cluster', // Cluster mode for better performance and scalability
    instances: 'max', // Use all available CPU cores
    max_memory_restart: '1G', // Restart the process if it exceeds 1GB memory
  }, function (error, apps) {
    if (error) {
      const errorMessage = `Failed to start application with PM2: ${error}`;
      console.error(errorMessage)
      logEvent(errorMessage)
      pm2.disconnect(); // Disconnect PM2 on error
      process.exit(1);
    }

    console.log('Application started with PM2.');
    pm2.disconnect(); // Disconnect PM2 after starting the application
  });
});

const EXCLUDED_DOMAINS = ['google', 'youtube', 'wikipedia', 'cpanel', 'facebook', 'twitter'];
let cache = {};

const user_agent = ua.getRandom();

// Configure logging
const LOG_FILE = 'app.log';

// Create an empty log file if it doesn't exist
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
}

function clearLogFile() {
  fs.writeFileSync(LOG_FILE, '');
}

// Create a scheduler
const clearLogJob = new CronJob('0 0 * * *', clearLogFile); // Schedule the clearing of log file every day at midnight
clearLogJob.start();

const keepAliveAgent = new HttpsAgent({
  maxSockets: 30, // Adjust the maximum number of sockets as per your needs
  maxFreeSockets: 10, // Adjust the maximum number of free sockets as per your needs
  timeout: 60000, // Adjust the socket idle timeout as per your needs
});

//function fetchWebPage(url) {
  // Check if the data exists in the cache
//  if (url in cache) {
//    return cache[url];
//  }

//  const headers = {
//    'User-Agent': user_agent,
//  };

//  const options = {
//    uri: url, // Use `uri` instead of `url` in the options object
//    headers: headers,
//  };

//  return request
//    .get(options)
//    .then((response) => {
      // Store the fetched data in the cache
//      cache[url] = response;
//      return response;
//    })
//    .catch((error) => {
//      const errorMessage = `Error fetching web page: ${error}`;
//      console.error(errorMessage);
//      logEvent(errorMessage);
//      throw error;
//    });
//}


function fetchWebPage(url) {
  // Check if the data exists in the cache
  if (url in cache) {
    return cache[url];
  }

  const headers = {
    'User-Agent': user_agent,
  };

  const options = {
    headers: headers,
    agent: keepAliveAgent,
    gzip: true,
  };

  return new Promise((resolve, reject) => {
    if (url.startsWith('https://')) {
      // Try HTTPS request
      https.get(url, options, (response) => {
        if (response.statusCode === 200) {
          let responseData = '';

          response.on('data', (chunk) => {
            responseData += chunk;
          });

          response.on('end', () => {
            // Store the fetched data in the cache
            cache[url] = responseData;
            resolve(responseData);
          });
        } else if (response.statusCode === 403 && response.headers['server'] === 'cloudflare') {
          // Cloudflare challenge page detected, resolve with 'skip' value
          resolve('skip');
        } else {
          // Other error, reject with the error
          reject(new Error(`Error fetching web page: ${response.statusCode} ${response.statusMessage}`));
        }
      }).on('error', (error) => {
        // Error with HTTPS request, try HTTP request
        http.get(url, options, (response) => {
          if (response.statusCode === 200) {
            let responseData = '';

            response.on('data', (chunk) => {
              responseData += chunk;
            });

            response.on('end', () => {
              // Store the fetched data in the cache
              cache[url] = responseData;
              resolve(responseData);
            });
          } else if (response.statusCode === 403 && response.headers['server'] === 'cloudflare') {
            // Cloudflare challenge page detected, resolve with 'skip' value
            resolve('skip');
          } else {
            // Other error, reject with the error
            reject(new Error(`Error fetching web page: ${response.statusCode} ${response.statusMessage}`));
          }
        }).on('error', (error) => {
          // Error with HTTP request, reject with the error
          reject(new Error(`Error fetching web page: ${error.message}`));
        });
      });
    } else {
      // Try HTTP request
      http.get(url, options, (response) => {
        if (response.statusCode === 200) {
          let responseData = '';

          response.on('data', (chunk) => {
            responseData += chunk;
          });

          response.on('end', () => {
            // Store the fetched data in the cache
            cache[url] = responseData;
            resolve(responseData);
          });
        } else if (response.statusCode === 403 && response.headers['server'] === 'cloudflare') {
          // Cloudflare challenge page detected, resolve with 'skip' value
          resolve('skip');
        } else {
          // Other error, reject with the error
          reject(new Error(`Error fetching web page: ${response.statusCode} ${response.statusMessage}`));
        }
      }).on('error', (error) => {
        // Error with HTTP request, reject with the error
        reject(new Error(`Error fetching web page: ${error.message}`));
      });
    }
  });
}


function scrapeData(htmlContent) {
  const $ = cheerio.load(htmlContent);
  const title = $('title').text() || '';

  // Exclude <a>, <button>, <link>, <script>, <form>, <i>, and <li> tags
  const excludedTags = [
    'a',
    'button',
    'link',
    'script',
    'form',
    'i',
    'input',
    'video',
    'image',
    'textarea',
    'img',
    'vid',
    'iframe',
    'footer',
    'form',
  ];
  for (const tag of excludedTags) {
    $(tag).remove();
  }

  // Find the body tag and extract its contents
  const bodyContent = $('body').text() || '';
  return { title, bodyContent };
}

function processData(text) {
  let processedText = text.replace(/http\S+/g, '');
  processedText = processedText.replace(/\s+/g, ' ');
  processedText = processedText.replace(/([^\w\s]|_)\1+/g, '');
  processedText = processedText.trim();
  return processedText;
}

function saveData(url, title, processedText, folderName, outputFormat) {
  const parsedUrl = new URL(url);
  const domain = parsedUrl.hostname;
  const folderPath = `${__dirname}/${folderName}`; // Use __dirname to specify th>
  const filePath = `${folderPath}/${domain}.${outputFormat}`;

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const data =
    outputFormat === 'json'
      ? JSON.stringify({ title, content: processedText })
      : processedText;

  fs.writeFileSync(filePath, data);

  delete cache[url];

  // Delete the folder after 3 minutes
  setTimeout(() => {
    if (fs.existsSync(folderPath)) {
      fs.rm(folderPath, { recursive: true }, (err) => {
        if (err) {
          const errorMessage = `Error deleting folder: ${err}`;
          console.error(errorMessage);
          logEvent(errorMessage); // Log the error
        } else {
          console.log(`Deleted folder: ${folderPath}`);
        }
      });
    }
  }, 10 * 60 * 1000); // 3 minutes in milliseconds
}


const CACHE_JAR_RESET_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

function clearCachePeriodically() {
  setInterval(() => {
    cache = {};
  }, CACHE_JAR_RESET_INTERVAL); // Clear cache every 10 minutes
}

// Helmet Middleware for Security
app.use(helmet());

// Error handlers
app.use(function (err, req, res, next) {
  console.error(err.stack);
  res.status(500).send('An error occurred. Please check the logs for more details.');
});

app.get('/file', (req, res) => {
  res.render('file.ejs');
});

app.post('/file', (req, res) => {
  const files = req.files;
  const outputFormat = req.body.output_format;

  if (files.length === 0 || !files[0].originalname.endsWith('.txt')) {
    res.status(400).send('Invalid file format. Please upload a .txt file.');
    return;
  }

  const file = files[0];
  const lines = file.buffer.toString('utf-8').split('\n');
  const folderName = uuidv4().replace(/-/g, '').slice(0, 10);

  let urlCount = 0; // Track the number of processed URLs

  lines.forEach((url) => {
    if (url.trim() !== '') {
      // Skip empty URLs
      if (urlCount >= 50) {
        res.status(400).send('Only 50 URLs are allowed. Skipping remaining URLs.');
        return; // Exit the loop
      }

      processUrl(url, outputFormat, folderName);
      urlCount++;
    }
  });

  res.status(200).json({
    status: 'success',
    message: 'Data scraped successfully.',
    download_url: `/download/${folderName}`,
    Notice: `Data folder "${folderName}" will be deleted after 10  minutes starting from now`,
    prosessed_urls: `${urlCount}`,
  });
});

app.get('/bulk', (req, res) => {
  res.render('bulk.ejs');
});

function isValidURL(url) {
  try {
    new URL(url);
    return true;
  } catch (error) {
    return false;
  }
}


app.post('/bulk', async (req, res) => {
  try {
    const topic = req.body.topic;
    const outputFormat = req.body.output_format;
    const websitesNumber = parseInt(req.body.websites_number); // Parse the number of websites as an integer
    const folderName = uuidv4().replace(/-/g, '').slice(0, 10) + '_' + topic.replace(/ /g, '_');
    fs.mkdirSync(folderName, { recursive: true });
    const searchResults = [];

    for (let page = 1; page <= 20; page++) {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(topic)}&start=${page * 10}`;
      const headers = { 'User-Agent': user_agent };

      try {
        const htmlContent = await fetchWebPage(searchUrl);
        const dom = new JSDOM(htmlContent);
        const { document } = dom.window;
        const links = document.querySelectorAll('a[href]');

        links.forEach((link) => {
          const actualUrl = decodeURIComponent(link.href.substring(link.href.indexOf('http'), link.href.indexOf('&sa=')));

          if (isValidURL(actualUrl) && !EXCLUDED_DOMAINS.some((domain) => actualUrl.includes(domain))) {
            if (actualUrl.endsWith('.pdf')) {
              console.log(`Skipped URL: ${actualUrl} (PDF)`);
            } else {
              searchResults.push(actualUrl);
            }
          }
        });
      } catch (error) {
        const errorMessage = `Error fetching or processing URL: ${searchUrl}, ${error}`
        console.error(errorMessage)
        logEvent(errorMessage)
      }

      if (searchResults.length >= websitesNumber) {
        break; // Exit the loop if the desired number of websites is reached
      }
    }
    const processedUrls = [];
    const folderPath = `${__dirname}/${folderName}`; 

      for (const resultUrl of searchResults) {
      if (!processedUrls.includes(resultUrl)) {
        try {
          if (resultUrl.endsWith('.pdf')) {
            console.log(`Skipped URL: ${resultUrl} (PDF)`);
            continue; // Skip PDF URLs
          }

          // Fetch and process the URL
          const htmlContent = await fetchWebPage(resultUrl);
          if (htmlContent === 'skip') {
            console.log(`Skipped URL: ${resultUrl} (Cloudflare challenge)`);
            continue; // Skip Cloudflare challenge URLs
          }

//          const htmlContent = await fetchWebPage(resultUrl);
          const { title, bodyContent } = scrapeData(htmlContent);
          const processedText = processData(bodyContent);
          saveData(resultUrl, title, processedText, folderName, outputFormat);
          processedUrls.push(resultUrl);

          // Count the number of files in the folder
          const filesInFolder = fs.readdirSync(folderPath);
          if (filesInFolder.length >= 20) {
            break; // Exit the loop if 15 files are saved
          }
        } catch (error) {
          console.error(`Error processing URL: ${resultUrl}, ${error}`);
        }
      }
    }
    const response = {
      status: 'success',
      message: 'Data scraped successfully.',
      download_url: `/download/${folderName}`,
      Notice: `Data folder "${folderName}" will be deleted after 10 minutes starting from now`
    };
    res.status(200).json(response);

    // Delete the folder after 3 minutes
    setTimeout(() => {
      deleteFolder(folderName);
    }, 3 * 60 * 1000); // 3 minutes in milliseconds

  } catch (error) {
    const errorMessage = `Error in bulk route: ${error}`
    console.error(errorMessage);
    logEvent(errorMessage)
    res.status(500).send('An error occurred. Please check the logs for more details.');
  }
});

function deleteFolder(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true });
    console.log(`Deleted folder: ${folderPath}`);
  }
}


app.get('/download/:folderName', (req, res) => {
  const folderPath = req.params.folderName;
  const zipPath = `${folderPath}.zip`;

  if (fs.existsSync(folderPath) && fs.lstatSync(folderPath).isDirectory()) {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');

    output.on('close', () => {
      deleteFolder(folderPath);

      res.status(200).download(zipPath, (err) => {
        if (err) {
          const errorMessage = `Error downloading file: ${err}`;
          console.error(errorMessage);
          logEvent(errorMessage);
          res.status(500).send('An error occurred while downloading the file.');
        }
        fs.unlinkSync(zipPath);
      });
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  } else {
    res.status(404).send('Data folder not found.');
  }
});

function processUrl(url, outputFormat, folderName) {
  fetchWebPage(url)
    .then((htmlContent) => {
      const { title, bodyContent } = scrapeData(htmlContent);
      const processedText = processData(bodyContent);
      saveData(url, title, processedText, folderName, outputFormat);
    })
    .catch((error) => {
      const errorMessage = `Error processing URL: ${url}, ${error}`;
      console.error(errorMessage);
      logEvent(errorMessage);
    });
}


app.get('/logs', (req, res) => {
  try {
    const logs = fs.readFileSync(LOG_FILE, 'utf-8');
    res.status(200).send(logs);
  } catch (error) {
    const errorMessage = `Error reading logs: ${error}`;
    console.error(errorMessage)
    logEvent(errorMessage);
    res.status(500).send('An error occurred while reading the logs.');
  }
});

app.post('/clear_logs', (req, res) => {
  try {
    clearLogFile();
    res.status(200).send('Log file cleared successfully.');
  } catch (error) {
    const errorMessage = `Error clearing log file: ${error}`;
    console.error(errorMessage)
    logEvent(errorMessage);
    res.status(500).send('An error occurred while clearing the log file.');
  }
});


process.on('SIGINT', () => {
  console.log('App is shutting down...');
  // Delete all files and folders except specific ones
  const filesToKeep = ['xx.js', 'app.js', 'node_modules', 'package-lock.json', 'package.json', 'views', 'app.log'];
  fs.readdirSync(__dirname).forEach((file) => {
    if (!filesToKeep.includes(file)) {
      deleteFileOrFolder(file);
    }
  });
  process.exit(0);
});

function deleteFileOrFolder(name) {
  const fileOrFolderPath = path.join(__dirname, name);
  if (fs.lstatSync(fileOrFolderPath).isDirectory()) {
    fs.rmdirSync(fileOrFolderPath, { recursive: true });
    console.log(`Deleted folder: ${fileOrFolderPath}`);
  } else {
    fs.unlinkSync(fileOrFolderPath);
    console.log(`Deleted file: ${fileOrFolderPath}`);
  }
}


// Error handling middleware
app.use(function (err, req, res, next) {
  console.error(err.stack);
  logEvent(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`App is listening on port ${port}`);
});

