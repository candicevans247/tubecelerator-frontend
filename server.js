// server.js - Simplified (No Payments)
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const { bot } = require('./telegram-bot');
const { expireOldCredits } = require('./credits');

// ✅ Use webhooks instead of polling (serverless-compatible)
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
const WEBHOOK_PATH = '/telegram-webhook';

if (WEBHOOK_DOMAIN) {
  const webhookUrl = `https://${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;
  
  console.log(`🔗 Setting up webhook: ${webhookUrl}`);
  
  bot.telegram.setWebhook(webhookUrl)
    .then(() => {
      console.log('✅ Webhook set successfully');
    })
    .catch((err) => {
      console.error('❌ Failed to set webhook:', err);
    });
  
  // Handle incoming webhook requests
  app.use(bot.webhookCallback(WEBHOOK_PATH));
  
  console.log('🤖 Bot running in webhook mode (serverless)');
} else {
  console.warn('⚠️ WEBHOOK_DOMAIN not set, falling back to polling (not serverless)');
  bot.launch().then(() => {
    console.log('🤖 Bot launched in polling mode');
  });
}

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

// ✅ ADD THIS DEBUG ENDPOINT
app.get('/debug/connections', (req, res) => {
  const handles = process._getActiveHandles();
  const requests = process._getActiveRequests();
  
  const handleTypes = {};
  handles.forEach(h => {
    const type = h.constructor.name;
    handleTypes[type] = (handleTypes[type] || 0) + 1;
  });
  
  res.json({
    totalHandles: handles.length,
    totalRequests: requests.length,
    handleBreakdown: handleTypes,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log('💳 Manual Credit System Active (30-day expiration)');
});
