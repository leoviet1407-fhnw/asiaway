import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Pluggable email delivery.
 *
 *   MAIL_TRANSPORT=console (default)  log it and write it to .outbox/
 *   MAIL_TRANSPORT=smtp + SMTP_URL    send it for real (nodemailer)
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

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const transport = (env.MAIL_TRANSPORT ?? 'console').toLowerCase();
  if (transport === 'smtp') {
    if (!env.SMTP_URL) throw new Error('MAIL_TRANSPORT=smtp needs SMTP_URL');
    return new SmtpMailer(env.SMTP_URL);
  }
  if (env.NODE_ENV === 'production' && transport === 'console') {
    console.warn('[mail] MAIL_TRANSPORT=console in production: orders are NOT emailed to suppliers');
  }
  return new ConsoleMailer();
}

export function orderFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.ORDER_FROM_EMAIL || 'AsiaWay Bestellung <bestellung@asiaway.ch>';
}
