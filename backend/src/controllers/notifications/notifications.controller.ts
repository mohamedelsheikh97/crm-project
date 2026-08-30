import type { NextFunction, Request, Response } from 'express';

import * as hub from '../../lib/notification-hub.js';
import { notFound, unauthenticated } from '../../errors/app-error.js';
import * as notificationService from '../../services/notification.service.js';

/**
 * HTTP concerns only. Who may read a notification is decided in the service by
 * OWNERSHIP, so it holds for any caller (Constitution Principle III).
 */

function userId(req: Request): number {
  if (!req.user) throw unauthenticated();
  return req.user.id;
}

function idFrom(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id < 1) {
    throw notFound();
  }

  return id;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sinceRaw = Number(req.query.since);

    res.status(200).json(
      await notificationService.list(userId(req), {
        unreadOnly: req.query.unreadOnly === 'true',
        since: Number.isInteger(sinceRaw) && sinceRaw >= 0 ? sinceRaw : undefined,
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await notificationService.markRead(userId(req), idFrom(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await notificationService.markAllRead(userId(req)));
  } catch (error) {
    next(error);
  }
}

/**
 * The live stream: Server-Sent Events over a held response (research D1).
 *
 * NOT a WebSocket, because every message travels server → client and a
 * bidirectional protocol would buy nothing. NOT consumed by the browser's
 * `EventSource` either, because `EventSource` cannot set an `Authorization`
 * header — and this project's access token is a Bearer header held in memory.
 * Using EventSource would force the token into the query string, where
 * pino-http writes it into the URL log. The client therefore reads this with
 * `fetch()` + `ReadableStream`, which keeps the header and lets this route
 * reuse the ordinary `authenticate` middleware unchanged.
 *
 * This route never decides anything: the hub carries already-persisted rows,
 * and if the connection drops nothing is lost, because the row is the truth
 * (FR-047).
 */
export function stream(req: Request, res: Response, next: NextFunction): void {
  try {
    const id = userId(req);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells a reverse proxy not to buffer. Without it nginx holds the whole
      // response until the connection closes, which for a stream is forever.
      'X-Accel-Buffering': 'no',
    });

    // An immediate comment flushes headers, so the client's `fetch` resolves
    // now rather than at the first notification — which may be hours away.
    res.write(': connected\n\n');

    const unsubscribe = hub.subscribe(id, (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    // Idle proxies close a silent connection. The comment costs nothing and
    // lets the client tell "quiet" from "dead".
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30_000);

    // Both must run, and on every path out — a listener that outlives its
    // response leaks one per reconnect, and reconnects are routine here.
    const cleanup = (): void => {
      clearInterval(keepAlive);
      unsubscribe();
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
  } catch (error) {
    next(error);
  }
}
