// server.js - Simplified (No Payments)
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const { bot } = require('./telegram-bot');
const { expireOldCredits, getCredits, useCredits, addCredits } = require('./credits');

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

// ============================================
// 💰 CREDIT RECONCILIATION
// ============================================

// Receives reconciliation data from worker and applies the credit op.
// Worker does the math, frontend does the credit operation.
//
// Returns the reconciliation object with applied/amountApplied filled in,
// ready to be forwarded to notifyVideoComplete for the user message.

async function applyReconciliation(reconciliation) {
  const {
    user_id,
    job_id,
    difference,
    estimatedMinutes,
    actualMinutes,
    estimatedCredits,
    actualCredits,
    totalAudioSeconds
  } = reconciliation;

  // ── No change ─────────────────────────────────────────────────────────────
  if (difference === 0) {
    console.log(`💰 [reconciler] Job ${job_id} — no credit adjustment needed`);
    return {
      ...reconciliation,
      action:        'none',
      applied:       true,
      amountApplied: 0,
      reason:        'Estimated and actual match exactly'
    };
  }

  // ── Refund — video shorter than estimated ─────────────────────────────────
 if (difference > 0) {
  const transactionId = `reconcile_refund_job${job_id}_${Date.now()}`;
  const result = await addCredits(
    String(user_id),
    difference,
    transactionId,
    'duration_reconcile_refund',
    true  // ← preserveExpiry = true, don't extend their plan
  );

    if (result.alreadyProcessed) {
      console.warn(
        `⚠️ [reconciler] Refund already processed for job ${job_id}`
      );
      return {
        ...reconciliation,
        action:        'refund',
        applied:       false,
        amountApplied: 0,
        reason:        'Already processed'
      };
    }

    console.log(
      `✅ [reconciler] Refunded ${difference}cr ` +
      `to user ${user_id} for job ${job_id}`
    );

    return {
      ...reconciliation,
      action:        'refund',
      applied:       true,
      amountApplied: difference,
      reason:        `Video ${estimatedMinutes - actualMinutes} min shorter than estimated`
    };
  }

  // ── Surcharge — video longer than estimated ───────────────────────────────
  if (difference < 0) {
    const surchargeAmount = Math.abs(difference);

    const creditInfo     = await getCredits(String(user_id));
    const currentBalance = creditInfo.amount;

    let amountToCharge = surchargeAmount;
    let partial        = false;

    // Charge what they have if balance is insufficient
    if (currentBalance < surchargeAmount) {
      console.warn(
        `⚠️ [reconciler] User ${user_id} has ${currentBalance}cr ` +
        `but surcharge is ${surchargeAmount}cr — partial charge`
      );
      amountToCharge = currentBalance;
      partial        = true;
    }

    if (amountToCharge > 0) {
      const result = await useCredits(String(user_id), amountToCharge);

      if (!result.success) {
        throw new Error(result.reason || 'useCredits failed');
      }

      console.log(
        `✅ [reconciler] Surcharged ${amountToCharge}cr ` +
        `from user ${user_id} for job ${job_id} ` +
        `(remaining: ${result.remaining})`
      );
    }

    return {
      ...reconciliation,
      action:        'surcharge',
      applied:       true,
      partial:       partial,
      amountApplied: amountToCharge,
      reason:        partial
        ? `Partial surcharge — low balance (needed ${surchargeAmount}, charged ${amountToCharge})`
        : `Video ${actualMinutes - estimatedMinutes} min longer than estimated`
    };
  }
}


// ============================================
// HTTP ENDPOINTS FOR WORKER NOTIFICATIONS
// ============================================

// ✅ Import ALL notification functions — including the two new video ones
const { 
  notifyScriptForReview, 
  notifySegmentsReady, 
  notifySegmentImageForReview, 
  notifySegmentUploadRequest,
  notifyAllImagesComplete,
  notifySegmentVideoForReview,   
  notifyAllVideosComplete,       
  notifyAudioForReview, 
  notifyVideoComplete,
  notifySegmentClipRequest    
} = require('./telegram-bot');

// ── Script review ─────────────────────────────────────────────────
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

