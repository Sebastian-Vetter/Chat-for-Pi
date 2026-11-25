import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type ModelRuntime,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ChatRecord } from './store.js';
import type { ActivityLog } from './activity.js';

const parameters = Type.Object({ task: Type.String({ minLength: 1, maxLength: 12000 }) });
export const RESEARCH_TOOLS = ['read', 'grep', 'find', 'ls'];
export class Subagents {
  private active = new Map<string, number>();
  constructor(
    private runtime: Promise<ModelRuntime>,
    private activity: ActivityLog,
    private publish: (record: ChatRecord) => void,
    private create = createAgentSession,
  ) {}
  tool(
    record: ChatRecord,
    parent: () => AgentSession | undefined,
  ): ToolDefinition<typeof parameters> {
    return {
      name: 'subagent',
      label: 'Research subagent',
      description:
        'Delegate an independent workspace research question to a read-only AI. Supply complete context in task; the child does not see this conversation. Returns findings. No recursive delegation. Use for focused investigation, not file changes.',
      parameters,
      execute: async (_id, params, signal) => {
        if (!record.subagentsEnabled)
          throw new Error('Enable research delegation with /subagent on');
        if (signal?.aborted) throw new Error('Subagent stopped');
        const active = this.active.get(record.id) ?? 0;
        if (active >= 3)
          throw new Error('At most three research subagents can run per conversation');
        this.active.set(record.id, active + 1);
        const eventId = this.activity.start(record.id, 'agent', 'Subagent · Research', params.task);
        this.publish(record);
        let child: AgentSession | undefined;
        let timedOut = false;
        const stop = () => {
          void child?.abort();
        };
        const timeout = setTimeout(() => {
          timedOut = true;
          stop();
        }, 180000);
        timeout.unref();
        signal?.addEventListener('abort', stop, { once: true });
        try {
          const loader = new DefaultResourceLoader({
            cwd: record.cwd,
            agentDir: getAgentDir(),
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
          });
          await loader.reload();
          child = (
            await this.create({
              cwd: record.cwd,
              modelRuntime: await this.runtime,
              model: parent()?.model,
              resourceLoader: loader,
              sessionManager: SessionManager.inMemory(record.cwd),
              tools: RESEARCH_TOOLS,
            })
          ).session;
          if (timedOut) throw new Error('Subagent exceeded its three-minute research budget');
          if (signal?.aborted) throw new Error('Subagent stopped');
          child.subscribe((event) => {
            if (event.type === 'tool_execution_start') {
              this.activity.update(record.id, eventId, {
                detail: `${params.task}\n\nInspecting with ${event.toolName}`,
              });
              this.publish(record);
            }
          });
          await child.prompt(
            `Research this task using read-only tools. Do not edit files. Return concise findings with file references, uncertainties, and recommendations.\n\n${params.task}`,
          );
          if (timedOut) throw new Error('Subagent exceeded its three-minute research budget');
          const last = child.messages.findLast((m) => m.role === 'assistant');
          if (signal?.aborted || (last?.role === 'assistant' && last.stopReason === 'aborted'))
            throw new Error('Subagent stopped');
          if (last?.role === 'assistant' && last.errorMessage) throw new Error(last.errorMessage);
          const text = child.getLastAssistantText();
          if (!text) throw new Error('Subagent returned no findings');
          this.activity.update(record.id, eventId, {
            status: 'passed',
            detail: `${params.task}\n\n${text}`,
          });
          return { content: [{ type: 'text', text: text.slice(-48000) }], details: { eventId } };
        } catch (error) {
          this.activity.update(record.id, eventId, {
            status: signal?.aborted ? 'stopped' : 'failed',
            detail: `${params.task}\n\n${error instanceof Error ? error.message : String(error)}`,
          });
          throw error;
        } finally {
          signal?.removeEventListener('abort', stop);
          clearTimeout(timeout);
          this.active.set(record.id, Math.max(0, (this.active.get(record.id) ?? 1) - 1));
          child?.dispose();
          this.publish(record);
        }
      },
    };
  }
}
