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
      'Read or publish a short, user-visible task checklist. Omit steps to read the current plan. Supply steps to replace it with concise pending/running/done steps. Report actions and outcomes only, never private reasoning.',
    promptSnippet: 'Publish task steps and observable progress',
    promptGuidelines: [
      'Read the current plan with update_plan before multi-step coding work, then publish and update task statuses as work progresses. Do not put private reasoning in update_plan.',
    ],
    executionMode: 'sequential',
    async execute(_id, { steps }, signal) {
      if (signal?.aborted) throw new Error('Task stopped');
      if (steps) {
        if (steps.some((step) => !step.text.trim()))
          throw new Error('Plan steps must not be blank');
        store.update(record.id, {
          plan: steps.map((step) => ({ text: step.text.trim(), status: step.status })),
        });
        publish();
      }
      const current = record.plan ?? [];
      return {
        content: [{ type: 'text', text: JSON.stringify(current) }],
        details: { steps: current },
      };
    },
  };
}
