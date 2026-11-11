import { EmailClient } from '@azure/communication-email';
import { config, isProd } from './config.js';

export async function sendMagicLink(email: string, token: string) {
  const link = `${config.APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  if (!config.ACS_CONNECTION_STRING || !config.EMAIL_SENDER) {
    if (isProd) throw new Error('Email is not configured');
    console.log(`\n[dev] magic link for ${email}:\n${link}\n`);
    return;
  }
  const client = new EmailClient(config.ACS_CONNECTION_STRING);
  await client.beginSend({
    senderAddress: config.EMAIL_SENDER,
    recipients: { to: [{ address: email }] },
    content: {
      subject: 'Your Correlaite sign-in link',
      plainText: `Sign in to Correlaite:\n\n${link}\n\nThis link works once and expires in 15 minutes. If you did not request it, ignore this email.`,
      html: `<p>Sign in to Correlaite:</p><p><a href="${link}">Sign in</a></p><p style="color:#666">This link works once and expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
    },
  });
}
