import React from 'react';
import { Check } from 'lucide-react';

/**
 * Guided multi-step progress for the scan-first flows (receive, putaway, pick,
 * pack). Each step states what the worker should physically do next, because a
 * bare "Step 2 of 3" tells an operator nothing about where to walk.
 */
export default function WorkflowStepper({ steps, current = 0, dataTestId = 'workflow-stepper' }) {
  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <div className="wf-stepper" data-testid={dataTestId} role="list">
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'pending';
        return (
          <div
            key={step.key || i}
            role="listitem"
            className={`wf-step wf-step--${state}`}
            data-testid={`${dataTestId}-step-${i}`}
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <div className="wf-step-marker">
              {state === 'done' ? <Check size={17} /> : i + 1}
            </div>
            <div className="wf-step-text">
              <div className="wf-step-title">{step.title}</div>
              {step.description && <div className="wf-step-desc">{step.description}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
