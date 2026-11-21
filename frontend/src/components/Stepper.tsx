import React from 'react';

export interface StepItem {
  id: number;
  key: 'load' | 'verify' | 'correct' | 'segment' | 'export';
  number: string;
  title: string;
}

export const STEPS: StepItem[] = [
  { id: 1, key: 'load', number: '1', title: 'Load' },
  { id: 2, key: 'verify', number: '2', title: 'Verify' },
  { id: 3, key: 'correct', number: '3', title: 'Correct' },
  { id: 4, key: 'segment', number: '4', title: 'Segment' },
  { id: 5, key: 'export', number: '5', title: 'Inspect' },
];

interface StepperProps {
  currentStep: number;
  onSelectStep: (stepId: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({ currentStep, onSelectStep }) => {
  return (
    <nav aria-label="Pipeline Progress" className="w-full">
      <div className="w-full bg-[#141416] p-1 rounded-full border border-white/[0.08] flex items-center justify-between gap-1">
        {STEPS.map((step) => {
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelectStep(step.id)}
              className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5 outline-none ${
                isActive
                  ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                  : isCompleted
                  ? 'text-[#86868B] hover:text-[#F5F5F7]'
                  : 'text-[#86868B]/60 hover:text-[#86868B]'
              }`}
            >
              {isCompleted && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#30D158] shrink-0" />
              )}
              <span className="tabular-nums font-medium text-[11px] opacity-70">
                {step.number}
              </span>
              <span className="tracking-tight">{step.title}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
