import { randomUUID } from 'node:crypto';
import type { ChatRecord } from './store.js';

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: unknown;
  cwd: string;
  createdAt: string;
}

interface Pending {
  chatId: string;
  request: ApprovalRequest;
  finish: (approved: boolean) => void;
}

/** One-shot execution gates. Pending requests are never restored or auto-approved. */
export class Approvals {
  private pending = new Map<string, Pending>();
  private closing = false;

  constructor(
    private notify: (record: ChatRecord) => void,
    private audit: (record: ChatRecord, request: ApprovalRequest, approved: boolean) => void,
    private timeoutMs = 10 * 60 * 1000,
  ) {}

  list(chatId: string) {
    return [...this.pending.values()]
      .filter((item) => item.chatId === chatId)
      .map((item) => item.request);
  }

  async guard(record: ChatRecord, tool: string, input: unknown, signal?: AbortSignal) {
    if (this.closing || signal?.aborted) throw new Error('Execution cancelled');
    if (!record.approvalMode) return;
    if (this.pending.size >= 100 || this.list(record.id).length >= 20)
      throw new Error('Too many pending approvals');
    const serialized = JSON.stringify(input);
    if (!serialized || serialized.length > 200000)
      throw new Error('Proposal is too large to review; use smaller actions');
    const request: ApprovalRequest = {
      id: randomUUID(),
      tool,
      input: JSON.parse(serialized),
      cwd: record.cwd,
      createdAt: new Date().toISOString(),
    };
    const approved = await new Promise<boolean>((resolve) => {
      const abort = () => finish(false);
      const timer = setTimeout(abort, this.timeoutMs);
      timer.unref();
      const finish = (value: boolean) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        let decision = value;
        try {
          this.audit(record, request, value);
        } catch (error) {
          decision = false;
          console.error('Approval audit failed:', error);
        }
        try {
          this.notify(record);
        } catch (error) {
          console.error('Approval notification failed:', error);
        }
        resolve(decision);
      };
      this.pending.set(request.id, { chatId: record.id, request, finish });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.notify(record);
      } catch {
        finish(false);
      }
      if (signal?.aborted) finish(false);
    });
    if (!approved || this.closing || signal?.aborted)
      throw new Error(
        'Action was rejected, cancelled, or expired; do not retry without new user instructions',
      );
  }

  decide(chatId: string, id: string, approved: boolean) {
    const pending = this.pending.get(id);
    if (!pending || pending.chatId !== chatId) return false;
    pending.finish(approved);
    return true;
  }

  cancel(chatId: string) {
    for (const item of [...this.pending.values()]) if (item.chatId === chatId) item.finish(false);
  }

  shutdown() {
    this.closing = true;
    for (const item of [...this.pending.values()]) item.finish(false);
  }
}
