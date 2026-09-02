import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for AI-intensive API endpoints.
 * Prevents abuse of Gemini API quota and protects against DDoS.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
});

/**
 * Stricter rate limiter for email-sending endpoints.
 */
export const emailRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many email requests. Please try again later.' },
});
