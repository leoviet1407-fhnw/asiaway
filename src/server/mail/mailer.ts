import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Pluggable email delivery.
 *
 *   MAIL_TRANSPORT=console (default)  log it and write it to .outbox/
 *   MAIL_TRANSPORT=smtp + SMTP_URL    send it for real (nodemailer)
 *   SMTP_URL_<LOCATION>               e.g. SMTP_URL_WINTERTHUR: that restaurant sends from its own
 *                                     mailbox (its order e-mail under Standorte), else SMTP_URL is used
 *
 * Tests use the MemoryMailer.
 */
export interface MailAttachment {
  readonly filename: string;
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface MailMessage {
  readonly from: string;
  readonly to: string;
  readonly cc?: string | undefined;
  readonly replyTo?: string | undefined;
  readonly subject: string;
  readonly text: string;
  readonly attachments?: readonly MailAttachment[];
}

export interface Mailer {
  readonly transport: string;
  send(message: MailMessage): Promise<{ messageId: string | null }>;
}

export class ConsoleMailer implements Mailer {
  readonly transport = 'console';
  constructor(private readonly outboxDir = join(process.cwd(), '.outbox')) {}

  async send(message: MailMessage): Promise<{ messageId: string | null }> {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const header = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      ...(message.cc ? [`Cc: ${message.cc}`] : []),
      ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
      `Subject: ${message.subject}`,
      `Attachments: ${(message.attachments ?? []).map((a) => `${a.filename} (${a.content.length} B)`).join(', ') || '–'}`,
    ].join('\n');
    console.info(`\n[mail:console] ─────────────────────────────\n${header}\n\n${message.text}\n[mail:console] ─────────────────────────────\n`);
    try {
      await mkdir(this.outboxDir, { recursive: true });
      await writeFile(join(this.outboxDir, `${id}.txt`), `${header}\n\n${message.text}\n`);
      for (const a of message.attachments ?? []) {
        await writeFile(join(this.outboxDir, `${id}-${a.filename}`), a.content);
      }
    } catch (error) {
      console.warn('[mail:console] could not write .outbox', error);
    }
    return { messageId: `console-${id}` };
  }
}

export class MemoryMailer implements Mailer {
  readonly transport = 'memory';
  readonly sent: MailMessage[] = [];
  failNext = false;
  async send(message: MailMessage): Promise<{ messageId: string | null }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated mail failure');
    }
    this.sent.push(message);
    return { messageId: `memory-${this.sent.length}` };
  }
}

export class SmtpMailer implements Mailer {
  readonly transport = 'smtp';
  constructor(private readonly url: string) {}

  async send(message: MailMessage): Promise<{ messageId: string | null }> {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport(this.url);
    const info = await transporter.sendMail({
      from: message.from,
      to: message.to,
      cc: message.cc,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      attachments: (message.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    });
    return { messageId: info.messageId ?? null };
  }
}

/** Used when SMTP is on but there is no shared SMTP_URL: only restaurants with their own mailbox can send. */
class NoDefaultSmtpMailer implements Mailer {
  readonly transport = 'smtp';
  async send(): Promise<{ messageId: string | null }> {
    throw new Error('No SMTP_URL and no mailbox (SMTP_URL_<LOCATION>) for this restaurant');
  }
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const transport = (env.MAIL_TRANSPORT ?? 'console').toLowerCase();
  if (transport === 'smtp') return env.SMTP_URL ? new SmtpMailer(env.SMTP_URL) : new NoDefaultSmtpMailer();
  if (env.NODE_ENV === 'production' && transport === 'console') {
    console.warn('[mail] MAIL_TRANSPORT=console in production: orders are NOT emailed to suppliers');
  }
  return new ConsoleMailer();
}

/** The env name of a restaurant's own mailbox: winterthur → SMTP_URL_WINTERTHUR. */
export const locationSmtpVar = (locationId: string) => `SMTP_URL_${locationId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/**
 * Each restaurant sends from its own mailbox when SMTP_URL_<LOCATION> is set and the restaurant
 * has an order e-mail: From "AsiaWay Winterthur <rewt@asiaway.ch>". Otherwise the default sender.
 */
export function locationSender(env: NodeJS.ProcessEnv = process.env) {
  return (loc: { id: string; name: string; contactEmail: string | null }): { mailer: Mailer; from: string } | null => {
    if ((env.MAIL_TRANSPORT ?? 'console').toLowerCase() !== 'smtp' || !loc.contactEmail) return null;
    const url = env[locationSmtpVar(loc.id)];
    return url ? { mailer: new SmtpMailer(url), from: `AsiaWay ${loc.name} <${loc.contactEmail}>` } : null;
  };
}

export function orderFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.ORDER_FROM_EMAIL || 'AsiaWay Bestellung <bestellung@asiaway.ch>';
}
