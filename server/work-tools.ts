import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type, type TSchema, type Static } from 'typebox';
import type { ChatRecord, ChatStore } from './store.js';
import type { Approvals } from './approvals.js';
import { assertPlanRevision } from './plans.js';

export function approvedTools(record: ChatRecord, approvals: Approvals) {
  function gate<T extends TSchema, D>(tool: ToolDefinition<T, D>): ToolDefinition {
    return {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      prepareArguments: tool.prepareArguments,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: tool.promptGuidelines,
      executionMode: tool.executionMode,
      // The SDK validates params against this tool's schema before execute().
      // Terminal renderers are deliberately omitted in this web-only wrapper.
      execute: async (id, params, signal, onUpdate, context) => {
        const input = structuredClone(params) as Static<T>;
        try {
          await approvals.guard(record, tool.name, input, signal);
        } catch (error) {
          return {
            content: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
            details: undefined,
            isError: true,
            terminate: true,
          };
        }
        if (signal?.aborted) throw new Error('Execution cancelled');
        return tool.execute(id, input, signal, onUpdate, context);
      },
    };
  }
  return [
    gate(createBashToolDefinition(record.cwd)),
    gate(createPowerShellToolDefinition(record.cwd)),
    gate(createEditToolDefinition(record.cwd)),
    gate(createWriteToolDefinition(record.cwd)),
  ];
}

const planParameters = Type.Object({
  revision: Type.Optional(
    Type.Integer({
      minimum: 0,
      description:
        'Current revision returned when reading the plan; required to replace an existing plan.',
    }),
  ),
  steps: Type.Optional(
    Type.Array(
      Type.Object({
        text: Type.String({ minLength: 1, maxLength: 300 }),
        status: Type.Union([
          Type.Literal('pending'),
          Type.Literal('running'),
          Type.Literal('done'),
        ]),
      }),
      { maxItems: 30 },
    ),
  ),
});

export function planTool(
  record: ChatRecord,
  store: ChatStore,
  publish: () => void,
): ToolDefinition<typeof planParameters> {
  return {
    name: 'update_plan',
    label: 'Task plan',
    parameters: planParameters,
    description:
      'Read or publish a short, user-visible task checklist. Omit steps to read the current steps and revision. To replace an existing plan, supply steps and that exact revision. On a revision conflict, reread and preserve user-added tasks and ordering. Report actions and outcomes only, never private reasoning.',
    promptSnippet: 'Publish task steps and observable progress',
    promptGuidelines: [
      'Read the current plan with update_plan before multi-step coding work. Include its revision when updating statuses, preserve user-added pending tasks and ordering, and reread after any conflict. Do not put private reasoning in update_plan.',
    ],
    executionMode: 'sequential',
    async execute(_id, { steps, revision }, signal) {
      if (signal?.aborted) throw new Error('Task stopped');
      if (steps) {
        assertPlanRevision(
          record.planRevision ?? 0,
          revision ?? (record.planRevision ? undefined : 0),
        );
        if (steps.some((step) => !step.text.trim()))
          throw new Error('Plan steps must not be blank');
        store.update(record.id, {
          plan: steps.map((step) => ({ text: step.text.trim(), status: step.status })),
        });
        publish();
      }
      const current = { steps: record.plan ?? [], revision: record.planRevision ?? 0 };
      return {
        content: [{ type: 'text', text: JSON.stringify(current) }],
        details: current,
      };
    },
  };
}
