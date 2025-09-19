// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Enable CORS for your frontend domain
app.use(cors({
    origin: ['https://songlify.lol', 'http://localhost:3000', 'http://127.0.0.1:5500']
}));

app.use(express.json());

// ACRCloud configuration from environment variables
const acrcloudConfig = {
    host: 'identify-ap-southeast-1.acrcloud.com',
    access_key: process.env.ACRCLOUD_ACCESS_KEY,
    access_secret: process.env.ACRCLOUD_ACCESS_SECRET,
    endpoint: '/v1/identify'
};

// Generate HMAC-SHA1 signature
function generateSignature(stringToSign, secret) {
    return crypto.createHmac('sha1', secret)
                 .update(stringToSign, 'utf8')
                 .digest('base64');
}

// Music identification endpoint
app.post('/api/identify', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        if (!acrcloudConfig.access_key || !acrcloudConfig.access_secret) {
            return res.status(500).json({ error: 'ACRCloud API keys not configured' });
        }

        console.log('Received audio file:', {
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });

        // Prepare ACRCloud request
        const timestamp = Math.floor(Date.now() / 1000);
        const stringToSign = `POST\n${acrcloudConfig.endpoint}\n${acrcloudConfig.access_key}\naudio\n1\n${timestamp}`;
        const signature = generateSignature(stringToSign, acrcloudConfig.access_secret);

        // Create form data
        const formData = new FormData();
        formData.append('sample', req.file.buffer, {
            filename: req.file.originalname || 'audio.wav',
            contentType: req.file.mimetype || 'audio/wav'
        });
        formData.append('sample_bytes', req.file.size.toString());
        formData.append('access_key', acrcloudConfig.access_key);
        formData.append('data_type', 'audio');
        formData.append('signature_version', '1');
        formData.append('signature', signature);
        formData.append('timestamp', timestamp.toString());

        console.log('Making request to ACRCloud...');

        // Make request to ACRCloud
        const apiUrl = `https://${acrcloudConfig.host}${acrcloudConfig.endpoint}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });

        const data = await response.json();
        console.log('ACRCloud response:', data);

        if (!response.ok) {
            console.error('ACRCloud API error:', data);
            return res.status(response.status).json({ 
                error: 'ACRCloud API error',
                details: data 
            });
        }

        // Parse and return result
        const result = parseACRCloudResponse(data);
        res.json(result);

    } catch (error) {
        console.error('Identification error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

function parseACRCloudResponse(data) {
    if (data && data.status && data.status.code === 0 && data.metadata && data.metadata.music && data.metadata.music.length > 0) {
        const music = data.metadata.music[0];
        
        return {
            success: true,
            song: {
                title: music.title || 'Unknown Title',
                artist: music.artists && music.artists.length > 0 ? music.artists[0].name : 'Unknown Artist',
                album: music.album ? music.album.name : 'Unknown Album',
                year: music.release_date ? music.release_date.substring(0, 4) : 'Unknown',
                confidence: Math.round(music.score * 100) || 95,
                duration: music.duration_ms ? Math.floor(music.duration_ms / 1000) : null,
                spotify_url: music.external_metadata?.spotify?.track?.external_urls?.spotify,
                youtube_url: music.external_metadata?.youtube?.vid ? `https://www.youtube.com/watch?v=${music.external_metadata.youtube.vid}` : null,
                apple_url: music.external_metadata?.apple_music?.url,
                cover_art: music.album?.artwork_url_500 || music.album?.artwork_url,
                preview_url: music.external_metadata?.spotify?.track?.preview_url,
                isReal: true
            }
        };
    } else if (data && data.status && data.status.code === 1001) {
        return {
            success: false,
            error: 'No music found in database',
            code: 1001
        };
    } else if (data && data.status && data.status.code === 3001) {
        return {
            success: false,
            error: 'Invalid access key',
            code: 3001
        };
    } else if (data && data.status && data.status.code === 3003) {
        return {
            success: false,
            error: 'Rate limit exceeded',
            code: 3003
        };
    } else {
        return {
            success: false,
            error: 'Unknown response format',
            data: data
        };
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        acrcloud_configured: !!(acrcloudConfig.access_key && acrcloudConfig.access_secret)
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);
    console.log(`ACRCloud configured: ${!!(acrcloudConfig.access_key && acrcloudConfig.access_secret)}`);
});
