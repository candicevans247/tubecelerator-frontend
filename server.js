// server.js
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;

const PLAN_CREDITS_MAP = {
  'PLN_416140knw3ctjk4': 1500,  // Starter - $25/month
  'PLN_y1cut9m3uwa6tfc': 3000,  // Growth - $49/month
  'PLN_sue4dhlbfal42in': 6000,  // Pro - $119/month
};

const { addCredits, setCredits } = require('./credits'); 
const { getUserSession, setUserSession } = require('./sessions');
const { 
  bot, 
  resumeAfterPaymentFlow, 
  notifyScriptForReview, 
  notifySegmentImageForReview, 
  notifySegmentUploadRequest,
  notifySegmentVideoForReview, 
  notifyAllImagesComplete, 
  notifyAllVideosComplete,      
  notifyAudioForReview, 
  notifyVideoComplete 
} = require('./telegram-bot');

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

app.post('/notify/segment-video-review', async (req, res) => {
  try {
    const { id, user_id, segmentIndex, totalSegments, segmentText, videoUrl, query } = req.body;
    await notifySegmentVideoForReview({ id, user_id, segmentIndex, totalSegments, segmentText, videoUrl, query });
    res.json({ success: true, message: 'Video review notification sent' });
  } catch (error) {
    console.error('Video review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/videos-complete', async (req, res) => {
  try {
    const { id, user_id } = req.body;
    await notifyAllVideosComplete({ id, user_id });
    res.json({ success: true, message: 'Videos complete notification sent' });
  } catch (error) {
    console.error('Videos complete notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Generate Paystack Subscription Link ---
app.get('/paystack/subscribe/:planCode', async (req, res) => {
  const planCode = req.params.planCode;
  const telegramId = req.query.tg;
  const email = `user${telegramId}@syinth.com`;

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: 0,
        plan: planCode,
        metadata: { telegramId },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const authUrl = response.data.data.authorization_url;
    console.log(`✅ Generated Paystack subscription link for ${telegramId}: ${authUrl}`);

    res.redirect(authUrl);
  } catch (err) {
    console.error('❌ Paystack init error:', err.response?.data || err.message);
    res.status(500).send('Failed to create subscription link');
  }
});

// --- Paystack Webhook ---
app.post('/paystack-webhook', async (req, res) => {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(400).send('Invalid signature');
  }

  const event = req.body;
  console.log('📥 Incoming Paystack event:', event.event, JSON.stringify(event, null, 2));

  if (
    event.event === 'invoice.payment_success' ||
    event.event === 'charge.success'
  ) {
    const planCode =
      event.data?.plan?.plan_code ||
      event.data?.subscription?.plan?.plan_code;

    const telegramId =
      event.data?.metadata?.telegramId ||
      event.data?.customer?.metadata?.telegramId;

    const subscriptionCode =
      event.data?.subscription?.subscription_code ||
      event.data?.subscription_code;

    const credits = PLAN_CREDITS_MAP[planCode] || 0;

    if (credits > 0 && telegramId) {
      try {
        // ✅ USE IDEMPOTENT VERSION with unique transaction ID from Paystack
        const transactionId = event.data?.reference || event.data?.id || `webhook_${Date.now()}`;
        
        const result = await setCredits(telegramId, credits, transactionId, 'payment');
        
        if (result.alreadyProcessed) {
          console.log(`✅ Webhook ${transactionId} already processed - no duplicate credits added`);
          return res.sendStatus(200); // Still return success to Paystack
        }

        // ✅ Update session in DB
        const session = await getUserSession(telegramId);
        if (session) {
          const expiration = new Date(event.data.next_payment_date || Date.now() + 30 * 86400000);

          await setUserSession(telegramId, {
            ...session,
            waitingForPayment: false,  
            resumeAfterPayment: false,
            resumeData: null,
            credits,
            plan: session?.selectedPlan || 'Starter',
            expiration: expiration.toISOString(),
            paystackSubscriptionId: subscriptionCode,
          });
        }

        // 🔄 Auto-resume if the user had a pending submission
        const resumeData = session?.resumeAfterPayment || session?.resumeData;
        if (resumeData) {
          const fakeCtx = {
            chat: { id: Number(telegramId) },
            from: { id: Number(telegramId), username: 'user' },
            reply: (text, extra) => bot.telegram.sendMessage(telegramId, text, extra),
          };

          await resumeAfterPaymentFlow(fakeCtx, resumeData);
        }

        // ✅ Notify user via Telegram
        try {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: telegramId,
            text: `✅ Payment successful! You've received ${credits} credit${credits > 1 ? 's' : ''}. Your video creation will now resume.`,
          });
          console.log(`📬 Notified ${telegramId}`);
        } catch (err) {
          console.error(`❌ Failed to notify ${telegramId}`, err.message);
        }

        console.log(`✅ Subscription payment processed for ${telegramId}`);
        
      } catch (error) {
        console.error('❌ Error processing payment:', error);
        return res.status(500).send('Error processing payment');
      }
    }
  }

  res.sendStatus(200);
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
