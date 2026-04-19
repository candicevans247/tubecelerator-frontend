// server.js - Simplified (No Payments)
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const { bot } = require('./telegram-bot');
const { expireOldCredits } = require('./credits');

// Launch bot
bot.launch().then(() => {
  console.log('🤖 Bot launched from server.js');
}).catch((err) => {
  console.error('❌ Bot failed to launch:', err);
});

// --- Health Check Endpoint ---
app.get('/', (req, res) => {
  res.send('Syinth Telegram Bot is running 🚀');
});

// HTTP ENDPOINTS FOR WORKER NOTIFICATIONS
const { 
  notifyScriptForReview, 
  notifySegmentImageForReview, 
  notifySegmentUploadRequest,
  notifyAllImagesComplete, 
  notifyAudioForReview, 
  notifyVideoComplete 
} = require('./telegram-bot');

app.post('/notify/script-review', async (req, res) => {
  try {
    const { id, user_id, script } = req.body;
    await notifyScriptForReview({ id, user_id, script });
    res.json({ success: true, message: 'Script review notification sent' });
  } catch (error) {
    console.error('Script review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/segment-image-review', async (req, res) => {
  try {
    const { id, user_id, segmentIndex, totalSegments, segmentText, imageUrl, query } = req.body;
    await notifySegmentImageForReview({ id, user_id, segmentIndex, totalSegments, segmentText, imageUrl, query });
    res.json({ success: true, message: 'Segment image review notification sent' });
  } catch (error) {
    console.error('Segment image review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/segment-upload-request', async (req, res) => {
  try {
    const { id, user_id, segmentIndex, totalSegments, segmentText, query } = req.body;
    await notifySegmentUploadRequest({ id, user_id, segmentIndex, totalSegments, segmentText, query });
    res.json({ success: true, message: 'Upload request notification sent' });
  } catch (error) {
    console.error('Upload request notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/images-complete', async (req, res) => {
  try {
    const { id, user_id } = req.body;
    await notifyAllImagesComplete({ id, user_id });
    res.json({ success: true, message: 'Images complete notification sent' });
  } catch (error) {
    console.error('Images complete notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/audio-review', async (req, res) => {
  try {
    const { id, user_id, result_audio } = req.body;
    await notifyAudioForReview({ id, user_id, result_audio });
    res.json({ success: true, message: 'Audio review notification sent' });
  } catch (error) {
    console.error('Audio review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/video-complete', async (req, res) => {
  try {
    const { id, user_id, result_video } = req.body;
    await notifyVideoComplete({ id, user_id, result_video });
    res.json({ success: true, message: 'Video complete notification sent' });
  } catch (error) {
    console.error('Video complete notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log('💳 Manual Credit System Active (30-day expiration)');
});