// ── Segment image review ──────────────────────────────────────────
app.post('/notify/segment-image-review', async (req, res) => {
  try {
    const { 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      imageUrl, query,
      isReserved,
      filledDuration,
      targetDuration,
      imageFillDuration
    } = req.body;

    await notifySegmentImageForReview({ 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      imageUrl, query,
      isReserved,
      filledDuration,
      targetDuration,
      imageFillDuration
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Segment image review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Segments ready ────────────────────────────────────────────────
app.post('/notify/segments-ready', async (req, res) => {
  try {
    const { 
      id, user_id, totalSegments, 
      mediaType, mediaMode,
      imageCount, videoCount 
    } = req.body;

    await notifySegmentsReady({ 
      id, user_id, totalSegments, 
      mediaType, mediaMode,
      imageCount, videoCount 
    });

    res.json({ success: true, message: 'Segments ready notification sent' });
  } catch (error) {
    console.error('Segments ready notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/segment-image-review', async (req, res) => {
  try {
    const { 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      imageUrl, query,
      isReserved,
      filledDuration,
      targetDuration,
      imageFillDuration
    } = req.body;

    await notifySegmentImageForReview({ 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      imageUrl, query,
      isReserved,
      filledDuration,
      targetDuration,
      imageFillDuration
    });

    res.json({ success: true, message: 'Segment image review notification sent' });
  } catch (error) {
    console.error('Segment image review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/notify/clip-collection-started', async (req, res) => {
  res.json({ success: true });
  const { id, user_id, mediaMode, mediaType } = req.body;

  const modeLabel = mediaMode === 'manual'
    ? `📤 *You'll be prompted to upload clips for each segment.*`
    : `🔍 *Video clips are being fetched automatically.*`;

  const typeNote = mediaType === 'images'
    ? `🖼️ Images with motion effects will be used.`
    : `🎬 Video clips (max 3s each) will be collected.`;

  try {
    await bot.telegram.sendMessage(
      user_id,
      `✅ *Audio Approved!*\n\n` +
      `Now collecting media clips...\n\n` +
      `${typeNote}\n${modeLabel}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`Failed to notify clip collection started:`, err.message);
  }
});

app.post('/notify/segment-clip-request', async (req, res) => {
  // Send success immediately so worker isn't blocked
  res.json({ success: true });

  const {
    id, user_id, segmentIndex, totalSegments,
    segmentText, filledDuration, targetDuration,
    remainingDuration, clipCount, maxClipDuration
  } = req.body;

  try {
    await notifySegmentClipRequest({
      id, user_id, segmentIndex, totalSegments,
      segmentText, filledDuration, targetDuration,
      remainingDuration, clipCount, maxClipDuration
    });
  } catch (err) {
    // Now you'll actually see errors in logs instead of silent failures
    console.error('segment-clip-request notification failed:', err.message);
  }
});

app.post('/notify/clips-complete', async (req, res) => {
  res.json({ success: true });
  const { id, user_id } = req.body;

  try {
    await bot.telegram.sendMessage(
      user_id,
      `🎬 *All clips collected!*\n\nRendering your video now...\n\n⏳ This may take a few minutes.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`Failed to notify clips complete:`, err.message);
  }
});

// ── Segment upload request ────────────────────────────────────────
app.post('/notify/segment-upload-request', async (req, res) => {
  try {
    const { 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      query, mediaType,
      isReserved
    } = req.body;

    await notifySegmentUploadRequest({ 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      query, mediaType,
      isReserved
    });

    res.json({ success: true, message: 'Upload request notification sent' });
  } catch (error) {
    console.error('Upload request notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── All images complete ───────────────────────────────────────────
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

// ── Segment VIDEO review ──────────────────────────────────────────
// Called by worker when a stock video is fetched and needs user approval
app.post('/notify/segment-video-review', async (req, res) => {
  try {
    const { 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      videoUrl, query 
    } = req.body;

    await notifySegmentVideoForReview({ 
      id, user_id, segmentIndex, 
      totalSegments, segmentText, 
      videoUrl, query 
    });

    res.json({ success: true, message: 'Segment video review notification sent' });
  } catch (error) {
    console.error('Segment video review notification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── All videos complete ───────────────────────────────────────────
// Called by worker when all video segments are approved
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

// ── Audio review ──────────────────────────────────────────────────
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

// ── Video complete ────────────────────────────────────────────────
app.post('/notify/video-complete', async (req, res) => {
  try {
    const { id, user_id, result_video, reconciliation } = req.body;

    // ── Apply credit reconciliation ───────────────────────────────
    // Worker calculated the diff — we own credits.js so we do the op here
    let appliedReconciliation = null;

    if (reconciliation && reconciliation.difference !== 0) {
      try {
        appliedReconciliation = await applyReconciliation(reconciliation);
      } catch (reconcileErr) {
        // Non-fatal — video delivery must not be blocked by credit errors
        console.error(
          `⚠️ Credit reconciliation failed for job ${id}: ${reconcileErr.message}`
        );
        // Pass the raw reconciliation so bot can still show the breakdown
        // even if the credit op failed — admin can manually fix
        appliedReconciliation = {
          ...reconciliation,
          applied:       false,
          amountApplied: 0,
          reason:        reconcileErr.message
        };
      }
    }

    // ── Forward to bot ────────────────────────────────────────────
    await notifyVideoComplete({
      id,
      user_id,
      result_video,
      reconciliation: appliedReconciliation
    });

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
